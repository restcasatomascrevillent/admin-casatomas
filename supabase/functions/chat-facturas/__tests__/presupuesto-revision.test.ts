/**
 * Revisión en producción del comparador de presupuestos (18/11/2026), con los nombres reales de la revisión
 * (facturas-conocimiento/presupuestos/revision-produccion-2026-11-18.md):
 *  3. la IA de confirmación no pierde parejas buenas (C6 frente a C12, 1 L frente a 70 cl, Beefeater 0,0,
 *     Tanqueray Ten) y no reabre los falsos positivos del 16/11.
 */
import { describe, expect, it, vi } from "vitest";
import { comprasPorProducto, confirmarParejas, depurarCandidatas, PROMPT_CONFIRMAR, type Candidata, type Opcion } from "../hoja.ts";

const op = (id: number, c: string, factura = c.toUpperCase()): Opcion => ({ producto_id: id, producto_catalogo: c, nombre_compra: factura, cobertura: 1, similitud: 0.95, trigramas: 0.8 });
const cand = (i: number, ops: Opcion[], confianza: Candidata["confianza"] = "alta"): Candidata => ({
  i, producto_id: ops[0].producto_id, producto_catalogo: ops[0].producto_catalogo, cobertura: 1, similitud: 0.95, confianza, opciones: ops,
});
const iaDice = (parejas: Array<{ id: number; opcion: number | null; decision: string; motivo: string }>) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ parejas }) } }] }), { status: 200 })) as unknown as typeof fetch;

const compras = comprasPorProducto([
  { n: "WHISKY JOHNNIE WALKER ETIQUETA NEGRA 70CL", p: 1, c: "Johnnie Walker Black Label 70 cl" },
  { n: "BAILEYS 70 CL", p: 2, c: "Baileys 70 cl" },
  { n: "BAILEYS 1 L", p: 3, c: "Baileys 1 L" },
  { n: "GIN BEEFEATER 0,0 70CL", p: 4, c: "Gin Beefeater 0,0 70 cl" },
  { n: "GIN BEEFEATER 70CL", p: 5, c: "Beefeater 70 cl" },
  { n: "GIN TANQUERAY TEN 70CL", p: 6, c: "Tanqueray Ten 70 cl" },
  { n: "GIN TANQUERAY 70CL", p: 7, c: "Tanqueray 70 cl" },
  { n: "GIN HENDRICKS 70CL", p: 8, c: "Hendrick's 70 cl" },
  { n: "CHAMPAN LAURENT PERRIER ROSE 75CL", p: 9, c: "Laurent-Perrier Rosé 75 cl" },
  { n: "VINO PAGO DE CAPELLANES 75CL", p: 10, c: "Pago de Capellanes 75 cl" },
  { n: "VINO PAGO DE CAPELLANES MAGNUM", p: 11, c: "Pago de Capellanes Magnum" },
]);

describe("confirmarParejas: la IA no pierde parejas buenas (revisión 18/11/2026)", () => {
  it("«C6 frente a C12»: la caja de reparto no cambia el producto (JW Black)", async () => {
    const lineas = [{ producto: "WHISKY.JOHNNIE WALKER E/N 70CL 40º C6" }];
    const f = iaDice([{ id: 0, opcion: 1, decision: "formato_distinto", motivo: "C6 vs C12" }]);
    const r = await confirmarParejas(lineas, [cand(0, [op(1, "Johnnie Walker Black Label 70 cl")])], { clave: "k", fetchImpl: f, compras });
    expect(r.candidatas[0]).toMatchObject({ i: 0, producto_id: 1, confianza: "alta" });
    expect(r.rechazos).toEqual([]);
  });

  it("«1 L frente a 70 cl» cuando el catálogo tiene el de 1 L (Baileys 1 L)", async () => {
    const lineas = [{ producto: "L.BAILEYS 1L 17º C12" }];
    const c = cand(0, [op(2, "Baileys 70 cl"), op(3, "Baileys 1 L")]);
    const dep = depurarCandidatas(lineas, [c], compras);
    expect(dep.candidatas[0].opciones[0].producto_id).toBe(3); // la del tamaño bueno, primero
    // Aunque la IA elija la de 70 cl y diga «otro tamaño», gana la de 1 L.
    const f = iaDice([{ id: 0, opcion: 2, decision: "formato_distinto", motivo: "1 L vs 70 cl" }]);
    const r = await confirmarParejas(lineas, dep.candidatas, { clave: "k", fetchImpl: f, compras });
    expect(r.candidatas[0]).toMatchObject({ producto_id: 3, confianza: "alta" });
  });

  it("Beefeater 0,0 y Tanqueray Ten: la IA los descartaba y eran pares correctos", async () => {
    const lineas = [{ producto: "GIN.BEEFEATER 0,0% 70CL C6" }, { producto: "GIN.TANQUERAY TEN 70CL 47,3º C6" }];
    const dep = depurarCandidatas(lineas, [cand(0, [op(5, "Beefeater 70 cl"), op(4, "Gin Beefeater 0,0 70 cl")]), cand(1, [op(7, "Tanqueray 70 cl"), op(6, "Tanqueray Ten 70 cl")])], compras);
    const f = iaDice([
      { id: 0, opcion: null, decision: "otro_producto", motivo: "sin alcohol" },
      { id: 1, opcion: null, decision: "otro_producto", motivo: "edicion Ten" },
    ]);
    const r = await confirmarParejas(lineas, dep.candidatas, { clave: "k", fetchImpl: f, compras });
    expect(r.candidatas.map((c) => [c.i, c.producto_id, c.confianza])).toEqual([[0, 4, "alta"], [1, 6, "alta"]]);
  });

  it("Tanqueray Ten sin tamaño en el catálogo: no se pierde, sale en «Revisar»", async () => {
    const c2 = comprasPorProducto([{ n: "GIN TANQUERAY TEN", p: 12, c: "Ginebra Tanqueray Ten" }]);
    const lineas = [{ producto: "GIN.TANQUERAY TEN 70CL 47,3º C6" }];
    const f = iaDice([{ id: 0, opcion: null, decision: "otro_producto", motivo: "edicion Ten" }]);
    const r = await confirmarParejas(lineas, [cand(0, [op(12, "Ginebra Tanqueray Ten")])], { clave: "k", fetchImpl: f, compras: c2 });
    expect(r.candidatas[0]).toMatchObject({ producto_id: 12, confianza: "media" });
    expect(r.candidatas[0].nota).toContain("tamaño");
  });

  it("no reabre los falsos positivos del 16/11: Hendrick's Lunar, minis, magnum frente a 75 cl, Mateus frente a Laurent-Perrier", async () => {
    const lineas = [
      { producto: "GIN.HENDRICKS LUNAR 70CL 44º C6" },
      { producto: "MINI GIN.HENDRICKS 5CL 41,4º C96 CRIS" },
      { producto: "V.PAGO DE CAPELLANES MAGNUM 1,5L" },
      { producto: "CHA.MATEUS ROSE 75CL" },
    ];
    const dep = depurarCandidatas(lineas, [
      cand(0, [op(8, "Hendrick's 70 cl")]), cand(1, [op(8, "Hendrick's 70 cl")]),
      cand(2, [op(10, "Pago de Capellanes 75 cl")]), cand(3, [op(9, "Laurent-Perrier Rosé 75 cl")], "media"),
    ], compras);
    // La IA, generosa, lo da todo por bueno: las reglas mandan.
    const f = iaDice(lineas.map((_, i) => ({ id: i, opcion: 1, decision: "mismo_formato", motivo: "" })));
    const r = await confirmarParejas(lineas, dep.candidatas, { clave: "k", fetchImpl: f, compras });
    const por = new Map(r.candidatas.map((c) => [c.i, c.confianza]));
    expect(por.get(0)).toBeUndefined();          // Lunar: otro producto
    expect(por.get(1)).toBe("formato_distinto"); // mini de 5 cl
    expect(por.get(2)).toBe("formato_distinto"); // magnum frente a 75 cl
    expect(por.get(3)).not.toBe("alta");         // Mateus: como mucho «Revisar»
    // Y si la IA los descarta, siguen descartados (el rescate solo vale con reglas limpias, tamaño igual y texto «alta»).
    const f2 = iaDice(lineas.map((_, i) => ({ id: i, opcion: null, decision: "otro_producto", motivo: "otro" })));
    const r2 = await confirmarParejas(lineas, dep.candidatas, { clave: "k", fetchImpl: f2, compras });
    expect(r2.candidatas.filter((c) => c.confianza === "alta")).toEqual([]);
  });

  it("el prompt ya no deja el ejemplo «Tanqueray Ten» como si fuera siempre otro producto y ordena ignorar Cn", () => {
    expect(PROMPT_CONFIRMAR).toContain("«Tanqueray Ten» y «Tanqueray Ten 70 cl»");
    expect(PROMPT_CONFIRMAR).toMatch(/C6 frente a C12/);
  });
});
