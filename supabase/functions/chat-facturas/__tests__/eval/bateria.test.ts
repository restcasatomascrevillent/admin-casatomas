import { describe, expect, it } from "vitest";
import bateria from "./bateria.json";
import * as herramientas from "../../herramientas.ts";
import {
  compararEsperado, compararPasadas, evaluarResultado, leerRuta, problemasDeBateria, resumenPorCategoria, sqlDeCaso, trozosRuta,
} from "../../../../../scripts/eval-chat-fallos.mjs";

const nombres = new Set(herramientas.TOOLS.map((t) => t.function.name));
type Caso = { id: string; categoria: string; evaluable?: boolean; esperado?: { sql?: string }[] };
const casos = bateria.casos as unknown as Caso[];

describe("batería ampliada del copiloto (bateria.json)", () => {
  it("bien formada: ids únicos, categoría, herramienta y valor esperado en cada comprobación", () => {
    expect(casos.length).toBeGreaterThanOrEqual(150);
    expect(problemasDeBateria(bateria, nombres)).toEqual([]);
  });

  it("incluye todas las preguntas reales de producción (r001 a r121), evaluables o no", () => {
    const ids = new Set(casos.map((c) => c.id));
    for (let i = 1; i <= 121; i++) expect(ids.has(`r${String(i).padStart(3, "0")}`), `r${i}`).toBe(true);
  });

  it("tiene casos de todos los temas pedidos", () => {
    const cats = new Set(casos.map((c) => c.categoria));
    for (const k of ["margenes", "presupuestos", "subidas_precio", "proveedor_barato", "gasto", "iva", "albaranes_sin_factura", "comparativas_anios", "trampas_abreviaturas", "trampas_siglas", "trampas_proveedores_parecidos", "trampas_genericos_lonja", "trampas_packs_unidades", "trampas_vinos_regalo", "trampas_anadas_magnum"]) {
      expect(cats.has(k), k).toBe(true);
    }
  });

  it("cada caso evaluable se traduce a un select de solo lectura de una RPC del agente", () => {
    for (const c of bateria.casos as never[]) {
      const cc = c as { id: string; evaluable?: boolean };
      if (cc.evaluable === false) continue;
      const sql = sqlDeCaso(herramientas, c);
      expect(sql, cc.id).toMatch(/^public\.[a-z_]+\(/);
      expect(sql, cc.id).not.toMatch(/;|\b(insert|update|delete|drop|alter)\b/i);
    }
  });

  it("el SQL de verificación de cada valor es un select de solo lectura", () => {
    for (const c of casos) for (const e of c.esperado ?? []) {
      if (e.sql) { expect(e.sql, c.id).toMatch(/^\s*select\b/i); expect(e.sql, c.id).not.toMatch(/;|\b(insert|update|delete|drop|alter|create|grant|truncate)\b/i); }
    }
  });

  it("no guarda datos personales de clientes (teléfonos ni correos)", () => {
    const texto = JSON.stringify(bateria);
    expect(texto).not.toMatch(/\b[6-9]\d{8}\b/);
    expect(texto).not.toMatch(/[\w.-]+@[\w-]+\.[a-z]{2,}/i);
  });
});

describe("comprobaciones de valor de scripts/eval-chat-fallos.mjs", () => {
  const r = { a: { b: [{ n: "x", v: 1 }, { n: "Y Z", v: 2.5 }] }, ok: true, nada: null };

  it("trozosRuta y leerRuta: puntos, índices y selectores [campo=valor]", () => {
    expect(trozosRuta("a.b[0].v")).toEqual(["a", "b", 0, "v"]);
    expect(trozosRuta("a.b[n=Y Z].v")).toEqual(["a", "b", { campo: "n", valor: "Y Z" }, "v"]);
    expect(leerRuta(r, "a.b[n=y z].v")).toBe(2.5);
    expect(leerRuta(r, "a.b[1].v")).toBe(2.5);
    expect(leerRuta(r, "a.c.d")).toBeUndefined();
    expect(leerRuta([{ i: 1, p: "A" }], "[i=1].p")).toBe("A");
  });

  it("compararEsperado: tolerancia absoluta y relativa, operadores, texto, booleano y nulo", () => {
    expect(compararEsperado({ ruta: "x", tol: 0.5 }, 10.4, 10)).toBeNull();
    expect(compararEsperado({ ruta: "x", tol: 0.5 }, 11, 10)).toMatch(/esperado 10/);
    expect(compararEsperado({ ruta: "x", tol: 0, tol_pct: 1 }, 100.9, 100)).toBeNull();
    expect(compararEsperado({ ruta: "x", tol: 0, op: "<=" }, 5, 10)).toBeNull();
    expect(compararEsperado({ ruta: "x", tol: 0, op: "<=" }, 11900, 1000)).toMatch(/como mucho/);
    expect(compararEsperado({ ruta: "x", tol: 0, op: ">=" }, 3, 10)).toMatch(/al menos/);
    expect(compararEsperado({ ruta: "x" }, "Abc ", "abc")).toBeNull();
    expect(compararEsperado({ ruta: "x", tipo: "bool" }, true, true)).toBeNull();
    expect(compararEsperado({ ruta: "x", tipo: "nulo" }, undefined, null)).toBeNull();
    expect(compararEsperado({ ruta: "x" }, undefined, 3)).toMatch(/no está en el resultado/);
    expect(compararEsperado({ ruta: "x" }, null, 3)).toMatch(/esperado 3/);
  });

  it("evaluarResultado: mezcla expresiones regulares y valores, y usa valores en vivo si se dan", () => {
    const caso = { rpc: { debe: ["CUVEE"] }, esperado: [{ ruta: "t.imp", valor: 10, tol: 0.01 }] };
    const texto = JSON.stringify({ t: { imp: 10 }, n: "LA CUVEE" });
    expect(evaluarResultado(caso, texto, "prod").problemas).toEqual([]);
    expect(evaluarResultado(caso, texto, "prod", [12]).problemas.length).toBe(1);
    expect(evaluarResultado(caso, "no json", "prod").problemas.length).toBeGreaterThan(0);
  });

  it("resumenPorCategoria y compararPasadas: porcentajes, regresiones y mejoras", () => {
    const res = resumenPorCategoria([{ categoria: "a", ok: true }, { categoria: "a", ok: false }, { categoria: "b", ok: true }]);
    expect(res).toEqual({ a: { n: 2, bien: 1, pct: 50 }, b: { n: 1, bien: 1, pct: 100 } });
    expect(compararPasadas([{ id: "1", ok: true }, { id: "2", ok: false }, { id: "3", ok: true }], [{ id: "1", ok: false }, { id: "2", ok: true }, { id: "4", ok: true }]))
      .toEqual({ regresiones: ["1"], mejoras: ["2"], nuevos: ["4"], desaparecidos: ["3"] });
  });
});
