/**
 * Paginación de la carta impresa: nada se sale de los márgenes, ningún plato
 * se parte ni se pierde, ninguna cabecera queda sola al pie, una categoría que
 * sigue en la columna siguiente lo dice y no deja un plato solo, y el A4 es
 * A4 (con dos columnas en vinos) y no un A5 ampliado.
 */
import { describe, expect, it } from "vitest";
import type { ContenidoCarta, ElementoCarta, SeccionCarta } from "../datos";
import { COLORES, FORMATOS, maquetarCarta, mm, type Medidor, type PaginaCarta, type TamanoCarta, type Trazo } from "../maquetacion";

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

const seccion = (titulo: string, n: number, paginaNueva = false): SeccionCarta => ({
  clave: titulo,
  titulo,
  paginaNueva,
  grupos: [{ titulo: null, elementos: Array.from({ length: n }, (_, i) => elemento(`${titulo} ${i + 1}`)) }],
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
  textos(pagina).filter((t) => t.fuente === "regular" && mismoColor(t.color, COLORES.oro) && (t.espaciado ?? 0) > 0);

describe("maquetarCarta", () => {
  it("portada, interiores y contraportada en A5 (419,53 × 595,28 pt)", () => {
    const paginas = maquetarCarta(medidor, contenido([seccion("CARNES", 6)]));
    expect(paginas[0].tipo).toBe("portada");
    expect(paginas[paginas.length - 1].tipo).toBe("contraportada");
    expect(paginas.map((p) => p.numero)).toEqual(paginas.map((_, i) => i + 1));
    for (const pagina of paginas) {
      expect(pagina.ancho).toBeCloseTo(419.53, 2);
      expect(pagina.alto).toBeCloseTo(595.28, 2);
    }
  });

  it.each(["A5", "A4"] as TamanoCarta[])("en %s todo cabe dentro de los márgenes y no se pierde ni repite ningún plato", (tamano) => {
    const secciones = [seccion("NOVEDADES", 9), seccion("ENTRANTES", 14), seccion("CARNES", 3), seccion("POSTRES", 11)];
    const paginas = maquetarCarta(medidor, contenido(secciones), tamano);
    const formato = FORMATOS[tamano];
    const interiores = paginas.filter((p) => p.tipo === "interior");
    expect(interiores.length).toBeGreaterThan(1);
    for (const pagina of interiores) {
      for (const t of textos(pagina)) {
        const esPie = t.texto === String(pagina.numero);
        if (!esPie) expect(t.y).toBeLessThanOrEqual(formato.alto - formato.margenInferior + 0.01);
        expect(t.x).toBeGreaterThanOrEqual(formato.margenLateral.platos - 0.01);
        expect(t.x + medidor.ancho(t.texto, t.fuente, t.tamano, t.espaciado)).toBeLessThanOrEqual(formato.ancho - formato.margenLateral.platos + 0.01);
      }
    }
    const todos = interiores.flatMap(nombresEn);
    const esperados = secciones.flatMap((s) => s.grupos[0].elementos.map((e) => e.nombre));
    expect(todos).toEqual(esperados);
  });

  it("una cabecera nunca se queda sola al pie: debajo, en su página, van sus platos", () => {
    // Muchas secciones cortas: alguna cae siempre cerca del pie.
    const secciones = Array.from({ length: 12 }, (_, i) => seccion(`SECCION ${String.fromCharCode(65 + i)}`, 2 + (i % 4)));
    const paginas = maquetarCarta(medidor, contenido(secciones)).filter((p) => p.tipo === "interior");
    for (const pagina of paginas) {
      for (const titulo of titulosEn(pagina)) {
        const debajo = textos(pagina).filter(
          (t) => t.fuente === "seminegrita" && mismoColor(t.color, COLORES.pizarra) && t.y > titulo.y && t.texto.startsWith(titulo.texto.split(" ").slice(0, 2).join(" ")),
        );
        expect(debajo.length, `«${titulo.texto}» en la página ${pagina.numero}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("si una categoría sigue en la página siguiente lo dice, y allí no queda un plato solo", () => {
    for (let n = 8; n <= 24; n++) {
      const paginas = maquetarCarta(medidor, contenido([seccion("PESCADOS", n)])).filter((p) => p.tipo === "interior");
      if (paginas.length < 2) continue;
      const ultima = paginas[paginas.length - 1];
      expect(textos(ultima).some((t) => t.texto === "(continuación)"), `n=${n}`).toBe(true);
      expect(nombresEn(ultima).length, `n=${n}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("los vinos empiezan cada tipo en página nueva en A5 y van a dos columnas en A4", () => {
    const vinos = contenido([seccion("TINTOS", 5, true), seccion("BLANCOS", 4, true)], "vinos");
    const a5 = maquetarCarta(medidor, vinos, "A5").filter((p) => p.tipo === "interior");
    expect(a5.map((p) => titulosEn(p).map((t) => t.texto))).toEqual([["TINTOS"], ["BLANCOS"]]);

    const largos = contenido([seccion("TINTOS", 60, true)], "vinos");
    const a4 = maquetarCarta(medidor, largos, "A4");
    expect(a4[0].ancho).toBeCloseTo(595.28, 2);
    expect(a4[0].alto).toBeCloseTo(841.89, 2);
    const columnas = new Set(nombresEn(a4[1]).length ? textos(a4[1]).filter((t) => t.fuente === "seminegrita" && mismoColor(t.color, COLORES.pizarra)).map((t) => Math.round(t.x)) : []);
    expect(columnas.size).toBe(2);
    // Los mismos vinos caben en menos páginas A4 que A5, con letra mayor.
    const a5Largos = maquetarCarta(medidor, largos, "A5");
    expect(a4.length).toBeLessThan(a5Largos.length);
    const cuerpo = (paginas: PaginaCarta[]) => textos(paginas[1]).find((t) => t.fuente === "seminegrita")!.tamano;
    expect(cuerpo(a4)).toBeGreaterThan(cuerpo(a5Largos));
  });

  it("el cuerpo de texto es de 9 pt o más y los márgenes de 12 mm o más", () => {
    for (const tamano of ["A5", "A4"] as TamanoCarta[]) {
      const paginas = maquetarCarta(medidor, contenido([seccion("CARNES", 6)]), tamano);
      const cuerpo = paginas.filter((p) => p.tipo === "interior").flatMap(textos).filter((t) => t.fuente !== "regular" || t.tamano > 8.6);
      // Nombres, precios y descripciones (los números de alérgenos son llamadas, no cuerpo).
      expect(Math.min(...cuerpo.filter((t) => t.texto.length > 3).map((t) => t.tamano))).toBeGreaterThanOrEqual(9);
      const formato = FORMATOS[tamano];
      expect(Math.min(formato.margenLateral.platos, formato.margenLateral.vinos, formato.margenSuperior, formato.margenInferior)).toBeGreaterThanOrEqual(mm(12));
    }
  });
});
