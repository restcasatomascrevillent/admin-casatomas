/**
 * Nunca dos secciones en el mismo folio y un plato por línea: cada categoría o
 * tipo de vino empieza en página nueva, a una columna; si no cabe en una
 * página, sigue en las siguientes (con «(continuación)») y la siguiente
 * sección vuelve a empezar en página nueva. Nada se sale de los márgenes,
 * ningún plato se parte, se pierde ni se repite; las secciones vacías no
 * tienen página; las cortas no se estiran; el texto se alinea a la izquierda,
 * al centro o a la derecha, y arriba, en el centro o abajo. El A4 es A4 y no
 * un A5 ampliado.
 */
import { describe, expect, it } from "vitest";
import type { ContenidoCarta, ElementoCarta, SeccionCarta } from "../datos";
import {
  ALINEACIONES_HORIZONTALES,
  COLORES,
  CUERPO_MINIMO,
  FORMATOS,
  maquetarCarta,
  mm,
  seccionesQueNoCaben,
  type Alineacion,
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

type Texto = Extract<Trazo, { tipo: "texto" }>;
const textos = (pagina: PaginaCarta) => pagina.trazos.filter((t): t is Texto => t.tipo === "texto");
const mismoColor = (a: { r: number }, b: { r: number }) => Math.abs(a.r - b.r) < 1e-9;
/** Líneas de nombre de plato: seminegrita en pizarra. */
const lineasNombre = (pagina: PaginaCarta) => textos(pagina).filter((t) => t.fuente === "seminegrita" && mismoColor(t.color, COLORES.pizarra));
const nombresEn = (pagina: PaginaCarta) => lineasNombre(pagina).map((t) => t.texto);
/** Precios: seminegrita en oro, del cuerpo del nombre (los números de alérgenos son más pequeños). */
const preciosEn = (pagina: PaginaCarta) => textos(pagina).filter((t) => t.fuente === "seminegrita" && mismoColor(t.color, COLORES.oro) && t.texto.includes("€"));
/** Títulos de sección: regular, oro y con espaciado (no la cabecera de página, que va en piedra). */
const titulosEn = (pagina: PaginaCarta) =>
  textos(pagina).filter((t) => t.fuente === "regular" && mismoColor(t.color, COLORES.oro) && (t.espaciado ?? 0) > 0);
const interiores = (paginas: PaginaCarta[]) => paginas.filter((p) => p.tipo === "interior");
const anchoDe = (t: Texto) => medidor.ancho(t.texto, t.fuente, t.tamano, t.espaciado);
const TAMANOS: TamanoCarta[] = ["A5", "A4"];

describe("maquetarCarta: nunca dos secciones en la misma página", () => {
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

  it.each(TAMANOS)("en %s, seis secciones que caben dan seis páginas, cada una con un solo título y todos sus platos, una vez y en orden", (tamano) => {
    const secciones = [seccion("NOVEDADES", 9), seccion("ENTRANTES", 14), seccion("CARNES", 3), seccion("POSTRES", 11), seccion("ARROCES", 1), seccion("SNACK", 6)];
    const { paginas, secciones: informe } = maquetarCarta(medidor, contenido(secciones), tamano);
    const caras = interiores(paginas);
    expect(caras).toHaveLength(6);
    caras.forEach((cara, i) => {
      expect(titulosEn(cara).map((t) => t.texto)).toEqual([secciones[i].titulo]);
      expect(cara.seccion).toBe(secciones[i].clave);
      expect(nombresEn(cara)).toEqual(secciones[i].grupos[0].elementos.map((e) => e.nombre));
    });
    expect(informe.map((s) => [s.clave, s.caras, s.cabe])).toEqual(secciones.map((s) => [s.clave, 1, true]));
    // Portada, seis páginas y contraportada: sin páginas en blanco entre secciones.
    expect(paginas).toHaveLength(8);
  });

  it("una sección que no cabe en una página sigue en las siguientes, con su título y «(continuación)», y la siguiente empieza en página nueva", () => {
    const larga = seccion("PESCADOS", 45);
    const { paginas, secciones } = maquetarCarta(medidor, contenido([seccion("CARNES", 3), larga, seccion("POSTRES", 2)]));
    const caras = interiores(paginas);
    const deLarga = caras.filter((p) => p.seccion === "PESCADOS");
    expect(deLarga.length).toBeGreaterThan(1);
    // En orden y sin mezclarse: CARNES, todas las de PESCADOS, POSTRES.
    expect(caras.map((p) => p.seccion)).toEqual(["CARNES", ...deLarga.map(() => "PESCADOS"), "POSTRES"]);
    for (const cara of caras) expect(new Set(titulosEn(cara).map((t) => t.texto)).size).toBe(1);
    expect(deLarga.slice(1).every((p) => textos(p).some((t) => t.texto === "(continuación)"))).toBe(true);
    expect(textos(deLarga[0]).some((t) => t.texto === "(continuación)")).toBe(false);
    // Cada plato una vez, en orden, y nada marcado como que no cabe.
    expect(deLarga.flatMap(nombresEn)).toEqual(larga.grupos[0].elementos.map((e) => e.nombre));
    expect(caras.every((p) => !p.desborda)).toBe(true);
    expect(secciones.find((s) => s.clave === "PESCADOS")).toMatchObject({ cabe: true, caras: deLarga.length, pagina: 2 });
    expect(seccionesQueNoCaben({ paginas, secciones })).toEqual([]);
  });

  it("si no cabe en una página no se aprieta: letra de diseño y páginas equilibradas", () => {
    const { paginas, secciones } = maquetarCarta(medidor, contenido([seccion("PESCADOS", 45)]));
    expect(secciones[0].cuerpo).toBe(10.5);
    const caras = interiores(paginas);
    const platos = caras.map((p) => nombresEn(p).length);
    // Ninguna página con menos de la mitad de platos que la más llena.
    expect(Math.min(...platos)).toBeGreaterThanOrEqual(Math.max(...platos) / 2);
  });

  it("siempre a una columna: un plato debajo de otro", () => {
    for (const tamano of TAMANOS) {
      for (const tipo of ["platos", "vinos"] as const) {
        const datos = tipo === "vinos" ? [tipoVino("TINTOS", 12, 6)] : [seccion("MARISCOS", 40)];
        for (const pagina of interiores(maquetarCarta(medidor, contenido(datos, tipo), tamano).paginas)) {
          expect(new Set(lineasNombre(pagina).map((t) => Math.round(t.x))).size, `${tamano} ${tipo}`).toBe(1);
          // Cada plato, más abajo que el anterior.
          const ys = preciosEn(pagina).map((t) => t.y);
          expect(ys).toEqual([...ys].sort((a, b) => a - b));
        }
      }
    }
  });

  for (const horizontal of ALINEACIONES_HORIZONTALES) {
    it.each(TAMANOS)(`alineado a la ${horizontal}, en %s todo cabe dentro de los márgenes (≥ 12 mm) y no se pisa nada, también con nombres y descripciones largos`, (tamano) => {
      const entrantes = seccion("ENTRANTES", 30);
      entrantes.grupos[0].elementos.splice(3, 0, {
        ...elemento(
          "Tataki de chuleta de vaca madurada sesenta días con pimiento caramelizado, salsa de sésamo tostado y brotes",
          "Chuleta de vaca marcada por fuera y roja por dentro, con pimiento caramelizado a fuego lento, salsa de sésamo tostado, brotes tiernos y un toque de lima, como la servimos en la barra desde hace años.",
        ),
        unidad: "100 g",
      });
      const vinos = tipoVino("TINTOS", 10, 6);
      vinos.grupos[0].elementos[0] = { ...vinos.grupos[0].elementos[0], copa: "Copa 6,50 €", precio: "Consultar precio" };
      for (const datos of [contenido([seccion("NOVEDADES", 9), entrantes, seccion("CARNES", 2)]), contenido([vinos], "vinos")]) {
        const { paginas } = maquetarCarta(medidor, datos, tamano, { alineacion: { horizontal } });
        const formato = FORMATOS[tamano];
        for (const pagina of interiores(paginas)) {
          // La cabecera y el número de página van, a propósito, en el margen.
          const cuerpo = textos(pagina).filter((t) => t.texto !== String(pagina.numero) && !t.texto.startsWith("CASA TOMÁS ·"));
          const cajas = cuerpo.map((t) => ({ t, x0: t.x, x1: t.x + anchoDe(t), y0: t.y - 0.7 * t.tamano, y1: t.y + 0.2 * t.tamano }));
          for (const caja of cajas) {
            expect(caja.x0).toBeGreaterThanOrEqual(mm(12) - 0.01);
            expect(caja.x1).toBeLessThanOrEqual(formato.ancho - mm(12) + 0.01);
            expect(caja.y0).toBeGreaterThanOrEqual(mm(12) - 0.01);
            expect(caja.y1).toBeLessThanOrEqual(formato.alto - mm(12) + 0.01);
          }
          // Los números de alérgenos van pegados, voladitos, al nombre: no cuentan.
          const grandes = cajas.filter((c) => c.t.tamano >= 8);
          for (let i = 0; i < grandes.length; i++)
            for (let j = i + 1; j < grandes.length; j++) {
              const [a, b] = [grandes[i], grandes[j]];
              const pisan = a.x0 < b.x1 - 0.3 && b.x0 < a.x1 - 0.3 && a.y0 < b.y1 - 0.3 && b.y0 < a.y1 - 0.3;
              expect(pisan, `«${a.t.texto}» y «${b.t.texto}» en la página ${pagina.numero}`).toBe(false);
            }
        }
      }
    });
  }

  it("a la izquierda, nombres al margen izquierdo y precios al derecho; a la derecha, todo al margen derecho; al centro, centrado", () => {
    const datos = contenido([seccion("CARNES", 4)]);
    const formato = FORMATOS.A5;
    const pagina = (alineacion: Partial<Alineacion>) => interiores(maquetarCarta(medidor, datos, "A5", { alineacion }).paginas)[0];
    const margen = formato.variantes.platos[0].lateral;
    const derecho = formato.ancho - margen;
    const centro = formato.ancho / 2;

    const izquierda = pagina({ horizontal: "izquierda" });
    expect(lineasNombre(izquierda).every((t) => Math.abs(t.x - margen) < 0.01)).toBe(true);
    expect(preciosEn(izquierda).every((t) => Math.abs(t.x + anchoDe(t) - derecho) < 0.01)).toBe(true);
    expect(titulosEn(izquierda)[0].x).toBeCloseTo(margen, 2);

    const derecha = pagina({ horizontal: "derecha" });
    expect(preciosEn(derecha).every((t) => Math.abs(t.x + anchoDe(t) - derecho) < 0.01)).toBe(true);
    // El nombre (con sus alérgenos) termina justo antes del precio, no al margen izquierdo.
    expect(lineasNombre(derecha).every((t) => t.x > margen + 20)).toBe(true);
    const titulo = titulosEn(derecha)[0];
    expect(titulo.x + anchoDe(titulo)).toBeCloseTo(derecho, 2);
    const detalles = textos(derecha).filter((t) => t.fuente === "italica");
    expect(detalles.every((t) => Math.abs(t.x + anchoDe(t) - derecho) < 0.01)).toBe(true);

    const centrada = pagina({ horizontal: "centro" });
    const tituloCentro = titulosEn(centrada)[0];
    expect(tituloCentro.x + anchoDe(tituloCentro) / 2).toBeCloseTo(centro, 2);
    expect(textos(centrada).filter((t) => t.fuente === "italica").every((t) => Math.abs(t.x + anchoDe(t) / 2 - centro) < 0.01)).toBe(true);
    // Nombre, alérgenos y precio forman una línea centrada.
    const nombre = lineasNombre(centrada)[0];
    const precio = preciosEn(centrada)[0];
    expect((nombre.x + precio.x + anchoDe(precio)) / 2).toBeCloseTo(centro, 1);
    // Sin puntos guía fuera de la alineación a la izquierda.
    expect(centrada.trazos.some((t) => t.tipo === "linea" && t.puntos)).toBe(false);
    expect(izquierda.trazos.some((t) => t.tipo === "linea" && t.puntos)).toBe(true);
  });

  it.each(TAMANOS)("en %s una sección corta guarda la letra y el aire de diseño y va arriba, en el centro o abajo, sin estirarse", (tamano) => {
    const corta = (vertical: Alineacion["vertical"]) => interiores(maquetarCarta(medidor, contenido([seccion("ARROCES", 3)]), tamano, { alineacion: { vertical } }).paginas)[0];
    const larga = interiores(maquetarCarta(medidor, contenido([seccion("ARROCES", 8)]), tamano).paginas)[0];
    const [arriba, centro, abajo] = [corta("arriba"), corta("centro"), corta("abajo")];
    // Mismo cuerpo y misma distancia entre platos que en una sección más larga: no se reparte el blanco.
    for (const pagina of [arriba, centro, abajo]) {
      expect(lineasNombre(pagina)[0].tamano).toBe(lineasNombre(larga)[0].tamano);
      expect(lineasNombre(pagina)[1].y - lineasNombre(pagina)[0].y).toBeCloseTo(lineasNombre(larga)[1].y - lineasNombre(larga)[0].y, 5);
    }
    const formato = FORMATOS[tamano];
    const y0 = formato.variantes.platos[0].superior;
    const y1 = formato.alto - formato.variantes.platos[0].inferior;
    const tituloY = (p: PaginaCarta) => titulosEn(p)[0].y;
    const ultimaY = (p: PaginaCarta) => Math.max(...textos(p).filter((t) => t.fuente === "italica").map((t) => t.y));
    expect(tituloY(arriba) - y0).toBeLessThan(20);
    expect(y1 - ultimaY(abajo)).toBeLessThan(10);
    expect(tituloY(centro)).toBeGreaterThan(tituloY(arriba) + 20);
    expect(tituloY(abajo)).toBeGreaterThan(tituloY(centro) + 20);
  });

  it("una sección vacía no tiene página", () => {
    const vacia: SeccionCarta = { clave: "VACIA", titulo: "VACIA", grupos: [{ titulo: null, elementos: [] }] };
    const { paginas, secciones } = maquetarCarta(medidor, contenido([seccion("CARNES", 3), vacia, seccion("POSTRES", 2)]));
    expect(interiores(paginas).map((p) => p.seccion)).toEqual(["CARNES", "POSTRES"]);
    expect(secciones.map((s) => s.clave)).toEqual(["CARNES", "POSTRES"]);
  });

  it.each(TAMANOS)("en %s una sección algo larga se compacta para caber en una página sin bajar del cuerpo mínimo", (tamano) => {
    const larga = seccion("MARISCOS", tamano === "A5" ? 18 : 22);
    const { paginas, secciones } = maquetarCarta(medidor, contenido([larga]), tamano);
    expect(interiores(paginas)).toHaveLength(1);
    expect(secciones[0]).toMatchObject({ cabe: true, caras: 1 });
    expect(secciones[0].cuerpo).toBeLessThan(10.5 * FORMATOS[tamano].escala.platos);
    expect(secciones[0].cuerpo).toBeGreaterThanOrEqual(CUERPO_MINIMO.nombre);
    expect(nombresEn(interiores(paginas)[0])).toHaveLength(larga.grupos[0].elementos.length);
  });

  it("los vinos: cada tipo en sus páginas en A5 y en A4, y el A4 con más letra", () => {
    const vinos = contenido([tipoVino("TINTOS", 3, 4), tipoVino("BLANCOS", 2, 3), tipoVino("ROSADOS", 1, 2)], "vinos");
    for (const tamano of TAMANOS) {
      expect(interiores(maquetarCarta(medidor, vinos, tamano).paginas).map((p) => titulosEn(p).map((t) => t.texto))).toEqual([["TINTOS"], ["BLANCOS"], ["ROSADOS"]]);
    }
    const a5 = maquetarCarta(medidor, vinos, "A5");
    const a4 = maquetarCarta(medidor, vinos, "A4");
    expect(a4.paginas[0].ancho).toBeCloseTo(595.28, 2);
    expect(a4.paginas[0].alto).toBeCloseTo(841.89, 2);
    expect(a4.secciones[0].cuerpo).toBeGreaterThan(a5.secciones[0].cuerpo);
  });

  it("una denominación nunca se queda sola al pie, y si sigue en la página siguiente lo dice", () => {
    const vinos = contenido([tipoVino("TINTOS", 14, 5)], "vinos");
    for (const tamano of TAMANOS) {
      const caras = interiores(maquetarCarta(medidor, vinos, tamano).paginas);
      expect(caras.length).toBeGreaterThan(1);
      for (const cara of caras) {
        const cabeceras = textos(cara).filter((t) => t.fuente === "italica" && mismoColor(t.color, COLORES.oro));
        const nombres = lineasNombre(cara);
        for (const cabecera of cabeceras) {
          // Debajo, al menos dos vinos (o los que queden de una denominación que sigue).
          const debajo = nombres.filter((t) => t.y > cabecera.y);
          expect(debajo.length, `${tamano} «${cabecera.texto}»`).toBeGreaterThanOrEqual(cabecera.texto.includes("(continuación)") ? 1 : 2);
        }
        // Cada página empieza con su denominación (nueva o «(continuación)»).
        const primero = Math.min(...nombres.map((t) => t.y));
        expect(cabeceras.some((c) => c.y < primero), `${tamano} página ${cara.numero}`).toBe(true);
      }
    }
  });

  it("no parte palabras por letras: si una no cabe ni en una página entera, la sección sale marcada y no se descarga", () => {
    const imposible: SeccionCarta = {
      clave: "TINTOS",
      titulo: "TINTOS",
      grupos: [{ titulo: null, elementos: [elemento(`Vino${"x".repeat(90)}`, "Zona"), elemento("Vino normal", "Zona")] }],
    };
    const maqueta = maquetarCarta(medidor, contenido([seccion("BLANCOS", 2), imposible], "vinos"));
    const caras = interiores(maqueta.paginas);
    expect(caras.find((p) => p.seccion === "BLANCOS")?.desborda).toBeUndefined();
    expect(caras.filter((p) => p.seccion === "TINTOS").every((p) => p.desborda)).toBe(true);
    expect(seccionesQueNoCaben(maqueta).map((s) => s.clave)).toEqual(["TINTOS"]);
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
      // Con la sección más apretada que aún cabe en una página, la letra sigue por encima del mínimo.
      const { paginas } = maquetarCarta(medidor, contenido([seccion("CARNES", tamano === "A5" ? 18 : 22)]), tamano);
      const cuerpo = interiores(paginas).flatMap(textos);
      expect(Math.min(...cuerpo.filter((t) => t.fuente === "seminegrita" && t.texto.length > 3).map((t) => t.tamano))).toBeGreaterThanOrEqual(CUERPO_MINIMO.nombre - 1e-9);
      expect(Math.min(...cuerpo.filter((t) => t.fuente === "italica" && t.texto.length > 3).map((t) => t.tamano))).toBeGreaterThanOrEqual(CUERPO_MINIMO.detalle - 1e-9);
    }
  });
});
