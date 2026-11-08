/**
 * Una sección por cara: cada categoría o tipo de vino empieza en página nueva
 * y lleva en ella todos sus elementos; nada se sale de los márgenes, ningún
 * plato se parte, se pierde ni se repite; las secciones vacías no tienen
 * página; las cortas no se estiran; las largas se compactan sin bajar del
 * cuerpo mínimo y, si ni así caben, se avisa (y solo se reparten si se pide).
 * El A4 es A4 y no un A5 ampliado.
 */
import { describe, expect, it } from "vitest";
import type { ContenidoCarta, ElementoCarta, SeccionCarta } from "../datos";
import {
  COLORES,
  CUERPO_MINIMO,
  FORMATOS,
  maquetarCarta,
  mm,
  seccionesQueNoCaben,
  type Medidor,
  type PaginaCarta,
  type TamanoCarta,
  type Trazo,
} from "../maquetacion";

/** Letras de ancho fijo: medio cuerpo por letra. */
const medidor: Medidor = {
  ancho: (texto, _fuente, tamano, espaciado = 0) => Array.from(texto).length * tamano * 0.5 + espaciado * Math.max(0, Array.from(texto).length - 1),
  limpiar: (texto) => texto.replace(/\s+/g, " ").trim(),
};

const elemento = (nombre: string, detalle: string | null = "Descripción corta del plato con dos o tres ideas"): ElementoCarta => ({
  id: nombre,
  nombre,
  detalle,
  precio: "12,50 €",
  unidad: null,
  copa: null,
  alergenos: [1, 7],
});

const seccion = (titulo: string, n: number): SeccionCarta => ({
  clave: titulo,
  titulo,
  grupos: [{ titulo: null, elementos: Array.from({ length: n }, (_, i) => elemento(`${titulo} ${i + 1}`)) }],
});

/** Tipo de vino con varias denominaciones de `porGrupo` vinos. */
const tipoVino = (titulo: string, grupos: number, porGrupo: number): SeccionCarta => ({
  clave: titulo,
  titulo,
  grupos: Array.from({ length: grupos }, (_, g) => ({
    titulo: `D.O. ${titulo} ${g + 1}`,
    elementos: Array.from({ length: porGrupo }, (_, i) => elemento(`${titulo} ${g + 1}.${i + 1}`, "Zona, Provincia")),
  })),
});

const contenido = (secciones: SeccionCarta[], tipo: ContenidoCarta["tipo"] = "platos"): ContenidoCarta => ({
  tipo,
  carta: "restaurante",
  idioma: "es",
  secciones,
  leyenda: [],
  notaComun: null,
});

const textos = (pagina: PaginaCarta) => pagina.trazos.filter((t): t is Extract<Trazo, { tipo: "texto" }> => t.tipo === "texto");
const mismoColor = (a: { r: number }, b: { r: number }) => Math.abs(a.r - b.r) < 1e-9;
/** Nombres de plato: seminegrita en pizarra. */
const nombresEn = (pagina: PaginaCarta) =>
  textos(pagina).filter((t) => t.fuente === "seminegrita" && mismoColor(t.color, COLORES.pizarra)).map((t) => t.texto);
/** Títulos de sección: regular, oro y con espaciado (no la cabecera de página, que va en piedra). */
const titulosEn = (pagina: PaginaCarta) =>
  textos(pagina).filter((t) => t.fuente === "regular" && mismoColor(t.color, COLORES.oro) && (t.espaciado ?? 0) > 0).map((t) => t.texto);
const interiores = (paginas: PaginaCarta[]) => paginas.filter((p) => p.tipo === "interior");
const TAMANOS: TamanoCarta[] = ["A5", "A4"];

describe("maquetarCarta: una sección por cara", () => {
  it("portada, interiores y contraportada en A5 (419,53 × 595,28 pt)", () => {
    const { paginas } = maquetarCarta(medidor, contenido([seccion("CARNES", 6)]));
    expect(paginas[0].tipo).toBe("portada");
    expect(paginas[paginas.length - 1].tipo).toBe("contraportada");
    expect(paginas.map((p) => p.numero)).toEqual(paginas.map((_, i) => i + 1));
    for (const pagina of paginas) {
      expect(pagina.ancho).toBeCloseTo(419.53, 2);
      expect(pagina.alto).toBeCloseTo(595.28, 2);
    }
  });

  it.each(TAMANOS)("en %s, seis secciones dan seis caras, cada una con un solo título y todos sus platos, una vez y en orden", (tamano) => {
    const secciones = [seccion("NOVEDADES", 9), seccion("ENTRANTES", 14), seccion("CARNES", 3), seccion("POSTRES", 11), seccion("ARROCES", 1), seccion("SNACK", 6)];
    const { paginas, secciones: informe } = maquetarCarta(medidor, contenido(secciones), tamano);
    const caras = interiores(paginas);
    expect(caras).toHaveLength(6);
    caras.forEach((cara, i) => {
      expect(titulosEn(cara)).toEqual([secciones[i].titulo]);
      expect(cara.seccion).toBe(secciones[i].clave);
      expect(nombresEn(cara)).toEqual(secciones[i].grupos[0].elementos.map((e) => e.nombre));
      expect(cara.desborda).toBeUndefined();
    });
    expect(informe.map((s) => [s.clave, s.caras, s.cabe])).toEqual(secciones.map((s) => [s.clave, 1, true]));
    // Portada, seis caras y contraportada: sin páginas en blanco entre secciones.
    expect(paginas).toHaveLength(8);
  });

  it.each(TAMANOS)("en %s todo cabe dentro de los márgenes de la hoja (≥ 12 mm) y no se pisa nada, también con nombres y descripciones largos", (tamano) => {
    const entrantes = seccion("ENTRANTES", 18);
    entrantes.grupos[0].elementos.splice(3, 0, {
      ...elemento(
        "Tataki de chuleta de vaca madurada sesenta días con pimiento caramelizado, salsa de sésamo tostado y brotes",
        "Chuleta de vaca marcada por fuera y roja por dentro, con pimiento caramelizado a fuego lento, salsa de sésamo tostado, brotes tiernos y un toque de lima, como la servimos en la barra desde hace años.",
      ),
      unidad: "100 g",
    });
    const secciones = [seccion("NOVEDADES", 9), entrantes, seccion("CARNES", 2)];
    const { paginas } = maquetarCarta(medidor, contenido(secciones), tamano);
    const formato = FORMATOS[tamano];
    for (const pagina of interiores(paginas)) {
      // La cabecera y el número de página van, a propósito, en el margen.
      const contenidoPagina = textos(pagina).filter((t) => t.texto !== String(pagina.numero) && !t.texto.startsWith("CASA TOMÁS ·"));
      const cajas = contenidoPagina.map((t) => ({ t, x0: t.x, x1: t.x + medidor.ancho(t.texto, t.fuente, t.tamano, t.espaciado), y0: t.y - 0.7 * t.tamano, y1: t.y + 0.2 * t.tamano }));
      for (const caja of cajas) {
        expect(caja.x0).toBeGreaterThanOrEqual(mm(12) - 0.01);
        expect(caja.x1).toBeLessThanOrEqual(formato.ancho - mm(12) + 0.01);
        expect(caja.y0).toBeGreaterThanOrEqual(mm(12) - 0.01);
        expect(caja.y1).toBeLessThanOrEqual(formato.alto - mm(12) + 0.01);
      }
      // Solo cuenta lo que no son números de alérgenos (que van pegados, voladitos, al nombre).
      const cuerpo = cajas.filter((c) => c.t.tamano >= 8);
      for (let i = 0; i < cuerpo.length; i++)
        for (let j = i + 1; j < cuerpo.length; j++) {
          const [a, b] = [cuerpo[i], cuerpo[j]];
          const pisan = a.x0 < b.x1 - 0.3 && b.x0 < a.x1 - 0.3 && a.y0 < b.y1 - 0.3 && b.y0 < a.y1 - 0.3;
          expect(pisan, `«${a.t.texto}» y «${b.t.texto}» en la página ${pagina.numero}`).toBe(false);
        }
    }
  });

  it("una sección vacía no tiene página", () => {
    const vacia: SeccionCarta = { clave: "VACIA", titulo: "VACIA", grupos: [{ titulo: null, elementos: [] }] };
    const { paginas, secciones } = maquetarCarta(medidor, contenido([seccion("CARNES", 3), vacia, seccion("POSTRES", 2)]));
    expect(interiores(paginas).map((p) => p.seccion)).toEqual(["CARNES", "POSTRES"]);
    expect(secciones.map((s) => s.clave)).toEqual(["CARNES", "POSTRES"]);
  });

  it.each(TAMANOS)("en %s una sección corta guarda la letra y el aire de diseño y se centra, sin estirarse", (tamano) => {
    const corta = interiores(maquetarCarta(medidor, contenido([seccion("ARROCES", 3)]), tamano).paginas)[0];
    const larga = interiores(maquetarCarta(medidor, contenido([seccion("ARROCES", 8)]), tamano).paginas)[0];
    const filas = (pagina: PaginaCarta) => textos(pagina).filter((t) => t.fuente === "seminegrita" && mismoColor(t.color, COLORES.pizarra));
    // Mismo cuerpo y misma distancia entre platos que en una sección más larga: no se reparte el blanco.
    expect(filas(corta)[0].tamano).toBe(filas(larga)[0].tamano);
    expect(filas(corta)[1].y - filas(corta)[0].y).toBeCloseTo(filas(larga)[1].y - filas(larga)[0].y, 5);
    // Centrada: el título, más abajo que el de una larga, y el bloque, alrededor del centro de la hoja.
    const titulo = (pagina: PaginaCarta) => textos(pagina).find((t) => t.texto === "ARROCES")!.y;
    expect(titulo(corta)).toBeGreaterThan(titulo(larga) + 20);
    const ultimo = filas(corta)[filas(corta).length - 1].y;
    expect((titulo(corta) + ultimo) / 2).toBeLessThan(FORMATOS[tamano].alto / 2);
    expect((titulo(corta) + ultimo) / 2).toBeGreaterThan(FORMATOS[tamano].alto * 0.35);
  });

  it.each(TAMANOS)("en %s una sección larga se compacta para caber en su cara sin bajar del cuerpo mínimo", (tamano) => {
    const larga = seccion("MARISCOS", tamano === "A5" ? 18 : 22);
    const { paginas, secciones } = maquetarCarta(medidor, contenido([larga]), tamano);
    expect(interiores(paginas)).toHaveLength(1);
    expect(secciones[0]).toMatchObject({ cabe: true, caras: 1 });
    const disenoPlato = 10.5 * FORMATOS[tamano].escala.platos;
    expect(secciones[0].cuerpo).toBeLessThan(disenoPlato);
    expect(secciones[0].cuerpo).toBeGreaterThanOrEqual(CUERPO_MINIMO.nombre);
    expect(nombresEn(interiores(paginas)[0])).toHaveLength(larga.grupos[0].elementos.length);
  });

  it("si no cabe ni compactada, avisa con la sección y no la reparte sola: una cara marcada", () => {
    const enorme = seccion("PESCADOS", 60);
    const { paginas, secciones } = maquetarCarta(medidor, contenido([seccion("CARNES", 3), enorme]));
    const caras = interiores(paginas);
    expect(caras.map((p) => p.seccion)).toEqual(["CARNES", "PESCADOS"]);
    expect(caras[1].desborda).toBe(true);
    expect(caras[0].desborda).toBeUndefined();
    const informe = seccionesQueNoCaben({ paginas, secciones });
    expect(informe).toHaveLength(1);
    expect(informe[0]).toMatchObject({ clave: "PESCADOS", cabe: false, caras: 1, elementos: 60, pagina: 2 });
    expect(informe[0].carasNecesarias).toBeGreaterThan(1);
    expect(informe[0].caben).toBeGreaterThan(0);
    expect(informe[0].caben).toBeLessThan(60);
    // Nada de «(continuación)» si no se ha pedido.
    expect(caras.some((p) => textos(p).some((t) => t.texto === "(continuación)"))).toBe(false);
  });

  it("repartida a petición: las caras necesarias, con «(continuación)», y cada plato una vez", () => {
    const enorme = seccion("PESCADOS", 60);
    const sin = maquetarCarta(medidor, contenido([enorme]));
    const con = maquetarCarta(medidor, contenido([enorme]), "A5", { repartir: ["PESCADOS"] });
    const caras = interiores(con.paginas);
    expect(caras).toHaveLength(sin.secciones[0].carasNecesarias);
    expect(con.secciones[0]).toMatchObject({ cabe: true, repartida: true, caras: caras.length });
    expect(caras.every((p) => !p.desborda && titulosEn(p).join() === "PESCADOS")).toBe(true);
    expect(caras.slice(1).every((p) => textos(p).some((t) => t.texto === "(continuación)"))).toBe(true);
    expect(caras.flatMap(nombresEn)).toEqual(enorme.grupos[0].elementos.map((e) => e.nombre));
  });

  it("los vinos: cada tipo en su cara en A5 y en A4, y en A4 a varias columnas con letra mayor", () => {
    const vinos = contenido([tipoVino("TINTOS", 3, 4), tipoVino("BLANCOS", 2, 3), tipoVino("ROSADOS", 1, 2)], "vinos");
    for (const tamano of TAMANOS) {
      expect(interiores(maquetarCarta(medidor, vinos, tamano).paginas).map(titulosEn)).toEqual([["TINTOS"], ["BLANCOS"], ["ROSADOS"]]);
    }
    const largos = contenido([tipoVino("TINTOS", 6, 5)], "vinos");
    const a5 = maquetarCarta(medidor, largos, "A5");
    const a4 = maquetarCarta(medidor, largos, "A4");
    expect(a4.paginas[0].ancho).toBeCloseTo(595.28, 2);
    expect(a4.paginas[0].alto).toBeCloseTo(841.89, 2);
    expect(a4.secciones[0].cabe).toBe(true);
    expect(a4.secciones[0].columnas).toBeGreaterThanOrEqual(2);
    const columnas = new Set(nombresEn(a4.paginas[1]).length ? textos(a4.paginas[1]).filter((t) => t.fuente === "seminegrita" && mismoColor(t.color, COLORES.pizarra)).map((t) => Math.round(t.x)) : []);
    expect(columnas.size).toBe(a4.secciones[0].columnas);
    // El A4 no es el A5 a escala: con el mismo contenido, más letra.
    expect(a4.secciones[0].cuerpo).toBeGreaterThan(a5.secciones[0].cuerpo);
  });

  it("una denominación nunca se queda sola al pie de una columna, y si sigue en la siguiente lo dice", () => {
    const vinos = contenido([tipoVino("TINTOS", 6, 5)], "vinos");
    for (const tamano of TAMANOS) {
      const { paginas, secciones } = maquetarCarta(medidor, vinos, tamano);
      expect(secciones[0].cabe).toBe(true);
      const cara = interiores(paginas)[0];
      const cabeceras = textos(cara).filter((t) => t.fuente === "italica" && mismoColor(t.color, COLORES.oro));
      for (const cabecera of cabeceras) {
        // Debajo, en la misma columna, al menos dos vinos (todas las denominaciones tienen cinco).
        const debajo = nombresEn({ ...cara, trazos: textos(cara).filter((t) => Math.abs(t.x - cabecera.x) < 1 && t.y > cabecera.y) });
        expect(debajo.length, `${tamano} «${cabecera.texto}»`).toBeGreaterThanOrEqual(2);
      }
      const nombres = textos(cara).filter((t) => t.fuente === "seminegrita" && mismoColor(t.color, COLORES.pizarra));
      const columnasConVinos = new Set(nombres.map((t) => Math.round(t.x)));
      if (columnasConVinos.size > 1) {
        // Cada columna empieza con su denominación (nueva o «(continuación)»).
        for (const x of columnasConVinos) {
          const primeroColumna = Math.min(...nombres.filter((t) => Math.round(t.x) === x).map((t) => t.y));
          expect(cabeceras.some((c) => Math.round(c.x) === x && c.y < primeroColumna)).toBe(true);
        }
      }
    }
  });

  it("no parte palabras por letras: si en columnas estrechas no caben, usa otra composición", () => {
    // 40 letras: más ancha que una columna de las tres del A4, cabe en una de dos.
    const largo: ElementoCarta = { ...elemento("Supercalifragilisticoespialidosisimament Reserva", "Zona"), precio: "Consultar precio" };
    const seccionLarga: SeccionCarta = {
      clave: "TINTOS",
      titulo: "TINTOS",
      grupos: [{ titulo: "D.O. Larga", elementos: [largo, ...Array.from({ length: 50 }, (_, i) => elemento(`Vino ${i + 1}`, "Zona"))] }],
    };
    const { paginas } = maquetarCarta(medidor, contenido([seccionLarga], "vinos"), "A4", { repartir: ["TINTOS"] });
    const palabras = new Set(seccionLarga.grupos[0].elementos.flatMap((e) => e.nombre.split(" ")));
    const lineas = interiores(paginas).flatMap(nombresEn);
    expect(lineas).toContain("Supercalifragilisticoespialidosisimament");
    for (const linea of lineas) for (const palabra of linea.split(" ")) expect(palabras.has(palabra), `«${palabra}»`).toBe(true);
  });

  it("el cuerpo mínimo: nombres y precios de 9 pt o más, descripciones de 8 pt o más, y márgenes de 12 mm o más", () => {
    for (const tamano of TAMANOS) {
      const formato = FORMATOS[tamano];
      for (const tipo of ["platos", "vinos"] as const) {
        for (const variante of formato.variantes[tipo]) {
          expect((tipo === "vinos" ? 10 : 10.5) * variante.escala, `${tamano} ${tipo}`).toBeGreaterThanOrEqual(CUERPO_MINIMO.nombre);
          expect(9 * variante.escala, `${tamano} ${tipo}`).toBeGreaterThanOrEqual(CUERPO_MINIMO.detalle);
          expect(Math.min(variante.lateral, variante.superior, variante.inferior)).toBeGreaterThanOrEqual(mm(12) - 1e-9);
        }
      }
      // Con la sección más apretada que aún cabe, la letra sigue por encima del mínimo.
      const { paginas } = maquetarCarta(medidor, contenido([seccion("CARNES", tamano === "A5" ? 24 : 34)]), tamano);
      const cuerpo = interiores(paginas).flatMap(textos);
      const nombres = cuerpo.filter((t) => t.fuente === "seminegrita" && t.texto.length > 3);
      const descripciones = cuerpo.filter((t) => t.fuente === "italica" && t.texto.length > 3);
      expect(Math.min(...nombres.map((t) => t.tamano))).toBeGreaterThanOrEqual(CUERPO_MINIMO.nombre - 1e-9);
      expect(Math.min(...descripciones.map((t) => t.tamano))).toBeGreaterThanOrEqual(CUERPO_MINIMO.detalle - 1e-9);
    }
  });
});
