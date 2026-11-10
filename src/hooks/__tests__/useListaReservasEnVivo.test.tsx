/**
 * `useListaReservasEnVivo`: la Lista de reservas (`reservas-lista`) se pone al día sola con lo que cambia
 * en `reservas` desde otro dispositivo, la web o el bot.
 *
 *   · UN canal propio, solo a `reservas` (INSERT/UPDATE/DELETE), con callback de estado y escucha `system`;
 *   · INVALIDACIÓN DIFERIDA: una ráfaga corta = UNA relectura de la Lista, 1 s después del último evento;
 *     con eventos sin parar, una cada 5 s como mucho;
 *   · solo la Lista: no toca las consultas de «Hoy» (esas las refresca `useReservasEnVivo`);
 *   · con la pestaña del navegador OCULTA no relee el histórico: lo marca caducado y lo relee al volver
 *     (aunque la lectura sea más reciente que el `staleTime`);
 *   · al reconectar relee (Realtime no reenvía lo perdido); el primer SUBSCRIBED no;
 *   · al desmontar quita su canal, cancela lo pendiente y su CLOSED no avisa;
 *   · si el servidor no puede dar de alta la escucha (tabla sin publicar) avisa UNA vez.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", async () => {
  const { crearDobleCanales } = await import("@/hooks/__tests__/dobleCanalRealtime");
  const canales = crearDobleCanales();
  return { supabase: { channel: canales.channel, removeChannel: canales.removeChannel, __canales: canales } };
});

import { supabase } from "@/integrations/supabase/client";
import { CLAVE_LISTA_RESERVAS, PREFIJO_CANAL_LISTA_EN_VIVO, useListaReservasEnVivo } from "@/hooks/useListaReservasEnVivo";
import { ESPERA_INVALIDACION_MS, ESPERA_MAXIMA_INVALIDACION_MS, olvidarAvisosRealtime } from "@/lib/realtimeCanal";
import type { DobleCanales } from "./dobleCanalRealtime";

const canales = (supabase as unknown as { __canales: DobleCanales }).__canales;

/**
 * Monta el hook junto a una consulta `reservas-lista` ACTIVA (como en la pantalla), con el `staleTime` de 30 s
 * del panel (App.tsx). `lecturas` cuenta las veces que se pide la Lista.
 */
function montar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 30_000, refetchOnWindowFocus: true } },
  });
  const lecturas = vi.fn(async () => [] as unknown[]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const vista = renderHook(
    () => {
      useListaReservasEnVivo();
      return useQuery({ queryKey: [CLAVE_LISTA_RESERVAS], queryFn: lecturas });
    },
    { wrapper },
  );
  return { queryClient, lecturas, ...vista };
}

/** Deja correr los timers y las promesas de TanStack Query (la lectura es asíncrona). */
async function avanzar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Simula la pestaña del navegador oculta o a la vista (`document.visibilityState`). */
function pestana(estado: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado });
}

describe("useListaReservasEnVivo", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    canales.reiniciar();
    olvidarAvisosRealtime();
    pestana("visible");
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
    pestana("visible");
    focusManager.setFocused(undefined);
  });

  it("abre UN canal, solo a `reservas` (INSERT, UPDATE y DELETE), con callback de estado y escucha `system`", () => {
    montar();

    expect(canales.canales).toHaveLength(1);
    const canal = canales.ultimo();
    expect(canal.nombre.startsWith(`${PREFIJO_CANAL_LISTA_EN_VIVO}-`)).toBe(true);
    expect(canal.escuchas.filter((e) => e.tipo === "postgres_changes").map((e) => e.filtro)).toEqual([
      { event: "*", schema: "public", table: "reservas" },
    ]);
    expect(canal.escuchas.some((e) => e.tipo === "system")).toBe(true);
    expect(canal.alEstado).toBeTypeOf("function");
  });

  it("dos Listas montadas a la vez usan canales con nombre DISTINTO", () => {
    montar();
    montar();

    expect(new Set(canales.nombres()).size).toBe(2);
  });

  it("una reserva nueva (o cambiada) en otro dispositivo vuelve a pedir la Lista, 1 s después", async () => {
    vi.useFakeTimers();
    const { lecturas } = montar();
    await avanzar(0);
    expect(lecturas).toHaveBeenCalledTimes(1); // la carga al montar

    act(() => canales.ultimo().cambio({ eventType: "INSERT", new: { id: "r-nueva" } }));
    await avanzar(ESPERA_INVALIDACION_MS - 1);
    expect(lecturas).toHaveBeenCalledTimes(1);
    await avanzar(1);
    expect(lecturas).toHaveBeenCalledTimes(2);
  });

  it("una ráfaga (861 altas de golpe) = UNA relectura; sin parar, una cada 5 s como mucho", async () => {
    vi.useFakeTimers();
    const { queryClient } = montar();
    await avanzar(0);
    const invalidar = vi.spyOn(queryClient, "invalidateQueries");

    act(() => {
      for (let i = 0; i < 861; i++) canales.ultimo().cambio({ eventType: "INSERT", new: { id: `demo-${i}` } });
    });
    await avanzar(ESPERA_INVALIDACION_MS);
    expect(invalidar).toHaveBeenCalledTimes(1);

    // Un evento cada 500 ms durante 12 s: nunca pasa 1 s sin eventos, así que manda el tope de 5 s.
    for (let t = 0; t < 12_000; t += 500) {
      act(() => canales.ultimo().cambio({ eventType: "UPDATE", new: { id: "r1" } }));
      await avanzar(500);
    }
    expect(invalidar).toHaveBeenCalledTimes(1 + 2); // a los 5 s y a los 10 s
    await avanzar(ESPERA_INVALIDACION_MS);
    expect(invalidar).toHaveBeenCalledTimes(1 + 3); // y la última, 1 s después del último evento
  });

  it("refresca SOLO la Lista: las consultas de «Hoy» no (esas son de `useReservasEnVivo`)", async () => {
    vi.useFakeTimers();
    const { queryClient } = montar();
    await avanzar(0);
    const otras = [["reservas-kanban", "2026-11-10"], ["reservas-hoy", "pendientes-mesa", "2026-11-10"], ["reservas_mes"]];
    for (const clave of otras) queryClient.setQueryData(clave, []);

    act(() => canales.ultimo().cambio({ eventType: "DELETE", old: { id: "r1" } }));
    await avanzar(ESPERA_INVALIDACION_MS);

    for (const clave of otras) expect(queryClient.getQueryState(clave)?.isInvalidated).toBe(false);
  });

  it("con la pestaña del navegador OCULTA no relee el histórico: lo marca y lo relee al volver", async () => {
    vi.useFakeTimers();
    const { queryClient, lecturas } = montar();
    await avanzar(0);
    expect(lecturas).toHaveBeenCalledTimes(1);

    pestana("hidden");
    act(() => canales.ultimo().cambio({ eventType: "INSERT", new: { id: "r-nueva" } }));
    await avanzar(ESPERA_INVALIDACION_MS);
    expect(lecturas).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState([CLAVE_LISTA_RESERVAS])?.isInvalidated).toBe(true);

    // Vuelve a la pestaña antes de 30 s: sin la marca, el `staleTime` evitaría la relectura.
    pestana("visible");
    act(() => focusManager.setFocused(true));
    await avanzar(0);
    expect(lecturas).toHaveBeenCalledTimes(2);
  });

  it("al reconectar relee (Realtime no reenvía lo perdido); el primer SUBSCRIBED no, la Lista se acaba de pedir", async () => {
    vi.useFakeTimers();
    const { lecturas } = montar();
    await avanzar(0);

    act(() => canales.ultimo().estado("SUBSCRIBED"));
    await avanzar(ESPERA_MAXIMA_INVALIDACION_MS * 2);
    expect(lecturas).toHaveBeenCalledTimes(1);

    act(() => {
      canales.ultimo().estado("CHANNEL_ERROR"); // se cae la red (o la tablet se duerme)…
      canales.ultimo().estado("SUBSCRIBED"); // …y realtime-js vuelve a unir el canal
    });
    await avanzar(ESPERA_INVALIDACION_MS);
    expect(lecturas).toHaveBeenCalledTimes(2);
  });

  it("al desmontar quita SU canal, cancela la relectura pendiente y el CLOSED de esa salida no avisa", async () => {
    vi.useFakeTimers();
    const { queryClient, unmount } = montar();
    await avanzar(0);
    const invalidar = vi.spyOn(queryClient, "invalidateQueries");
    const canal = canales.ultimo();

    act(() => canal.cambio({ eventType: "INSERT", new: { id: "r1" } }));
    unmount(); // el doble emite CLOSED dentro de removeChannel, como realtime-js
    expect(canales.removeChannel).toHaveBeenCalledWith(canal);

    await avanzar(ESPERA_MAXIMA_INVALIDACION_MS * 2);
    expect(invalidar).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("avisa por consola UNA vez si el servidor no puede escuchar `reservas` (tabla sin publicar)", () => {
    montar();

    act(() => {
      canales.ultimo().estado("SUBSCRIBED");
      canales.ultimo().sistema({
        extension: "postgres_changes",
        status: "error",
        message: "Unable to subscribe to changes with given parameters… [table: reservas]",
      });
      canales.ultimo().estado("CHANNEL_ERROR");
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[realtime]");
    expect(String(warn.mock.calls[0][0])).toContain("(tabla reservas)");
  });
});
