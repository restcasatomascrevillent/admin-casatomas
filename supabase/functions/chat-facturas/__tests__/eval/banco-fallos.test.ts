import { describe, expect, it } from "vitest";
import banco from "./banco-fallos.json";
import { prepararLlamada, TOOLS } from "../../herramientas.ts";
import { comprobaciones, literalSql, mediana, problemas, problemasDelBanco, sqlDeLlamada, sqlSimulado } from "../../../../../scripts/eval-chat-fallos.mjs";

const nombres = new Set(TOOLS.map((t) => t.function.name));

describe("banco de fallos reales del copiloto (banco-fallos.json)", () => {
  it("bien formado: ids únicos, herramienta existente y comprobación para producción en cada caso", () => {
    expect(banco.casos.length).toBeGreaterThanOrEqual(15);
    expect(problemasDelBanco(banco, nombres)).toEqual([]);
  });

  it("cada caso se traduce a una consulta de solo lectura (select de una RPC *_agente)", () => {
    for (const c of banco.casos) {
      const ll = prepararLlamada(c.herramienta.nombre, c.herramienta.argumentos, c.mensaje, (c.herramienta as { asociacion?: never }).asociacion ?? null);
      const sql = sqlDeLlamada(ll);
      expect(sql, c.id).toMatch(/^public\.[a-z_]+_agente\(/);
      expect(sql, c.id).not.toMatch(/;|\b(insert|update|delete|drop|alter)\b/i);
    }
  });

  it("incluye las preguntas que pidió el dueño", () => {
    const todo = banco.casos.map((c) => c.mensaje.toLowerCase()).join(" | ");
    for (const t of ["laurent perrier", "sierra cantabria", "acciona", "litros de cerveza", "carabinero", "pan de cristal", "pintia"]) {
      expect(todo, t).toContain(t);
    }
  });

  it("incluye los 9 casos de la revisión del #255 que no deben dar cifra mezclada", () => {
    const ids = banco.casos.map((c) => c.id);
    for (const id of ["p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09"]) expect(ids, id).toContain(id);
    const todo = banco.casos.map((c) => c.mensaje.toLowerCase()).join(" | ");
    for (const t of ["aceite de oliva", "pera conferencia", "frutos rojos", "solomillo de vaca", "vieira congelada", "mercadona", "naturgy", "mahou", "damm"]) {
      expect(todo, t).toContain(t);
    }
  });

  it("«cerveza a Mahou» va a compras_producto con el proveedor (no se desvía a volumen sin proveedor)", () => {
    const ll = prepararLlamada("compras_producto", { producto: "cerveza", proveedor: "mahou" }, "A cuánto compro la cerveza a Mahou", null);
    expect(sqlDeLlamada(ll)).toMatch(/^public\.compras_producto_agente\(.*p_proveedor => 'mahou'/);
    const sin = prepararLlamada("compras_producto", { producto: "cerveza" }, "A cuánto compro la cerveza", null);
    expect(sqlDeLlamada(sin)).toMatch(/^public\.volumen_comprado_agente\(/);
  });
});

describe("scripts/eval-chat-fallos.mjs", () => {
  it("literalSql: texto con comillas, null, números, booleanos y objetos como jsonb", () => {
    expect(literalSql("d'or")).toBe("'d''or'");
    expect(literalSql(null)).toBe("null");
    expect(literalSql(10)).toBe("10");
    expect(literalSql(false)).toBe("false");
    expect(literalSql({ a: "x'y" })).toBe(`'{"a":"x''y"}'::jsonb`);
  });

  it("sqlDeLlamada rechaza nombres raros y las búsquedas semánticas", () => {
    expect(() => sqlDeLlamada({ tipo: "rpc", rpc: "x; drop", params: {}, limite: null })).toThrow();
    expect(() => sqlDeLlamada({ tipo: "rpc", rpc: "ok_agente", params: { "p; x": 1 }, limite: null })).toThrow();
    expect(() => sqlDeLlamada({ tipo: "semantica", rpc: "buscar_facturas_agente" })).toThrow(/semántica/);
  });

  it("comprobaciones por entorno y problemas de un texto", () => {
    const nivel = { debe: ["base"], no_debe: ["error"], prod: { debe: ["26858[.]89"] }, demo: { debe: ["31994[.]05"] } };
    expect(comprobaciones(nivel, "prod").debe).toEqual(["base", "26858[.]89"]);
    expect(problemas('{"base": 26858.89}', comprobaciones(nivel, "prod"))).toEqual([]);
    expect(problemas('{"base": 1, "error": "x"}', comprobaciones(nivel, "demo"))).toEqual(["falta /31994[.]05/", "sobra /error/"]);
    expect(comprobaciones(undefined, "demo")).toEqual({ debe: [], no_debe: [] });
  });

  it("sqlSimulado: sin migraciones, la consulta tal cual; con ellas, dentro de begin … rollback", () => {
    expect(sqlSimulado("select 1;", [])).toBe("select 1;");
    const sql = sqlSimulado("select 1;", ["create function a();", "create function b();"]);
    expect(sql.split(/\n/)).toEqual(["begin;", "create function a();", "create function b();", "select 1;", "rollback;"]);
  });

  it("mediana", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(3);
    expect(mediana([null as unknown as number])).toBeNull();
  });
});
