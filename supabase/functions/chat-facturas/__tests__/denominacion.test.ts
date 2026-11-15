// Vinos por denominacion de origen (migracion 20261202100000, 15/11/2026).
// Caso del dueño: «cuanto me he gastado en vinos de rioja en septiembre» → el bot
// buscaba «Rioja» en el nombre de la linea y decia «no hay compras». Ahora va por
// la D.O. del catalogo (p_denominacion) y nunca por el nombre.
import { describe, it, expect } from "vitest";
import {
  denominacionDeTexto,
  prepararLlamada,
  systemPrompt,
  TOOLS,
  NOTA_RESPUESTA_DENOMINACION,
} from "../herramientas.ts";

const SEP = { desde: "2026-09-01", hasta: "2026-09-30" };

describe("denominacionDeTexto", () => {
  it("reconoce D.O., regiones y paises sueltos", () => {
    expect(denominacionDeTexto("vinos de rioja")).toBe("rioja");
    expect(denominacionDeTexto("Rioja")).toBe("rioja");
    expect(denominacionDeTexto("D.O.Ca. Rioja")).toBe("rioja");
    expect(denominacionDeTexto("Ribera")).toBe("ribera");
    expect(denominacionDeTexto("vinos de Ribera del Duero")).toBe("ribera del duero");
    expect(denominacionDeTexto("champán francés")).toBe("champan frances");
    expect(denominacionDeTexto("vinos gallegos")).toBe("gallegos");
    expect(denominacionDeTexto("tintos de Toro")).toBe("toro");
  });

  it("un producto concreto o la familia sola no son denominacion", () => {
    expect(denominacionDeTexto("Martelo Rioja")).toBeNull();
    expect(denominacionDeTexto("vino blanco Lanzar")).toBeNull();
    expect(denominacionDeTexto("vino")).toBeNull();
    expect(denominacionDeTexto("cerveza")).toBeNull();
    expect(denominacionDeTexto(null)).toBeNull();
  });
});

describe("«cuanto me he gastado en vinos de rioja en septiembre»", () => {
  const pregunta = "cuánto me he gastado en vinos de rioja en septiembre";

  it("gasto_por_categoria con denominacion va a gasto_categorias_agente con p_denominacion", () => {
    const ll = prepararLlamada("gasto_por_categoria",
      { categoria: "vino", ...SEP, tipo: null, agrupar: null, denominacion: "Rioja" }, pregunta);
    expect(ll).toEqual({
      tipo: "rpc",
      rpc: "gasto_categorias_agente",
      params: { p_categoria: "vino", p_desde: "2026-09-01", p_hasta: "2026-09-30", p_tipo: null, p_agrupar: null, p_denominacion: "Rioja" },
      limite: null,
      notaRespuesta: NOTA_RESPUESTA_DENOMINACION,
    });
  });

  it("«vinos de rioja» puesto como categoria: categoria vino + filtro rioja", () => {
    expect(prepararLlamada("gasto_por_categoria",
      { categoria: "vinos de rioja", ...SEP, tipo: null, agrupar: null, denominacion: null }, pregunta))
      .toMatchObject({ rpc: "gasto_categorias_agente", params: { p_categoria: "vino", p_denominacion: "rioja", ...{ p_desde: SEP.desde } } });
  });

  it("compras_producto('rioja') ya no busca el texto en el nombre", () => {
    const ll = prepararLlamada("compras_producto", { producto: "vinos de rioja", ...SEP }, pregunta);
    expect(ll).toMatchObject({
      rpc: "gasto_categorias_agente",
      params: { p_categoria: "vino", p_desde: "2026-09-01", p_hasta: "2026-09-30", p_denominacion: "rioja" },
    });
    expect(ll.tipo === "rpc" && ll.nota).toMatch(/denominacion de origen/);
  });

  it("buscar_productos('rioja') tampoco", () => {
    expect(prepararLlamada("buscar_productos", { consulta: "rioja" }, pregunta))
      .toMatchObject({ tipo: "rpc", rpc: "gasto_categorias_agente", params: { p_denominacion: "rioja" } });
  });

  it("un vino concreto con «Rioja» en el nombre sigue siendo un producto", () => {
    expect(prepararLlamada("compras_producto", { producto: "Martelo Rioja", ...SEP }, "¿cuánto Martelo Rioja compré?"))
      .toMatchObject({ rpc: "compras_producto_agente", params: { p_texto: "Martelo Rioja" } });
  });

  it("sin filtro de vino no se manda p_denominacion (firma de antes)", () => {
    const ll = prepararLlamada("gasto_por_categoria", { categoria: "vino", ...SEP, tipo: null, agrupar: null, denominacion: null });
    expect(ll.tipo === "rpc" && "p_denominacion" in ll.params).toBe(false);
    expect(ll.tipo === "rpc" && ll.notaRespuesta).toBeFalsy();
  });
});

describe("«ribera»", () => {
  it("botellas de Ribera: volumen_comprado con categoria vino y p_denominacion", () => {
    expect(prepararLlamada("volumen_comprado",
      { categoria: null, producto: "ribera", ...SEP, unidad: null, orden: "envases", denominacion: null },
      "¿cuántas botellas de ribera compramos en septiembre?"))
      .toMatchObject({
        rpc: "volumen_comprado_agente",
        params: { p_texto: null, p_categoria: "vino", p_denominacion: "ribera", p_orden: "envases" },
      });
  });

  it("compras_producto('Ribera') con pregunta de botellas va a volumen_comprado", () => {
    expect(prepararLlamada("compras_producto", { producto: "Ribera", desde: null, hasta: null }, "cuantas botellas de ribera"))
      .toMatchObject({ rpc: "volumen_comprado_agente", params: { p_categoria: "vino", p_denominacion: "ribera" } });
  });

  it("gasto en Ribera: gasto_categorias_agente", () => {
    expect(prepararLlamada("compras_producto", { producto: "ribera del duero", desde: null, hasta: null }, "¿cuánto gastamos en ribera?"))
      .toMatchObject({ rpc: "gasto_categorias_agente", params: { p_categoria: "vino", p_denominacion: "ribera del duero" } });
  });
});

describe("herramientas y prompt", () => {
  it("gasto_por_categoria y volumen_comprado declaran denominacion", () => {
    for (const n of ["gasto_por_categoria", "volumen_comprado"]) {
      const t = TOOLS.find((x) => x.function.name === n)!;
      const params = t.function.parameters as { properties: Record<string, unknown>; required: string[] };
      expect(params.properties.denominacion, n).toBeDefined();
      expect(params.required, n).toContain("denominacion");
    }
  });

  it("el prompt manda filtrar por denominacion y no por el nombre", () => {
    expect(systemPrompt("2026-11-15")).toMatch(/Vinos por D\.O\., region o pais/);
    expect(systemPrompt("2026-11-15")).toMatch(/nunca la busques en el nombre/);
  });
});
