/**
 * Asociacion de terminos y precio por litro (07/11/2026, migracion
 * 20261107100000_chat_facturas_asociacion). Fallos reales del dueño en la demo
 * v0.332:
 *  · «comparativa de a cuanto compro el litro de cerveza de todos los
 *    proveedores en el ultimo año» → «no hay cerveza en litros, solo mostaza de
 *    cerveza» (el modelo uso una herramienta de producto por texto);
 *  · «hazme la comparativa» (tras «cuantos litros de cerveza») → lo mismo;
 *  · «cuanto me he gastado en vino en el ultimo mes» → «el vino no esta separado».
 * Se simulan las llamadas que haria el modelo: cualquiera que elija acaba en la
 * RPC correcta con los parametros correctos.
 */
import { describe, expect, it } from "vitest";
import {
  type Asociacion,
  MODELO_POR_DEFECTO,
  mesesIncompletosRecientes,
  modeloChat,
  NOTA_RESPUESTA_VOLUMEN,
  parametrosModelo,
  pidePrecioPorVolumen,
  pistaPregunta,
  prepararLlamada,
  systemPrompt,
  textoAsociable,
} from "../herramientas.ts";

const CERVEZAS: Asociacion = { tipo: "familia", categoria: "Cervezas", familia: "Bebidas" };
const VINOS: Asociacion = { tipo: "familia", categoria: "Vinos", familia: "Bebidas" };
const MARISCO: Asociacion = { tipo: "familia", categoria: "Marisco", familia: "Pescado y marisco" };
const LIMPIEZA: Asociacion = { tipo: "familia", categoria: "Limpieza y desechables", familia: "Limpieza y desechables" };
const CRUZCAMPO: Asociacion = { tipo: "producto", categoria: "Cervezas", familia: "Bebidas" };
const GAMBA: Asociacion = { tipo: "producto", categoria: "Marisco", familia: "Pescado y marisco" };

const ULTIMO_ANO = { desde: "2025-11-07", hasta: "2026-11-07" };

describe("pidePrecioPorVolumen", () => {
  it.each([
    "hazme una comparativa de a cuánto estoy comprando el litro de cerveza de todos los proveedores en el último año",
    "comparativa del precio del litro de cerveza por proveedor en el último año",
    "a cuánto me sale el litro de Cruzcampo de barril frente al botellín",
    "precio del litro de vino por proveedor",
    "kilos de gamba roja y precio por kilo",
    "cuánto pago el kilo de pulpo",
    "€/l de la cerveza",
    "qué litros de cerveza me salen más caros",
  ])("sí: %s", (q) => expect(pidePrecioPorVolumen(q)).toBe(true));

  it.each([
    "cuántos litros de cerveza he comprado",
    "cuántos kilos de gamba he comprado por proveedor",
    "precio de la merluza",
    "hazme la comparativa",
    "",
  ])("no: %s", (q) => expect(pidePrecioPorVolumen(q)).toBe(false));
});

describe("textoAsociable", () => {
  it("toma el texto de las herramientas por producto o categoria", () => {
    expect(textoAsociable("compras_producto", { producto: " cerveza " })).toBe("cerveza");
    expect(textoAsociable("historial_precios", { producto: "vino" })).toBe("vino");
    expect(textoAsociable("grafico_precio", { producto: "gamba" })).toBe("gamba");
    expect(textoAsociable("variacion_precios", { producto: "cerveza", categoria: null })).toBe("cerveza");
    expect(textoAsociable("buscar_productos", { consulta: "birra" })).toBe("birra");
    expect(textoAsociable("ranking", { criterio: "cantidad", categoria: "vino" })).toBe("vino");
    expect(textoAsociable("gasto_por_categoria", { categoria: "vino" })).toBeNull(); // categoria_agente ya asocia
    expect(textoAsociable("estadisticas_globales", {})).toBeNull();
  });
});

describe("precio del litro de cerveza por proveedor (fallo real v0.332)", () => {
  const q = "hazme una comparativa de a cuánto estoy comprando el litro de cerveza de todos los proveedores en el último año";

  it.each([
    ["historial_precios", { producto: "cerveza" }],
    ["compras_producto", { producto: "cerveza", ...ULTIMO_ANO, tipo: null, orden: null, excluir: null, unidad: null }],
    ["grafico_precio", { producto: "cerveza", ...ULTIMO_ANO, unidad: null }],
    ["buscar_productos", { consulta: "cerveza" }],
  ])("%s('cerveza') acaba en volumen_comprado por la familia Cervezas", (herr, args) => {
    const ll = prepararLlamada(herr, args, q, CERVEZAS);
    expect(ll).toMatchObject({ tipo: "rpc", rpc: "volumen_comprado_agente" });
    if (ll.tipo !== "rpc") throw new Error("rpc");
    expect(ll.params.p_categoria).toBe("Cervezas");
    expect(ll.params.p_texto).toBeNull();
    expect(ll.notaRespuesta).toMatch(/PRECIO/);
    expect(ll.nota).toMatch(/volumen_comprado por categoria/);
  });

  it("con el periodo que pidio (ultimo año) y sin la BD (lista corta de bebidas) tambien", () => {
    const ll = prepararLlamada("compras_producto", { producto: "cerveza", ...ULTIMO_ANO }, q);
    expect(ll).toMatchObject({ rpc: "volumen_comprado_agente", params: { p_categoria: "cerveza", p_desde: "2025-11-07", p_hasta: "2026-11-07" } });
  });

  it("variacion_precios('cerveza') va como categoria, no como texto", () => {
    const ll = prepararLlamada("variacion_precios", { producto: "cerveza", categoria: null }, "¿ha subido la cerveza?", CERVEZAS);
    expect(ll).toMatchObject({ rpc: "variacion_precios_agente", params: { p_categoria: "Cervezas", p_producto: null } });
  });

  it("ranking precio_unitario de cerveza en una pregunta de litro va a volumen_comprado", () => {
    const ll = prepararLlamada("ranking", { criterio: "precio_unitario", categoria: "cerveza", ...ULTIMO_ANO }, q, CERVEZAS);
    expect(ll).toMatchObject({ rpc: "volumen_comprado_agente", params: { p_categoria: "Cervezas", p_orden: null } });
  });

  it("volumen_comprado directo con la familia en producto", () => {
    const ll = prepararLlamada("volumen_comprado", { categoria: null, producto: "birra", ...ULTIMO_ANO, unidad: null, orden: null }, q,
      CERVEZAS);
    expect(ll).toMatchObject({ rpc: "volumen_comprado_agente", params: { p_categoria: "Cervezas", p_texto: null } });
  });
});

describe("producto concreto en una pregunta de precio por litro/kilo", () => {
  it("«Cruzcampo de barril frente al botellín»: historial_precios → volumen_comprado por producto (por_envase compara)", () => {
    const ll = prepararLlamada("historial_precios", { producto: "Cruzcampo" },
      "a cuánto me sale el litro de Cruzcampo de barril frente al botellín", CRUZCAMPO);
    expect(ll).toMatchObject({ rpc: "volumen_comprado_agente", params: { p_texto: "Cruzcampo", p_categoria: null } });
    if (ll.tipo !== "rpc") throw new Error("rpc");
    expect(ll.nota).toMatch(/precio por litro\/kilo/);
  });

  it("«kilos de gamba roja y precio por kilo»: compras_producto → volumen_comprado", () => {
    const ll = prepararLlamada("compras_producto", { producto: "gamba roja" }, "kilos de gamba roja y precio por kilo", GAMBA);
    expect(ll).toMatchObject({ rpc: "volumen_comprado_agente", params: { p_texto: "gamba roja" } });
  });

  it("sin pregunta de litro, un producto sigue en su herramienta", () => {
    expect(prepararLlamada("compras_producto", { producto: "gamba roja" }, "¿a quién compro la gamba roja?", GAMBA))
      .toMatchObject({ rpc: "compras_producto_agente" });
    expect(prepararLlamada("historial_precios", { producto: "merluza" }, "precio de la merluza", null))
      .toMatchObject({ rpc: "historial_precios_agente" });
  });
});

describe("otras familias", () => {
  it("«qué proveedor de marisco me sale más caro»: compras/historial('marisco') → volumen_comprado Marisco (comparables)", () => {
    for (const herr of ["compras_producto", "historial_precios"]) {
      expect(prepararLlamada(herr, { producto: "marisco" }, "qué proveedor de marisco me sale más caro", MARISCO))
        .toMatchObject({ rpc: "volumen_comprado_agente", params: { p_categoria: "Marisco" } });
    }
    expect(NOTA_RESPUESTA_VOLUMEN).toMatch(/comparables \(mas caro\/barato\)/);
  });

  it("una familia sin litros ni kilos (limpieza) no va a volumen_comprado", () => {
    expect(prepararLlamada("compras_producto", { producto: "limpieza" }, "cuánto gasto en limpieza", LIMPIEZA))
      .toMatchObject({ rpc: "compras_producto_agente" });
    expect(prepararLlamada("buscar_productos", { consulta: "limpieza" }, "productos de limpieza", LIMPIEZA))
      .toMatchObject({ tipo: "semantica" });
  });

  it("«cuánto me he gastado en vino en el último mes»: gasto_por_categoria va con la categoria y el mes", () => {
    expect(prepararLlamada("gasto_por_categoria", { categoria: "vino", desde: "2026-10-01", hasta: "2026-10-31", tipo: null, agrupar: null },
      "Cuánto me he gastado en vino en el último mes"))
      .toMatchObject({ rpc: "gasto_categorias_agente", params: { p_categoria: "vino", p_desde: "2026-10-01", p_hasta: "2026-10-31", p_tipo: null } });
    // «y en cerveza?»: mismo periodo, otra familia.
    expect(prepararLlamada("gasto_por_categoria", { categoria: "cerveza", desde: "2026-10-01", hasta: "2026-10-31", tipo: null, agrupar: null },
      "y en cerveza?"))
      .toMatchObject({ rpc: "gasto_categorias_agente", params: { p_categoria: "cerveza", p_desde: "2026-10-01" } });
  });

  it("«precio del litro de vino por proveedor»: compras_producto('vino') → volumen_comprado Vinos", () => {
    expect(prepararLlamada("compras_producto", { producto: "vino" }, "precio del litro de vino por proveedor", VINOS))
      .toMatchObject({ rpc: "volumen_comprado_agente", params: { p_categoria: "Vinos" } });
  });
});

describe("seguimiento y pista de la pregunta", () => {
  it("«hazme la comparativa» con el tema anterior (cerveza) acaba en volumen_comprado aunque no diga litro", () => {
    expect(prepararLlamada("compras_producto", { producto: "cerveza" }, "hazme la comparativa", CERVEZAS))
      .toMatchObject({ rpc: "volumen_comprado_agente", params: { p_categoria: "Cervezas" } });
  });

  it("pista: palabras del catalogo de la pregunta", () => {
    const p = pistaPregunta([{ palabra: "vino", tipo: "familia", categoria: "Vinos" }], null, []);
    expect(p).toBe("PISTA: Catalogo: «vino» = familia Vinos. Familia = herramienta por categoria.");
    const p2 = pistaPregunta([
      { palabra: "cruzcampo", tipo: "producto", categoria: "Cervezas" },
      { palabra: "barril", tipo: "familia", categoria: "Cervezas", formato: "barril" },
    ], null, []);
    expect(p2).toMatch(/«cruzcampo» = producto de Cervezas; «barril» = familia Cervezas \(formato barril\)/);
  });

  it("pista: sin palabras, el tema del turno anterior", () => {
    const p = pistaPregunta([], [{ palabra: "cerveza", tipo: "familia", categoria: "Cervezas" }], ["2026-10", "2026-11"]);
    expect(p).toMatch(/seguimiento: el tema anterior era «cerveza» = familia Cervezas; manten tema, unidad y periodo/);
    expect(p).toMatch(/incompletos\): 2026-10, 2026-11/);
    expect(pistaPregunta([], null, [])).toBeNull();
  });

  it("meses incompletos: solo los recientes, sin repetir", () => {
    const filas = [{ mes: "2025-02-01" }, { mes: "2025-12-01" }, { mes: "2026-10-01" }, { mes: "2026-11-01" }, { mes: "2026-10-01" }];
    expect(mesesIncompletosRecientes(filas, "2026-11-07")).toEqual(["2026-10", "2026-11"]);
    expect(mesesIncompletosRecientes(null, "2026-11-07")).toEqual([]);
  });

  it("el prompt prohibe preguntar «¿quieres que consulte…?», mantiene el tema y fija «ultimo mes»", () => {
    const p = systemPrompt("2026-11-07");
    expect(p).toMatch(/16\. Nunca preguntes «¿quieres que consulte…\?»: llama a las herramientas que falten y da la cifra\./);
    expect(p).toMatch(/17\. Seguimiento .*mismo tema, unidad y periodo/);
    expect(p).toMatch(/18\. «Ultimo mes» = mes natural anterior: di el periodo .* y si esta incompleto\./);
  });
});

describe("modelo configurable (CHAT_FACTURAS_MODELO)", () => {
  it("por defecto gpt-4.1-mini; acepta nombres de modelo validos", () => {
    expect(MODELO_POR_DEFECTO).toBe("gpt-4.1-mini");
    expect(modeloChat(undefined)).toBe("gpt-4.1-mini");
    expect(modeloChat("  ")).toBe("gpt-4.1-mini");
    expect(modeloChat("gpt-4.1")).toBe("gpt-4.1");
    expect(modeloChat("gpt-5.6-luna")).toBe("gpt-5.6-luna");
    expect(modeloChat("gpt 4; drop")).toBe("gpt-4.1-mini");
  });

  it("parametros: temperature/max_tokens en gpt-4.1; max_completion_tokens en los de razonamiento", () => {
    expect(parametrosModelo("gpt-4.1-mini", 800)).toEqual({ temperature: 0.2, max_tokens: 800 });
    expect(parametrosModelo("gpt-5.6-luna", 800)).toEqual({ max_completion_tokens: 4000 });
    expect(parametrosModelo("o4-mini", 800)).toEqual({ max_completion_tokens: 4000 });
  });
});
