import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { cargarGastoIa, cargarGastoIaReal } from "./useGastoIa";
import { resumirGastoIa } from "@/lib/facturas/gastoIa";

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
