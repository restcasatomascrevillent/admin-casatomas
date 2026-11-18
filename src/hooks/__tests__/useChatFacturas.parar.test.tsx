// «Parar» (18/11/2026): useChatFacturas cancela la petición con un AbortController,
// deja escribir de nuevo y avisa en palabras normales, sin toast de error ni
// aviso de «fallo» a desarrollo. Los errores de red salen sin texto técnico.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const invoke = vi.fn();
const toastError = vi.fn();
const registrar = vi.fn();

/** Cadena de consultas de Supabase: cualquier método devuelve la misma cadena y al esperarla da una fila. */
function cadena(): unknown {
  const fila = { id: "fila-1", session_id: "sesion-1", titulo: "Nueva conversación", created_at: "2026-11-18T10:00:00Z", updated_at: "2026-11-18T10:00:00Z" };
  const proxy: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? (res: (v: unknown) => void) => res({ data: fila, error: null }) : () => proxy),
  });
  return proxy;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => cadena(),
    auth: { getSession: async () => ({ data: { session: null } }) },
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }));
vi.mock("@/lib/facturas/fallosInternos", () => ({ registrarFalloInterno: (...a: unknown[]) => registrar(...a) }));

import { TEXTO_PARADA, TEXTO_SIN_RESPUESTA, useChatFacturas } from "../useChatFacturas";

/** invoke que se queda esperando y rechaza al abortar su señal (como supabase-js). */
function invokeColgado() {
  invoke.mockImplementation(
    (_n: string, opciones: { signal?: AbortSignal }) =>
      new Promise((_res, rej) => {
        opciones.signal?.addEventListener("abort", () => rej(new DOMException("The operation was aborted.", "AbortError")));
      }),
  );
}

beforeEach(() => {
  invoke.mockReset();
  toastError.mockReset();
  registrar.mockReset();
});

describe("useChatFacturas: Parar", () => {
  it("manda la señal de cancelación a la función y, al parar, libera el envío con el aviso «has parado»", async () => {
    invokeColgado();
    const { result } = renderHook(() => useChatFacturas({ activo: false }));

    let envio!: Promise<void>;
    act(() => {
      envio = result.current.enviarMensaje("Precio de la gamba");
    });
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const opciones = invoke.mock.calls[0][1] as { signal: AbortSignal };
    expect(opciones.signal).toBeInstanceOf(AbortSignal);
    expect(opciones.signal.aborted).toBe(false);
    await waitFor(() => expect(result.current.isSending).toBe(true));

    act(() => result.current.pararRespuesta());
    await act(async () => {
      await envio;
    });

    expect(opciones.signal.aborted).toBe(true);
    expect(result.current.isSending).toBe(false);
    const ultimo = result.current.mensajes[result.current.mensajes.length - 1];
    expect(ultimo.rol).toBe("assistant");
    expect(ultimo.contenido).toBe(TEXTO_PARADA);
    expect(ultimo.aviso).toBe("error"); // saca «Reintentar»
    // Parar no es un fallo: ni toast ni aviso a desarrollo.
    expect(toastError).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it("tras parar se puede escribir otra pregunta", async () => {
    invokeColgado();
    const { result } = renderHook(() => useChatFacturas({ activo: false }));
    let envio!: Promise<void>;
    act(() => {
      envio = result.current.enviarMensaje("Primera");
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    act(() => result.current.pararRespuesta());
    await act(async () => {
      await envio;
    });

    invoke.mockReset();
    invoke.mockResolvedValue({ data: { respuesta: "**41,85 €**", success: true, ayuda: { datos_hasta: "2026-11-12" }, traza: { herramientas: [] } }, error: null });
    await act(async () => {
      await result.current.enviarMensaje("Segunda");
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    const ultimo = result.current.mensajes[result.current.mensajes.length - 1];
    expect(ultimo.contenido).toBe("**41,85 €**");
    expect(ultimo.traza?.ayuda?.datos_hasta).toBe("2026-11-12");
  });

  it("un fallo de verdad (sin parar) dice la causa en palabras normales y avisa a desarrollo", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "FunctionsFetchError: Failed to fetch" } });
    const { result } = renderHook(() => useChatFacturas({ activo: false }));
    await act(async () => {
      await result.current.enviarMensaje("Precio de la gamba");
    });
    const ultimo = result.current.mensajes[result.current.mensajes.length - 1];
    expect(ultimo.contenido).toBe(TEXTO_SIN_RESPUESTA);
    expect(ultimo.contenido).not.toMatch(/Failed to fetch|Functions/);
    expect(ultimo.aviso).toBe("error");
    expect(registrar).toHaveBeenCalled();
  });
});
