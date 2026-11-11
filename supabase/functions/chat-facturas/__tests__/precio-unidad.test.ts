/**
 * Precio por unidad de compra por defecto (dueño, 11/11/2026): «la botella de
 * 75 cl», «el magnum de 1,5 l», «la caja de 6 botellas»… Solo en €/l o €/kg si
 * la pregunta lo pide («precio por litro», «€/kg», «a cuánto sale el kilo»).
 * El desvio a volumen_comprado de las preguntas de litro/kilo no cambia.
 */
import { describe, expect, it } from "vitest";
import {
  type Asociacion,
  NOTA_PRECIO_POR_VOLUMEN,
  NOTA_PRECIO_UNIDAD_COMPRA,
  NOTA_RESPUESTA_VOLUMEN,
  NOTA_RESPUESTA_VOLUMEN_LITRO,
  prepararLlamada,
  systemPrompt,
} from "../herramientas.ts";

const VINOS: Asociacion = { tipo: "familia", categoria: "Vinos", familia: "Bebidas" };
const RIOJA: Asociacion = { tipo: "producto", categoria: "Vinos", familia: "Bebidas" };

const notaDe = (ll: ReturnType<typeof prepararLlamada>) => (ll.tipo === "rpc" ? ll.notaRespuesta : undefined);

describe("por defecto: precio por unidad de compra con su formato", () => {
  it.each([
    ["compras_producto", { producto: "Ramón Bilbao" }, "¿a cuánto compro el Ramón Bilbao?", "compras_producto_agente"],
    ["historial_precios", { producto: "Ramón Bilbao" }, "precio del Ramón Bilbao por proveedor", "historial_precios_agente"],
    ["grafico_precio", { producto: "Ramón Bilbao" }, "enséñame el precio del Ramón Bilbao", "serie_precios_agente"],
    ["ranking", { criterio: "precio_unitario", categoria: "vinos" }, "¿cuál es el vino más caro?", "ranking_agente"],
  ])("%s: misma RPC y nota de unidad de compra", (herr, args, q, rpc) => {
    const ll = prepararLlamada(herr, args, q, RIOJA);
    expect(ll).toMatchObject({ tipo: "rpc", rpc });
    expect(notaDe(ll)).toBe(NOTA_PRECIO_UNIDAD_COMPRA);
  });

  it("la nota pide el formato (botella de 75 cl, magnum, bandeja, caja de 6) y prohibe convertir", () => {
    expect(NOTA_PRECIO_UNIDAD_COMPRA).toMatch(/botella de 75 cl/);
    expect(NOTA_PRECIO_UNIDAD_COMPRA).toMatch(/magnum de 1,5 l/);
    expect(NOTA_PRECIO_UNIDAD_COMPRA).toMatch(/bandeja de 500 g/);
    expect(NOTA_PRECIO_UNIDAD_COMPRA).toMatch(/caja de 6 botellas/);
    expect(NOTA_PRECIO_UNIDAD_COMPRA).toMatch(/no uses precio_comparable ni conviertas a litro\/kilo/);
  });

  it("una familia (vino) va a volumen_comprado, pero sin «precio» por litro", () => {
    const ll = prepararLlamada("compras_producto", { producto: "vino" }, "¿a cuánto compramos el vino?", VINOS);
    expect(ll).toMatchObject({ rpc: "volumen_comprado_agente", params: { p_categoria: "Vinos" } });
    expect(notaDe(ll)).toBe(NOTA_RESPUESTA_VOLUMEN);
    expect(NOTA_RESPUESTA_VOLUMEN).toMatch(/no piden €\/l ni €\/kg/);
    expect(NOTA_RESPUESTA_VOLUMEN).not.toMatch(/«precio» es € por litro\/kilo/);
  });

  it("volumen_comprado directo sin pregunta de precio por litro: nota por defecto", () => {
    const ll = prepararLlamada("volumen_comprado", { categoria: "vino", producto: null }, "¿cuántas botellas de vino compramos?");
    expect(notaDe(ll)).toBe(NOTA_RESPUESTA_VOLUMEN);
  });

  it("otros rankings (cantidad de algo que no es familia, importe) no llevan nota de precio", () => {
    const ll = prepararLlamada("ranking", { criterio: "importe_documento" }, "la factura más cara");
    expect(notaDe(ll)).toBeUndefined();
  });

  it("el prompt lo dice en la regla 14", () => {
    expect(systemPrompt("2026-11-11")).toMatch(/14\. Precio por unidad de compra y su formato .*€\/l o €\/kg solo si lo piden/);
  });
});

describe("pidiendo litro o kilo: €/l o €/kg", () => {
  it.each([
    ["compras_producto", { producto: "Ramón Bilbao" }, "¿a cuánto me sale el litro de Ramón Bilbao?"],
    ["historial_precios", { producto: "Ramón Bilbao" }, "precio por litro del Ramón Bilbao"],
    ["compras_producto", { producto: "gamba roja" }, "¿a cuánto sale el kilo de gamba roja?"],
    ["historial_precios", { producto: "pulpo" }, "pulpo en €/kg"],
  ])("%s: sigue desviandose a volumen_comprado con «precio» en €/l o €/kg", (herr, args, q) => {
    const ll = prepararLlamada(herr, args, q, RIOJA);
    expect(ll).toMatchObject({ rpc: "volumen_comprado_agente", params: { p_texto: args.producto, p_categoria: null } });
    expect(notaDe(ll)).toBe(NOTA_RESPUESTA_VOLUMEN_LITRO);
    expect(NOTA_RESPUESTA_VOLUMEN_LITRO).toMatch(/«precio» es € por litro\/kilo SIN IVA/);
  });

  it("familia con pregunta de litro: volumen_comprado y € por litro", () => {
    const ll = prepararLlamada("compras_producto", { producto: "vino" }, "precio del litro de vino por proveedor", VINOS);
    expect(ll).toMatchObject({ rpc: "volumen_comprado_agente", params: { p_categoria: "Vinos" } });
    expect(notaDe(ll)).toBe(NOTA_RESPUESTA_VOLUMEN_LITRO);
  });

  it("lo que no se desvia (grafica, ranking de un producto) usa precio_comparable", () => {
    const g = prepararLlamada("grafico_precio", { producto: "jamón" }, "gráfica del precio del kilo de jamón", null);
    expect(g).toMatchObject({ rpc: "serie_precios_agente" });
    expect(notaDe(g)).toBe(NOTA_PRECIO_POR_VOLUMEN);
    const r = prepararLlamada("ranking", { criterio: "precio_unitario", categoria: "jamón" }, "¿qué jamón me sale más caro el kilo?", null);
    expect(r).toMatchObject({ rpc: "ranking_agente" });
    expect(notaDe(r)).toBe(NOTA_PRECIO_POR_VOLUMEN);
    expect(NOTA_PRECIO_POR_VOLUMEN).toMatch(/precio_comparable/);
    expect(NOTA_PRECIO_POR_VOLUMEN).toMatch(/convertido desde caja de 10 kg/);
  });
});
