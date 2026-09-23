/**
 * Tests de la parte "propuesta al cliente" de src/hooks/useSolicitudesPendientes.ts:
 * enviarPropuesta, aceptar/rechazar por teléfono, marcarConvertida y la
 * degradación cuando la migración 20260923210000 no está aplicada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner");

import * as clienteMock from "@/integrations/supabase/client";
// `resetSupabaseMocks` solo existe en el mock (__mocks__/client.ts): se saca
// con un cast para no sumar un error de tipos (los tests antiguos lo importan
// directamente y cuentan en el baseline de tsc).
const { supabase } = clienteMock;
const { resetSupabaseMocks } = clienteMock as unknown as { resetSupabaseMocks: () => void };
import { toast } from "sonner";
import { useSolicitudesPendientes } from "@/hooks/useSolicitudesPendientes";

type Resultado = { data: unknown; error: unknown };

/** Builder cuyo `await` devuelve, en orden, los resultados dados (el último se repite). */
function builderSecuencia(resultados: Resultado[]) {
  let i = 0;
  const siguiente = () => resultados[Math.min(i++, resultados.length - 1)];
  const builder: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    then: (ok: (v: unknown) => unknown) => Promise.resolve(siguiente()).then(ok),
  };
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  return builder;
}

const rpc = vi.fn();

async function montar() {
  const hook = renderHook(() => useSolicitudesPendientes());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("useSolicitudesPendientes · propuesta al cliente", () => {
  beforeEach(() => {
    resetSupabaseMocks();
    rpc.mockReset();
    (supabase as unknown as { rpc: typeof rpc }).rpc = rpc;
  });

  it("enviarPropuesta llama a la Edge Function y avisa del destinatario", async () => {
    builderSecuencia([{ data: [], error: null }]);
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { ok: true, destinatario: "ana@example.com" },
      error: null,
    } as never);
    const { result } = await montar();

    let ok = false;
    await act(async () => {
      ok = await result.current.enviarPropuesta("sol-1");
    });

    expect(ok).toBe(true);
    expect(supabase.functions.invoke).toHaveBeenCalledWith("emails-reserva/enviar-propuesta-solicitud", {
      body: { solicitud_id: "sol-1" },
    });
    expect(toast.success).toHaveBeenCalledWith("Propuesta enviada a ana@example.com");
  });

  it("enviarPropuesta muestra el mensaje de error de la función", async () => {
    builderSecuencia([{ data: [], error: null }]);
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { ok: false, message: "El cliente no dejó email." },
      error: null,
    } as never);
    const { result } = await montar();
    let ok = true;
    await act(async () => {
      ok = await result.current.enviarPropuesta("sol-1");
    });
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("El cliente no dejó email.");
  });

  it("aceptarPropuestaTelefono crea la reserva vía RPC y dispara el correo de confirmación", async () => {
    builderSecuencia([{ data: [], error: null }]);
    rpc.mockResolvedValue({ data: { ok: true, reserva_id: "res-9", estado: "confirmada" }, error: null });
    const { result } = await montar();

    let res: { ok: boolean } = { ok: false };
    await act(async () => {
      res = await result.current.aceptarPropuestaTelefono("sol-1");
    });

    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("fn_aceptar_propuesta_solicitud", { p_solicitud_id: "sol-1", p_via: "telefono" });
    expect(supabase.functions.invoke).toHaveBeenCalledWith("notify-reservation-change", { body: { reserva_id: "res-9" } });
    expect(toast.success).toHaveBeenCalled();
  });

  it("aceptarPropuestaTelefono sin aforo: no notifica y explica el motivo", async () => {
    builderSecuencia([{ data: [], error: null }]);
    rpc.mockResolvedValue({ data: { ok: false, error: "sin_aforo" }, error: null });
    const { result } = await montar();
    await act(async () => {
      await result.current.aceptarPropuestaTelefono("sol-1");
    });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/aforo/i);
  });

  it("sin la migración, la RPC no existe y se avisa de aplicarla", async () => {
    builderSecuencia([{ data: [], error: null }]);
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const { result } = await montar();
    let res: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      res = await result.current.aceptarPropuestaTelefono("sol-1");
    });
    expect(res.error).toBe("sin_migracion");
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/migración/);
  });

  it("updatePropuesta reintenta sin la sala si la columna aún no existe", async () => {
    const builder = builderSecuencia([
      { data: [], error: null }, // carga inicial
      { data: null, error: { code: "PGRST204", message: "Could not find the 'espacio_propuesto_id' column" } },
      { data: null, error: null }, // reintento
      { data: [], error: null }, // recarga
    ]);
    const { result } = await montar();

    let ok = false;
    await act(async () => {
      ok = await result.current.updatePropuesta("sol-1", {
        fecha_solicitada: "2026-10-06",
        hora_solicitada: "14:00",
        numero_comensales: 10,
        notas_internas: "",
        espacio_propuesto_id: "esp-1",
      });
    });

    expect(ok).toBe(true);
    const updates = (builder.update as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(updates[0]).toHaveProperty("espacio_propuesto_id", "esp-1");
    expect(updates[1]).not.toHaveProperty("espacio_propuesto_id");
    expect(toast.warning).toHaveBeenCalled();
  });

  it("marcarConvertida enlaza la reserva y, sin migración, cae a solo 'resuelta'", async () => {
    const builder = builderSecuencia([
      { data: [], error: null },
      { data: null, error: { code: "PGRST204", message: "Could not find the 'reserva_id' column" } },
      { data: null, error: null },
      { data: [], error: null },
    ]);
    const { result } = await montar();
    await act(async () => {
      await result.current.marcarConvertida("sol-1", "res-1");
    });
    const updates = (builder.update as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(updates[0]).toMatchObject({ estado: "resuelta", propuesta_estado: "aceptada", reserva_id: "res-1" });
    expect(updates[1]).toEqual({ estado: "resuelta", updated_at: expect.any(String) });
  });
});
