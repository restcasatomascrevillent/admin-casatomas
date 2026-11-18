/**
 * Auditoría de la tarifa real (16/11/2026), parte 2:
 *  - paquetes y contenido del nombre (P6, MINI, BANDEJA C1, C11+1, 2,100GR…);
 *  - reglas fijas antes y después de la IA (depurarCandidatas, confirmarParejas
 *    con `compras`);
 *  - la tabla del presupuesto la monta el servidor COMPLETA (tabla.ts) y el
 *    modelo solo ve el resumen (prepararPresupuesto).
 */
import { describe, expect, it, vi } from "vitest";
import {
  comprasPorProducto,
  confirmarParejas,
  contenidoDelNombre,
  depurarCandidatas,
  lineasDeHoja,
  paqueteDelNombre,
  prefiltrarLineas,
  type Candidata,
  type Filas,
} from "../hoja.ts";
import { resumenParaModelo, tablaPresupuesto, verDePregunta } from "../tabla.ts";
import { prepararPresupuesto } from "../bucle.ts";

describe("paquetes y contenido del nombre", () => {
  it("Pn es el paquete del precio (salvo en los MINI); Cn es la caja de reparto", () => {
    expect(paqueteDelNombre("CERVEZA AMSTEL 25CL 5º P6 C4")).toBe(6);
    expect(contenidoDelNombre("CERVEZA AMSTEL 25CL 5º P6 C4").cantidad).toBeCloseTo(1.5);
    expect(paqueteDelNombre("MINI GIN.LARIOS 5CL 37,5º P20 C120 PET")).toBeNull();
    expect(contenidoDelNombre("MINI GIN.LARIOS 5CL 37,5º P20 C120 PET").cantidad).toBeCloseTo(0.05);
    expect(paqueteDelNombre("GIN.BEEFEATER 70CL 40º C6 ROSCA")).toBeNull();
  });

  it("lotes enteros: 24U C1, (P6 C4) C1, C11+1, P3+1, estuche de 3", () => {
    expect(paqueteDelNombre("R.SCHWEPPES TONICA IGLU RETO 20CL 28U C1")).toBe(28);
    expect(paqueteDelNombre("AGUA FONT VELLA POCKET 33CL (P6 C4) C1")).toBe(24);
    expect(paqueteDelNombre("RON LEGENDARIO ELIXIR 70CL 34º C11+1")).toBe(12);
    expect(paqueteDelNombre("ATUN CLARO CALVO A/O RO65 P3+1 C21")).toBe(4);
    expect(paqueteDelNombre("V.EMILIO MORO CRIANZA ESTUCHE 3 BOT 75CL 14º C4")).toBe(3);
  });

  it("bandeja C1 sin decir cuántas: contenido desconocido y unidad «caja» (no se pasa a €/l)", () => {
    expect(contenidoDelNombre("R.SCHWEPPES TONICA IGLU BANDEJA 20CL C1")).toEqual({ cantidad: null, unidad: null, paquete: "desconocido" });
    const filas: Filas = [["Articulo", "Precio"], ["R.SCHWEPPES TONICA IGLU BANDEJA 20CL C1", 13.72], ["CERVEZA AMSTEL 25CL 5º P6 C4", 1.745]];
    const r = lineasDeHoja(filas, { cabecera: 0, producto: 0, precio: 1, unidad: null, formato: null, descuento: null, metodo: "cabecera" });
    expect(r.lineas[0]).toMatchObject({ unidad: "caja", contenido_cantidad: null });
    expect(r.lineas[1]).toMatchObject({ unidad: "ud", contenido_cantidad: 1.5, contenido_unidad: "l", envases: 6 });
  });

  it("«2,100GR» son 2,1 kg (antes 2,1 g)", () => {
    expect(contenidoDelNombre("TOMATE FRITO ORLANDO BRIK 2,100GR C6")).toEqual({ cantidad: 2.1, unidad: "kg" });
  });
});

describe("prefiltro: falsos negativos de la auditoría", () => {
  it("una marca rara basta aunque solo comparta esa palabra («Valbuena», «Mauro»)", () => {
    const compras = [
      { n: "TINTO VALBUENA 5º 75CL", p: 1, c: "Tinto Valbuena 5º 75 cl" },
      { n: "Mauro 75 cl", p: 2, c: "Mauro 75 cl" },
      ...Array.from({ length: 40 }, (_, i) => ({ n: `TINTO CRIANZA RIOJA ${i}`, p: 100 + i, c: `Tinto crianza ${i}` })),
    ];
    const c = prefiltrarLineas([{ producto: "V.VALBUENA 5ºA 75CL C6" }, { producto: "V.MAURO CRIANZA 75CL 14,5º C6" }, { producto: "V.TINTO DE LA CASA 75CL" }], compras);
    expect(c.map((x) => [x.i, x.producto_id])).toEqual([[0, 1], [1, 2]]);
  });
});

describe("reglas fijas alrededor de la IA", () => {
  const lineas = [
    { producto: "GIN.BEEFEATER 0,0% SIN ALCOHOL 70CL C6" },
    { producto: "GIN.HENDRICKS LUNAR 70CL 44º C6" },
    { producto: "MINI GIN.HENDRICKS 5CL 41,4º C96 CRIS" },
    { producto: "GIN.TANQUERAY TEN 70CL 47,3º C6" },
  ];
  const op = (id: number, c: string) => ({ producto_id: id, producto_catalogo: c, nombre_compra: c.toUpperCase(), cobertura: 1, similitud: 0.9, trigramas: 0.8 });
  const cand = (i: number, ops: ReturnType<typeof op>[]): Candidata => ({
    i, producto_id: ops[0].producto_id, producto_catalogo: ops[0].producto_catalogo, cobertura: 1, similitud: 0.9, confianza: "alta", opciones: ops,
  });
  const compras = comprasPorProducto([
    { n: "GIN BEEFEATER 70CL", p: 1, c: "Beefeater 70 cl" },
    { n: "GIN BEEFEATER 0,0", p: 2, c: "Gin Beefeater 0,0 70 cl" },
    { n: "GIN HENDRICKS 70CL", p: 3, c: "Hendrick's 70 cl" },
    { n: "GIN TANQUERAY 70CL", p: 4, c: "Tanqueray 70 cl" },
  ]);

  it("depurarCandidatas quita las opciones que son otro producto y elige la que queda", () => {
    const r = depurarCandidatas(lineas, [cand(0, [op(1, "Beefeater 70 cl"), op(2, "Gin Beefeater 0,0 70 cl")]), cand(1, [op(3, "Hendrick's 70 cl")])], compras);
    expect(r.candidatas).toHaveLength(1);
    expect(r.candidatas[0]).toMatchObject({ i: 0, producto_id: 2 });
    expect(r.rechazos).toEqual([expect.objectContaining({ linea: lineas[1].producto, decision: "otro_producto" })]);
  });

  it("aunque la IA diga «mismo formato», un mini no se compara y una edición sale como «Revisar»", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ parejas: [
        { id: 2, opcion: 1, decision: "mismo_formato", motivo: "" },
        { id: 3, opcion: 1, decision: "mismo_formato", motivo: "" },
      ] }) } }],
    }), { status: 200 })) as unknown as typeof fetch;
    const r = await confirmarParejas(lineas, [cand(2, [op(3, "Hendrick's 70 cl")]), cand(3, [op(4, "Tanqueray 70 cl")])], { clave: "k", fetchImpl: f, compras });
    expect(r.candidatas.map((c) => [c.i, c.confianza])).toEqual([[2, "formato_distinto"], [3, "media"]]);
    expect(r.candidatas[0].nota).toBe("5 cl frente a 70 cl");
    expect(r.candidatas[1].nota).toContain("ten");
  });
});

const RESULTADO = {
  proveedor: null,
  archivo: "tarifa.xlsx",
  descuento: { tipo: "porcentaje", pct: 15 },
  resumen: { lineas_total: 2669, lineas_que_compras: 5, no_los_compras: 2664, productos_interesa: 1, ahorro_anual_interesa: 216.35, interesa: 2, revisar: 2, no_interesa: 1 },
  lineas: [
    { producto: "GIN.BEEFEATER 70CL 40º C6 ROSCA", coincide_con: "Beefeater 70 cl", unidad: "l", oferta: 10.92, ultimo: { precio: 14.43, proveedor: "Prov A", fecha: "2026-08-14" }, media_12m: { precio: 16.13, compras: 4 }, mejor_actual: { precio: 14.43, proveedor: "Prov A" }, dif_pct: -24.3, ahorro_anual: 216.35, veredicto: "Interesa" },
    { producto: "GIN.BEEFEATER 70CL 40º C12 N/REF", coincide_con: "Beefeater 70 cl", unidad: "l", oferta: 12.08, ultimo: { precio: 14.43, proveedor: "Prov A" }, dif_pct: -16.3, ahorro_anual: 144.54, veredicto: "Interesa", otra_referencia: true },
    { producto: "MINI GIN | RARO 5CL", coincide_con: "Gin 70 cl", veredicto: "Revisar", motivo: "formato_distinto", nota: "5 cl frente a 70 cl" },
    { producto: "R.SCHWEPPES TONICA IGLU BANDEJA 20CL C1", coincide_con: "Schweppes Tónica Iglu 20 cl", veredicto: "Revisar", motivo: "unidades_distintas", unidades_en_historial: ["l", "ud"] },
    { producto: "V.CARMELO RODERO CRIANZA 75CL", coincide_con: "Carmelo Rodero Crianza 75 cl", unidad: "l", oferta: 19.27, ultimo: { precio: 18.73, proveedor: "Prov B" }, dif_pct: 2.8, veredicto: "No interesa" },
  ],
};

describe("tablaPresupuesto (la tabla completa la monta el servidor)", () => {
  it("por defecto solo Interesa (sin la otra referencia), con el total y el aviso de lo que queda", () => {
    const t = tablaPresupuesto(RESULTADO);
    expect(t).toContain("**Ahorro estimado al año: 216,35 €**");
    expect(t).toContain("### Interesa: los 1 que más ahorran (de 1)");
    expect(t).not.toContain("C12 N/REF");
    expect(t).not.toContain("### Revisar");
    expect(t).toContain("2 para revisar a mano");
    expect(t).toContain("1 que no interesan");
    expect(t).toContain("descuento del 15 %");
    expect(t).toContain("2.669 artículos");
    for (const bloque of t.split("\n\n").filter((b) => b.startsWith("|"))) {
      const filas = bloque.split("\n");
      const n = filas[0].split("|").length;
      for (const f of filas) expect(f.split("|").length).toBe(n);
    }
  });

  it("«ver los de Revisar» y «ver los que no interesan» enseñan esa tabla", () => {
    const r = tablaPresupuesto(RESULTADO, "revisar");
    expect(r).toContain("### Revisar (2)");
    expect(r).toContain("5 cl frente a 70 cl");
    expect(r).toContain("se compra en otra unidad (l, ud)");
    expect(r).toContain("| MINI GIN RARO 5CL |"); // una barra en un nombre no rompe la tabla
    expect(r).not.toContain("### Interesa");
    expect(tablaPresupuesto(RESULTADO, "no_interesa")).toContain("CARMELO RODERO");
    expect(verDePregunta("enséñame los de Revisar")).toBe("revisar");
    expect(verDePregunta("ver los que no interesan")).toBe("no_interesa");
    expect(verDePregunta("sin descuento")).toBe("interesa");
  });

  it("con la tarifa real (161 interesan, 299 revisar) la tabla por defecto cabe en el móvil: 30 filas y pocos caracteres", () => {
    const lineas = [
      ...Array.from({ length: 161 }, (_, i) => ({ producto: `ARTICULO NUMERO ${i} CON UN NOMBRE LARGO DE TARIFA 70CL C6`, coincide_con: "Producto del catalogo 70 cl", unidad: "ud", oferta: 10.5, ultimo: { precio: 12.25, proveedor: "Proveedor largo SL", fecha: "2026-10-01" }, dif_pct: -14.3, ahorro_anual: 500 - i, veredicto: "Interesa" })),
      ...Array.from({ length: 299 }, (_, i) => ({ producto: `REVISAR ${i} 70CL`, coincide_con: "Otro 33 cl", veredicto: "Revisar", motivo: "formato_distinto", nota: "33 cl frente a 70 cl" })),
      ...Array.from({ length: 4 }, (_, i) => ({ producto: `NO INTERESA ${i}`, oferta: 5, ultimo: { precio: 4 }, dif_pct: 25, veredicto: "No interesa" })),
    ];
    const t = tablaPresupuesto({ ...RESULTADO, lineas, resumen: { ...RESULTADO.resumen, lineas_total: 2669, ahorro_anual_interesa: 12085.68, productos_interesa: 161 } });
    const filas = t.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Producto"));
    expect(filas).toHaveLength(30);
    expect(t.length).toBeLessThan(6_000);
    expect(t).toContain("otros 131 que interesan");
    // Ordenadas por ahorro: la primera es la que más ahorra.
    expect(filas[0]).toContain("ARTICULO NUMERO 0 ");
  });

  it("descuento por importe: explica cómo se ha repartido", () => {
    const t = tablaPresupuesto({ ...RESULTADO, descuento: { tipo: "importe", importe: 500, pct_equivalente: 0.57, aviso: "El importe fijo se ha repartido en proporcion al gasto de los ultimos 12 meses." } });
    expect(t).toContain("descuento de 500,00 € (0,57 %)");
    expect(t).toContain("repartido en proporcion al gasto");
  });

  it("al modelo solo le llega el resumen y las mejores (sin la otra referencia)", () => {
    const r = resumenParaModelo(RESULTADO);
    expect(r.mejores).toHaveLength(1);
    expect(r.mejores[0]).toMatchObject({ producto: "Beefeater 70 cl", ahorro_anual: 216.35 });
    expect(JSON.stringify(r)).not.toContain("CARMELO");
  });

  it("prepararPresupuesto: con error no hay tabla (el modelo ve el error)", () => {
    expect(prepararPresupuesto({ error: "No hay ningun presupuesto adjunto" })).toBeNull();
    expect(prepararPresupuesto(RESULTADO)?.tabla).toContain("### Interesa");
    expect(prepararPresupuesto(RESULTADO, "revisar")?.tabla).toContain("### Revisar");
  });
});
