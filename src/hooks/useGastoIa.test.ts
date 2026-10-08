import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { cargarGastoIa } from "./useGastoIa";
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
