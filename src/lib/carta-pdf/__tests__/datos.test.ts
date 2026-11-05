/**
 * Carta impresa: qué entra y en qué orden (mismo criterio que la web), precios
 * en es-ES, idioma con caída al español y alérgenos numerados.
 */
import { describe, expect, it } from "vitest";
import {
  campoTraducido,
  categoriasPlatos,
  contenidoPlatos,
  contenidoVinos,
  formatearPrecio,
  nombreFicheroCarta,
  textoPrecio,
  tiposVino,
  tituloPropio,
  zonaVino,
  type FilaPlato,
  type FilaVino,
} from "../datos";
import { claveAlergenoCarta, numeracionAlergenos } from "../alergenos";

const NBSP = " ";

const plato = (p: Partial<FilaPlato> & Record<string, unknown>): FilaPlato =>
  ({
    id: p.id ?? Math.random().toString(36).slice(2),
    nombre: "Plato",
    categoria: "CARNES",
    precio_eur: 10,
    activado: true,
    restaurante: true,
    touza: false,
    orden: 0,
    ...p,
  }) as FilaPlato;

const vino = (v: Partial<FilaVino> & Record<string, unknown>): FilaVino =>
  ({
    id: v.id ?? Math.random().toString(36).slice(2),
    nombre: "Vino",
    categoria: "VINOS TINTOS — RIBERA DEL DUERO",
    precio_eur: 30,
    activado: true,
    restaurante: true,
    touza: true,
    orden: 0,
    alergenos_oficiales: ["sulfitos"],
    ubicacion_pais: "España",
    ubicacion_region: "Peñafiel, Valladolid",
    denominacion_origen: "D.O. Ribera del Duero",
    ...v,
  }) as FilaVino;

const nombres = (contenido: ReturnType<typeof contenidoPlatos>) =>
  contenido.secciones.flatMap((s) => s.grupos.flatMap((g) => g.elementos.map((e) => e.nombre)));

describe("precios", () => {
  it("formatea en es-ES con dos decimales y espacio duro antes del €", () => {
    expect(formatearPrecio(12.5)).toBe(`12,50${NBSP}€`);
    expect(formatearPrecio(4)).toBe(`4,00${NBSP}€`);
    expect(formatearPrecio(178)).toBe(`178,00${NBSP}€`);
  });

  it("sin precio (0, nulo o negativo) dice «Consultar precio» en el idioma", () => {
    expect(textoPrecio(0, "es")).toBe("Consultar precio");
    expect(textoPrecio(null, "en")).toBe("Ask for price");
    expect(textoPrecio(-3, "fr")).toBe("Prix sur demande");
    // En inglés y francés el precio sigue en formato español, como en la web.
    expect(textoPrecio(24.5, "en")).toBe(`24,50${NBSP}€`);
  });
});

describe("selección y orden de los platos", () => {
  const filas = [
    plato({ id: "c2", nombre: "Chuletón", categoria: "CARNES", orden: 2 }),
    plato({ id: "c1", nombre: "Entrecot", categoria: "CARNES", orden: 1 }),
    plato({ id: "c0", nombre: "Sin orden", categoria: "CARNES", orden: null }),
    plato({ id: "p1", nombre: "Flan", categoria: "POSTRES", orden: 1 }),
    plato({ id: "n1", nombre: "Novedad", categoria: "NOVEDADES DEL DÍA", orden: 1 }),
    plato({ id: "z1", nombre: "Categoría nueva", categoria: "BOCADILLOS", orden: 1 }),
    plato({ id: "o1", nombre: "Oculto", categoria: "CARNES", activado: false }),
    plato({ id: "r1", nombre: "Solo Touza", categoria: "CARNES", restaurante: false, touza: true }),
  ];

  it("solo lo activo y publicado en Casa Tomás, en el orden de categorías de la web", () => {
    const contenido = contenidoPlatos(filas, { carta: "restaurante", idioma: "es" });
    expect(contenido.secciones.map((s) => s.clave)).toEqual(["NOVEDADES DEL DÍA", "CARNES", "POSTRES", "BOCADILLOS"]);
    expect(nombres(contenido)).toEqual(["Novedad", "Entrecot", "Chuletón", "Sin orden", "Flan", "Categoría nueva"]);
    expect(contenido.secciones[1].titulo).toBe("Carnes");
  });

  it("la carta de Touza lleva lo suyo", () => {
    expect(nombres(contenidoPlatos(filas, { carta: "touza", idioma: "es" }))).toEqual(["Solo Touza"]);
  });

  it("respeta las categorías elegidas y las ofrece con su cantidad", () => {
    expect(categoriasPlatos(filas, "restaurante")).toEqual([
      { clave: "NOVEDADES DEL DÍA", etiqueta: "Novedades del día", cantidad: 1 },
      { clave: "CARNES", etiqueta: "Carnes", cantidad: 3 },
      { clave: "POSTRES", etiqueta: "Postres", cantidad: 1 },
      { clave: "BOCADILLOS", etiqueta: "Bocadillos", cantidad: 1 },
    ]);
    const contenido = contenidoPlatos(filas, { carta: "restaurante", idioma: "es", categorias: ["POSTRES"] });
    expect(nombres(contenido)).toEqual(["Flan"]);
  });

  it("precio con unidad solo si no es «Unidad» ni «Ración»", () => {
    const contenido = contenidoPlatos(
      [
        plato({ id: "a", nombre: "Chuletón", unidad: "kg", precio_eur: 78 }),
        plato({ id: "b", nombre: "Jamón", unidad: "100 gr", precio_eur: 9 }),
        plato({ id: "c", nombre: "Croqueta", unidad: "unidad", precio_eur: 2.5 }),
        plato({ id: "d", nombre: "Arroz", unidad: "Ración", precio_eur: 16 }),
      ],
      { carta: "restaurante", idioma: "es" },
    );
    expect(contenido.secciones[0].grupos[0].elementos.map((e) => [e.precio, e.unidad])).toEqual([
      [`78,00${NBSP}€`, "kg"],
      [`9,00${NBSP}€`, "100 g"],
      [`2,50${NBSP}€`, null],
      [`16,00${NBSP}€`, null],
    ]);
  });
});

describe("idioma con caída al español", () => {
  const fila = {
    nombre: "Pulpo a la brasa",
    nombre_en: "Grilled octopus",
    nombre_fr: "",
    descripcion: "Con patata",
    descripcion_en: null,
    traducciones: { fr: { nombre: "Poulpe grillé", descripcion: "Avec pomme de terre" } },
  };

  it("columna propia → traducciones → español", () => {
    expect(campoTraducido(fila, "nombre", "en")).toBe("Grilled octopus");
    expect(campoTraducido(fila, "nombre", "fr")).toBe("Poulpe grillé");
    expect(campoTraducido(fila, "descripcion", "en")).toBe("Con patata");
    expect(campoTraducido(fila, "descripcion", "fr")).toBe("Avec pomme de terre");
    expect(campoTraducido(fila, "nombre", "es")).toBe("Pulpo a la brasa");
  });

  it("la categoría sale traducida si su primer plato la tiene; si no, en español", () => {
    const contenido = contenidoPlatos(
      [
        plato({ id: "1", categoria: "CARNES", categoria_en: "MEATS", nombre_en: "Steak" }),
        plato({ id: "2", categoria: "POSTRES", nombre: "Flan" }),
      ],
      { carta: "restaurante", idioma: "en" },
    );
    expect(contenido.secciones.map((s) => s.titulo)).toEqual(["Meats", "Postres"]);
    expect(nombres(contenido)).toEqual(["Steak", "Flan"]);
  });
});

describe("alérgenos", () => {
  it("normaliza las formas de la BD y descarta «sin alérgenos declarados»", () => {
    expect(claveAlergenoCarta("Lácteos")).toBe("lácteos");
    expect(claveAlergenoCarta("frutos_cascara")).toBe("frutos de cáscara");
    expect(claveAlergenoCarta("mariscos")).toBe("marisco");
    expect(claveAlergenoCarta("sin alérgenos declarados")).toBeNull();
  });

  it("numera los 14 con el orden del reglamento y los extras desde el 15", () => {
    const leyenda = numeracionAlergenos(["carne", "gluten", "marisco"], "en");
    expect(leyenda.slice(0, 3).map((e) => [e.numero, e.etiqueta])).toEqual([
      [1, "Gluten"],
      [2, "Crustaceans"],
      [3, "Egg"],
    ]);
    expect(leyenda.find((e) => e.clave === "lácteos")?.numero).toBe(7);
    expect(leyenda.find((e) => e.clave === "sulfitos")?.numero).toBe(12);
    expect(leyenda.slice(14).map((e) => [e.numero, e.etiqueta])).toEqual([
      [15, "Shellfish"],
      [16, "Meat"],
    ]);
  });

  it("cada plato lleva sus números (declarados e inferidos, sin repetir)", () => {
    const contenido = contenidoPlatos(
      [plato({ alergenos_oficiales: ["lácteos", "gluten", "sin alérgenos declarados"], alergenos_inferidos: ["Gluten", "huevo"] })],
      { carta: "restaurante", idioma: "es" },
    );
    expect(contenido.secciones[0].grupos[0].elementos[0].alergenos).toEqual([1, 3, 7]);
    expect(contenido.leyenda).toHaveLength(14);
  });
});

describe("vinos", () => {
  const filas = [
    vino({ id: "b1", nombre: "Albariño", categoria: "VINOS BLANCOS — RÍAS BAIXAS", denominacion_origen: "D.O. Rías Baixas", ubicacion_region: "Cambados, Pontevedra" }),
    vino({ id: "t2", nombre: "Pesquera", orden: 2 }),
    vino({ id: "t1", nombre: "Pago de Carraovejas", orden: 1, copeo: true, precio_copa_eur: 6 }),
    vino({
      id: "c1",
      nombre: "Krug",
      categoria: "VINOS ESPUMOSOS — CHAMPAGNE",
      denominacion_origen: "AOC Champagne",
      ubicacion_region: "Champagne",
      ubicacion_pais: "Francia",
      ubicacion_pais_en: "France",
    }),
    vino({ id: "x1", nombre: "Oculto", restaurante: false, touza: false, activado: false }),
  ];

  it("agrupa por tipo (orden de la web) y denominación, con la D.O. del vino como cabecera", () => {
    const contenido = contenidoVinos(filas, { carta: "restaurante", idioma: "es" });
    expect(contenido.secciones.map((s) => s.titulo)).toEqual(["Tintos", "Blancos", "Champagnes y espumosos"]);
    expect(contenido.secciones.every((s) => s.paginaNueva)).toBe(true);
    expect(contenido.secciones[0].grupos[0].titulo).toBe("D.O. Ribera del Duero");
    expect(contenido.secciones[0].grupos[0].elementos.map((e) => e.nombre)).toEqual(["Pago de Carraovejas", "Pesquera"]);
    expect(contenido.secciones[0].grupos[0].elementos[0].copa).toBe(`Copa 6,00${NBSP}€`);
  });

  it("zona: región y, fuera de España, el país (traducido si hay columna)", () => {
    expect(zonaVino(filas[1], "es")).toBe("Peñafiel, Valladolid");
    expect(zonaVino(filas[3], "es")).toBe("Champagne · Francia");
    expect(zonaVino(filas[3], "en")).toBe("Champagne · France");
  });

  it("si todos llevan sulfitos va en una nota y no como número en cada vino", () => {
    const contenido = contenidoVinos(filas, { carta: "restaurante", idioma: "es" });
    expect(contenido.notaComun).toBe("Todos nuestros vinos contienen sulfitos.");
    expect(contenido.leyenda).toEqual([]);
    expect(contenido.secciones.flatMap((s) => s.grupos.flatMap((g) => g.elementos.flatMap((e) => e.alergenos)))).toEqual([]);
    expect(contenidoVinos(filas, { carta: "restaurante", idioma: "fr" }).notaComun).toBe("Tous nos vins contiennent des sulfites.");
  });

  it("ofrece tipos con sus denominaciones y respeta la selección", () => {
    const tipos = tiposVino(filas, "restaurante");
    expect(tipos.map((t) => [t.etiqueta, t.cantidad])).toEqual([
      ["Tintos", 2],
      ["Blancos", 1],
      ["Champagnes y espumosos", 1],
    ]);
    const soloBlancos = contenidoVinos(filas, { carta: "restaurante", idioma: "es", categorias: ["VINOS BLANCOS — RÍAS BAIXAS"] });
    expect(soloBlancos.secciones.map((s) => s.titulo)).toEqual(["Blancos"]);
  });

  it("nombres propios de denominación sin la D.O. en el vino", () => {
    expect(tituloPropio("RIBEIRA SACRA")).toBe("Ribeira Sacra");
    expect(tituloPropio("UTIEL-REQUENA")).toBe("Utiel-Requena");
    expect(tituloPropio("MOSCATO D’ASTI")).toBe("Moscato d’Asti");
    const contenido = contenidoVinos([vino({ categoria: "VINOS TINTOS — RIBEIRA SACRA", denominacion_origen: null })], {
      carta: "restaurante",
      idioma: "es",
    });
    expect(contenido.secciones[0].grupos[0].titulo).toBe("Ribeira Sacra");
  });
});

describe("nombre del fichero", () => {
  it("lleva marca, tipo, idioma, tamaño y fecha", () => {
    const fecha = new Date(2026, 10, 5);
    expect(nombreFicheroCarta("platos", "restaurante", "es", "A5", fecha)).toBe("Carta-Casa-Tomas-platos-es-A5-2026-11-05.pdf");
    expect(nombreFicheroCarta("vinos", "touza", "fr", "A4", fecha)).toBe("Carta-Touza-vinos-fr-A4-2026-11-05.pdf");
  });
});
