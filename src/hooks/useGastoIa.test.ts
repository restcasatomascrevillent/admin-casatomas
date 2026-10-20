import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { cargarGastoIa, cargarGastoIaReal, cargarGastoIaRealMes, leerTopeIaMes } from "./useGastoIa";
import { evaluarTope, resumirGastoIa } from "@/lib/facturas/gastoIa";

/** Cliente que, como SupabaseClient, necesita `this` dentro de `rpc`. */
class ClienteFalso {
  llamadas: Array<{ fn: string; args: unknown }> = [];
  constructor(private respuesta: { data: unknown; error: { message?: string } | null }) {}
  rpc(fn: string, args: unknown) {
    this.llamadas.push({ fn, args }); // lanza si `this` es undefined
    return Promise.resolve(this.respuesta);
  }
}

const FILA_CHAT = {
  funcion: "chat-facturas",
  coste_usd: 0.241532,
  filas: 201,
  llamadas: 396,
  unidades: 199,
  filas_sin_tarifa: 0,
  documentos_ocr: 0,
  ultima: "2026-10-08T14:57:13.108651+00:00",
};

describe("cargarGastoIa", () => {
  it("invoca rpc con `this` del cliente y devuelve las filas (regresión: «sin datos todavía»)", async () => {
    const c = new ClienteFalso({ data: [FILA_CHAT], error: null });
    const filas = await cargarGastoIa(c);
    expect(c.llamadas[0].fn).toBe("gasto_ia_resumen");
    expect(c.llamadas[0].args).toMatchObject({ p_dias: 30 });
    expect(filas).toHaveLength(1);
    const r = resumirGastoIa(filas, "chat");
    expect(r.eur).not.toBeNull();
    expect(r.unidades).toBe(199);
  });

  it("con error de la RPC devuelve [] sin lanzar", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = new ClienteFalso({ data: null, error: { message: "permission denied" } });
    expect(await cargarGastoIa(c)).toEqual([]);
    aviso.mockRestore();
  });
});

/** Cliente con una respuesta por RPC; `this` obligatorio como en SupabaseClient. */
class ClienteReal {
  llamadas: string[] = [];
  constructor(private respuestas: Record<string, { data: unknown; error: { message?: string } | null } | "lanza">) {}
  rpc(fn: string) {
    this.llamadas.push(fn);
    const r = this.respuestas[fn];
    if (!r || r === "lanza") return Promise.reject(new Error("función inexistente"));
    return Promise.resolve(r);
  }
}

const FILAS_REALES = [
  { proceso: "ocr", usd_real: "1.5", ultimo_dia_real: "2026-10-07", usd_estimado_hoy: "0.1" },
  { proceso: "chat", usd_real: 0.5, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
  { proceso: "otros", usd_real: 0, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
];
const TIPO = [{ eur_por_usd: 0.9231, fecha: "2026-10-07", fuente: "bce" }];

describe("cargarGastoIaReal", () => {
  it("existe con datos: filas + tipo del BCE (invoca rpc con `this`)", async () => {
    const c = new ClienteReal({
      gasto_ia_real_resumen: { data: FILAS_REALES, error: null },
      tipo_cambio_usd_eur_actual: { data: TIPO, error: null },
    });
    const g = await cargarGastoIaReal(c);
    expect(c.llamadas).toEqual(["gasto_ia_real_resumen", "tipo_cambio_usd_eur_actual"]);
    expect(g?.filas[0].usd_real).toBe(1.5);
    expect(g?.tipo).toEqual({ eurPorUsd: 0.9231, fecha: "2026-10-07", fuente: "bce" });
  });

  it("existe pero vacía (sin ultimo_dia_real): null -> se usa el estimado", async () => {
    const vacia = FILAS_REALES.map((f) => ({ ...f, usd_real: 0, ultimo_dia_real: null }));
    const c = new ClienteReal({
      gasto_ia_real_resumen: { data: vacia, error: null },
      tipo_cambio_usd_eur_actual: { data: [{ eur_por_usd: 0.92, fecha: null, fuente: "por_defecto" }], error: null },
    });
    expect(await cargarGastoIaReal(c)).toBeNull();
    const c2 = new ClienteReal({ gasto_ia_real_resumen: { data: [], error: null } });
    expect(await cargarGastoIaReal(c2)).toBeNull();
  });

  it("no existe (error de PostgREST o excepción): null sin lanzar", async () => {
    const c = new ClienteReal({
      gasto_ia_real_resumen: { data: null, error: { message: "Could not find the function" } },
    });
    expect(await cargarGastoIaReal(c)).toBeNull();
    expect(await cargarGastoIaReal(new ClienteReal({ gasto_ia_real_resumen: "lanza" }))).toBeNull();
  });

  it("si solo falla el tipo de cambio, usa 0,92 por defecto", async () => {
    const c = new ClienteReal({
      gasto_ia_real_resumen: { data: FILAS_REALES, error: null },
      tipo_cambio_usd_eur_actual: "lanza",
    });
    const g = await cargarGastoIaReal(c);
    expect(g?.tipo).toEqual({ eurPorUsd: 0.92, fecha: null, fuente: "por_defecto" });
  });
});

// ─── Mes en curso y mes anterior ─────────────────────────────────────────────

/** RPC que responde según `p_dias` (la ventana va hacia atrás desde el último día cerrado). */
class ClientePorVentana {
  llamadas: Array<{ fn: string; dias?: number }> = [];
  constructor(private ventanas: Record<number, unknown>) {}
  rpc(fn: string, args?: { p_dias?: number }) {
    this.llamadas.push({ fn, dias: args?.p_dias });
    if (fn === "tipo_cambio_usd_eur_actual") return Promise.resolve({ data: TIPO, error: null });
    const v = this.ventanas[args?.p_dias ?? -1];
    return Promise.resolve(v === undefined ? { data: null, error: { message: "sin ventana" } } : { data: v, error: null });
  }
}
const ventana = (ocr: number, chat: number, hoy = 0, corte = "2026-10-08") => [
  { proceso: "ocr", usd_real: ocr, ultimo_dia_real: corte, usd_estimado_hoy: hoy },
  { proceso: "chat", usd_real: chat, ultimo_dia_real: corte, usd_estimado_hoy: 0 },
];
const diasPedidos = (c: ClientePorVentana) => c.llamadas.filter((l) => l.fn === "gasto_ia_real_resumen").map((l) => l.dias);

describe("cargarGastoIaRealMes", () => {
  const hoy = new Date(2026, 9, 9); // 9 oct 2026; último cierre: 8 oct

  it("pide el último día cerrado y luego tantos días como lleva el mes", async () => {
    const c = new ClientePorVentana({ 1: ventana(0.1, 0.05, 0.02), 8: ventana(1, 0.5, 0.02) });
    const g = await cargarGastoIaRealMes(c, hoy);
    expect(diasPedidos(c)).toEqual([1, 8]);
    expect(g?.actual.filas.find((f) => f.proceso === "ocr")?.usd_real).toBe(1);
    expect(g?.anterior).toBeNull();
  });

  it("con mes anterior: ventana grande menos mes en curso (nunca negativo, sin estimado de hoy)", async () => {
    // 1 sep … 8 oct = 38 días
    const c = new ClientePorVentana({ 1: ventana(0.1, 0.05), 8: ventana(1, 0.5), 38: ventana(4, 0.4) });
    const g = await cargarGastoIaRealMes(c, hoy, true);
    expect(diasPedidos(c)).toEqual([1, 8, 38]);
    const ant = g?.anterior;
    expect(ant?.filas.find((f) => f.proceso === "ocr")?.usd_real).toBe(3);
    expect(ant?.filas.find((f) => f.proceso === "chat")?.usd_real).toBe(0); // 0,4 − 0,5 → 0
    expect(ant?.filas.every((f) => f.usd_estimado_hoy === 0)).toBe(true);
  });

  it("si el último cierre es del mes anterior (día 1): el real del mes es 0 y queda el estimado de hoy", async () => {
    const c = new ClientePorVentana({ 1: ventana(0.7, 0.2, 0.03, "2026-09-30") });
    const g = await cargarGastoIaRealMes(c, new Date(2026, 9, 1));
    expect(g?.actual.filas.find((f) => f.proceso === "ocr")?.usd_real).toBe(0);
    expect(g?.actual.filas.find((f) => f.proceso === "ocr")?.usd_estimado_hoy).toBe(0.03);
  });

  it("sin datos reales o con la RPC caída: null (manda el estimado)", async () => {
    expect(await cargarGastoIaRealMes(new ClientePorVentana({}), hoy)).toBeNull();
    const sinCorte = ventana(0, 0).map((f) => ({ ...f, ultimo_dia_real: null }));
    expect(await cargarGastoIaRealMes(new ClientePorVentana({ 1: sinCorte }), hoy)).toBeNull();
  });
});

describe("tope mensual de IA", () => {
  class ClienteTabla {
    constructor(private respuesta: { data: unknown; error: unknown }) {}
    from(tabla: string) {
      expect(tabla).toBe("configuracion_facturas");
      return { select: () => ({ limit: () => Promise.resolve(this.respuesta) }) };
    }
  }

  it("leerTopeIaMes lee configuracion_facturas con `this` del cliente y cae a 5 € si falla", async () => {
    expect(await leerTopeIaMes(new ClienteTabla({ data: [{ tope_ia_mes_eur: "12.50" }], error: null }))).toBe(12.5);
    expect(await leerTopeIaMes(new ClienteTabla({ data: null, error: { message: "column does not exist" } }))).toBe(5);
    expect(await leerTopeIaMes(new ClienteTabla({ data: [], error: null }))).toBe(5);
    expect(
      await leerTopeIaMes({
        from: () => {
          throw new Error("x");
        },
      }),
    ).toBe(5);
  });

  it("evaluarTope: ok < 80 % ≤ aviso < 100 % ≤ superado", () => {
    expect(evaluarTope(3.9, 5).nivel).toBe("ok");
    expect(evaluarTope(4, 5).nivel).toBe("aviso");
    expect(evaluarTope(4.99, 5).nivel).toBe("aviso");
    expect(evaluarTope(5, 5).nivel).toBe("superado");
    expect(evaluarTope(7.5, 5).pct).toBe(150);
    expect(evaluarTope(null, 5).nivel).toBe("ok");
    expect(evaluarTope(3, 0).nivel).toBe("ok");
  });
});
