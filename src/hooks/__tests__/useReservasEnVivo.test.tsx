/**
 * `useReservasEnVivo`: la suscripción de «Hoy» y del Calendario a `reservas` y a
 * `asignaciones_mesa` (dar o quitar mesa solo escribe ahí), cada tabla en su canal.
 *
 *   · un canal propio por tabla y por pantalla (nombre único), con INSERT/UPDATE/DELETE;
 *   · INVALIDACIÓN DIFERIDA: una ráfaga corta = UNA invalidación, 1 s después del último evento;
 *     con eventos sin parar (la demo: 861 altas en un minuto) una cada 5 s como mucho, no 861;
 *   · refresca lo de un cambio de ocupación (listas de Hoy, cifras, mes, asignación, mesas…) y NO
 *     la Lista (`reservas-lista`, que tiene su propio canal: `useListaReservasEnVivo`);
 *   · al reconectar (SUBSCRIBED a partir del segundo) relee: Realtime no reenvía lo perdido;
 *   · al desmontar quita sus canales, cancela una invalidación pendiente y no avisa de su CLOSED
 *     (el doble lo emite dentro de `removeChannel`, como realtime-js);
 *   · si un canal no recibe nada (tabla fuera de la publicación) avisa UNA vez por tabla.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", async () => {
  const { crearDobleCanales } = await import("@/hooks/__tests__/dobleCanalRealtime");
  const canales = crearDobleCanales();
  return { supabase: { channel: canales.channel, removeChannel: canales.removeChannel, __canales: canales } };
});

import { supabase } from "@/integrations/supabase/client";
import {
  CLAVES_RESERVAS_EN_VIVO,
  PREFIJO_CANAL_RESERVAS_EN_VIVO,
  seRefrescaEnVivo,
  useReservasEnVivo,
} from "@/hooks/useReservasEnVivo";
import { ESPERA_INVALIDACION_MS, ESPERA_MAXIMA_INVALIDACION_MS, olvidarAvisosRealtime } from "@/lib/realtimeCanal";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";
import type { CanalDoble, DobleCanales } from "./dobleCanalRealtime";

const canales = (supabase as unknown as { __canales: DobleCanales }).__canales;

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const vista = renderHook(() => useReservasEnVivo(), { wrapper });
  return { queryClient, ...vista };
}

/** El canal de una tabla (el último abierto, si hay varias pantallas). */
const canalDe = (tabla: string): CanalDoble => {
  const canal = [...canales.canales].reverse().find((c) => c.tablas().includes(tabla));
  if (!canal) throw new Error(`No hay canal de ${tabla}`);
  return canal;
};

describe("useReservasEnVivo", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    canales.reiniciar();
    olvidarAvisosRealtime();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  it("abre UN canal por tabla, `reservas` y `asignaciones_mesa` (INSERT, UPDATE y DELETE), cada uno con su callback de estado", () => {
    montar();

    expect(canales.canales.map((c) => c.tablas())).toEqual([["reservas"], ["asignaciones_mesa"]]);
    for (const canal of canales.canales) {
      expect(canal.nombre.startsWith(`${PREFIJO_CANAL_RESERVAS_EN_VIVO}-`)).toBe(true);
      const escuchas = canal.escuchas.filter((e) => e.tipo === "postgres_changes");
      expect(escuchas.map((e) => e.filtro)).toEqual([{ event: "*", schema: "public", table: canal.tablas()[0] }]);
      expect(canal.alEstado).toBeTypeOf("function");
    }
  });

  it("dos pantallas montadas a la vez usan canales con nombre DISTINTO", () => {
    montar();
    montar();

    const nombres = canales.nombres();
    expect(nombres).toHaveLength(4);
    expect(new Set(nombres).size).toBe(4);
  });

  it("una ráfaga de golpe (las 861 altas de la demo en una transacción) produce UNA invalidación, 1 s después", () => {
    vi.useFakeTimers();
    const { queryClient } = montar();
    const invalidar = vi.spyOn(queryClient, "invalidateQueries");

    for (let i = 0; i < 861; i++) canalDe("reservas").cambio({ eventType: "INSERT", new: { id: `demo-${i}` } });
    vi.advanceTimersByTime(ESPERA_INVALIDACION_MS - 1);
    expect(invalidar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(invalidar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(invalidar).toHaveBeenCalledTimes(1);
  });

  it("861 eventos repartidos en un minuto: una invalidación cada 5 s como mucho (12), sin esperar a que pare la ráfaga", () => {
    vi.useFakeTimers();
    const { queryClient } = montar();
    const invalidar = vi.spyOn(queryClient, "invalidateQueries");

    for (let i = 0; i < 861; i++) {
      if (i > 0) vi.advanceTimersByTime(69); // 860 × 69 ms ≈ 59 s
      canalDe("reservas").cambio({ eventType: "INSERT", new: { id: `demo-${i}` } });
      // El tope: a los 5 s del primer evento ya se ha refrescado una vez.
      if (i * 69 === 5_037) expect(invalidar).toHaveBeenCalledTimes(1);
    }
    // 11 por tope (cada ~5 s) durante la ráfaga…
    expect(invalidar).toHaveBeenCalledTimes(11);
    // …y la última, 1 s después del último evento.
    vi.advanceTimersByTime(ESPERA_INVALIDACION_MS);
    expect(invalidar).toHaveBeenCalledTimes(12);
    vi.advanceTimersByTime(ESPERA_MAXIMA_INVALIDACION_MS * 2);
    expect(invalidar).toHaveBeenCalledTimes(12);
  });

  it("un cambio de `reservas` refresca las listas y cifras (Hoy, mes, asignación, mesas…) pero NO la Lista", () => {
    vi.useFakeTimers();
    const { queryClient } = montar();
    const claves = {
      kanban: ["reservas-kanban", "2026-10-01"],
      pendientesMesa: ["reservas-hoy", "pendientes-mesa", "2026-10-01"],
      cifrasHoy: ["reservas_hoy_resumen"],
      mes: ["reservas_mes", "2026-10"],
      asignacion: ["resumen-asignacion-dia", "2026-10-01", null],
      mesas: ["asignaciones_mesa", "2026-10-01"],
      // La rejilla por cuartos de Hoy y del Calendario: dentro de `ReservasEnVivoContexto` no abre
      // canal propio y depende justo de esta invalidación.
      rejillaSalas: ["ocupacion-salas-dia", "2026-10-01"],
      lista: ["reservas-lista"],
      otra: ["call_logs"],
    };
    for (const clave of Object.values(claves)) queryClient.setQueryData(clave, []);

    canalDe("reservas").cambio({ eventType: "UPDATE", new: { id: "r1", estado: "cancelada" } });
    vi.advanceTimersByTime(ESPERA_INVALIDACION_MS);

    const invalidada = (clave: unknown[]) => queryClient.getQueryState(clave)?.isInvalidated;
    expect(invalidada(claves.kanban)).toBe(true);
    expect(invalidada(claves.pendientesMesa)).toBe(true);
    expect(invalidada(claves.cifrasHoy)).toBe(true);
    expect(invalidada(claves.mes)).toBe(true);
    expect(invalidada(claves.asignacion)).toBe(true);
    expect(invalidada(claves.mesas)).toBe(true);
    expect(invalidada(claves.rejillaSalas)).toBe(true);
    expect(invalidada(claves.lista)).toBe(false);
    expect(invalidada(claves.otra)).toBe(false);

    // La lista es la de un cambio de ocupación hecho desde el panel, sin la Lista.
    expect([...CLAVES_RESERVAS_EN_VIVO]).toEqual(CLAVES_POR_CAMBIO.ocupacion.filter((c) => c !== "reservas-lista"));
    expect(seRefrescaEnVivo(["reservas-lista"])).toBe(false);
  });

  it("una mesa dada en otro dispositivo (`asignaciones_mesa`) refresca «Pendientes de mesa», las mesas y el panel del día", () => {
    vi.useFakeTimers();
    const { queryClient } = montar();
    const claves = {
      mesasHoy: ["asignaciones_mesa", "2026-10-01", undefined],
      pendientesMesa: ["reservas-hoy", "pendientes-mesa", "2026-10-01"],
      panelDia: ["resumen-asignacion-dia", "2026-10-01", null],
      lista: ["reservas-lista"],
    };
    for (const clave of Object.values(claves)) queryClient.setQueryData(clave, []);

    canalDe("asignaciones_mesa").cambio({ eventType: "INSERT", new: { id: "a1", reserva_id: "r1" } });
    vi.advanceTimersByTime(ESPERA_INVALIDACION_MS);

    const invalidada = (clave: unknown[]) => queryClient.getQueryState(clave)?.isInvalidated;
    expect(invalidada(claves.mesasHoy)).toBe(true);
    expect(invalidada(claves.pendientesMesa)).toBe(true);
    expect(invalidada(claves.panelDia)).toBe(true);
    expect(invalidada(claves.lista)).toBe(false);
  });

  it("al reconectar relee (Realtime no reenvía lo perdido); el primer SUBSCRIBED no, las consultas se acaban de pedir", () => {
    vi.useFakeTimers();
    const { queryClient } = montar();
    const invalidar = vi.spyOn(queryClient, "invalidateQueries");

    for (const canal of canales.canales) canal.estado("SUBSCRIBED");
    vi.advanceTimersByTime(ESPERA_MAXIMA_INVALIDACION_MS * 2);
    expect(invalidar).not.toHaveBeenCalled();

    canalDe("asignaciones_mesa").estado("CHANNEL_ERROR"); // se cae la red (o la tablet se duerme)…
    canalDe("asignaciones_mesa").estado("SUBSCRIBED"); // …y realtime-js vuelve a unir el canal
    vi.advanceTimersByTime(ESPERA_INVALIDACION_MS);
    expect(invalidar).toHaveBeenCalledTimes(1);
  });

  it("al desmontar quita SUS dos canales, cancela la invalidación pendiente y el CLOSED de esa salida no avisa", () => {
    vi.useFakeTimers();
    const { queryClient, unmount } = montar();
    const invalidar = vi.spyOn(queryClient, "invalidateQueries");
    const abiertos = [...canales.canales];

    canalDe("reservas").cambio({ eventType: "INSERT", new: { id: "r1" } });
    unmount(); // el doble emite CLOSED dentro de removeChannel, como realtime-js
    for (const canal of abiertos) expect(canales.removeChannel).toHaveBeenCalledWith(canal);

    vi.advanceTimersByTime(ESPERA_MAXIMA_INVALIDACION_MS * 2);
    expect(invalidar).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("avisa por consola UNA vez por tabla: el `system` de error del servidor (tabla sin publicar) y luego nada más", () => {
    montar();

    act(() => {
      for (const canal of canales.canales) {
        canal.estado("SUBSCRIBED");
        canal.sistema({
          extension: "postgres_changes",
          status: "error",
          message: `Unable to subscribe to changes with given parameters… [table: ${canal.tablas()[0]}]`,
        });
      }
    });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain("[realtime]");
    expect(String(warn.mock.calls[0][0])).toContain("(tabla reservas)");
    expect(String(warn.mock.calls[1][0])).toContain("(tabla asignaciones_mesa)");

    // Más fallos de los mismos canales, u otra pantalla con las mismas tablas: nada más.
    montar();
    act(() => {
      for (const canal of canales.canales) {
        canal.estado("CHANNEL_ERROR");
        canal.estado("TIMED_OUT");
        canal.sistema({ status: "error" });
      }
    });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
