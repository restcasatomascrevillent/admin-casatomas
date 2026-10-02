/**
 * Las tres suscripciones realtime que ya existían (rejilla de salas, modo servicio y panel
 * «Asignación»). Hasta el 2026-10-01 llamaban a `.subscribe()` SIN callback de estado y
 * `reservas` / `asignaciones_mesa` no estaban en la publicación: no llegaba nada y nada avisaba.
 *
 * Aquí se mira la SUSCRIPCIÓN y el respaldo (las consultas se quedan en vuelo salvo que el test
 * pida lo contrario):
 *   · dos instancias del mismo hook nunca comparten nombre de canal;
 *   · cada canal pasa su callback de estado y escucha `system`: un fallo avisa UNA vez;
 *   · ningún canal mezcla `reservas` con `asignaciones_mesa`: el servidor da de alta las
 *     escuchas de un canal en una transacción y una tabla sin publicar las tumba TODAS
 *     (la migración 20261001200000 publica las dos; por separado, si una deja de estarlo,
 *     la otra sigue llegando);
 *   · una ráfaga de eventos invalida UNA vez (diferido), no una por evento;
 *   · la rejilla de salas no abre canal propio dentro de una pantalla con `useReservasEnVivo`;
 *   · modo servicio y Asignación se releen cada minuto (respaldo sin realtime) y el intervalo no
 *     se solapa con una lectura en curso;
 *   · al desmontar se quitan sus canales y el CLOSED de esa salida (síncrono, como en
 *     realtime-js) no avisa.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ responderAlMomento: false }));

vi.mock("@/integrations/supabase/client", async () => {
  const { crearDobleCanales } = await import("@/hooks/__tests__/dobleCanalRealtime");
  const canales = crearDobleCanales();
  // Cualquier consulta encadena lo que sea; se queda en vuelo, o responde vacía al momento si el
  // test lo pide (`h.responderAlMomento`).
  const consulta = (): unknown => {
    const q: unknown = new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "then"
            ? (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
                h.responderAlMomento
                  ? Promise.resolve({ data: [], count: 0, error: null }).then(ok, ko)
                  : new Promise(() => {})
            : () => q,
      },
    );
    return q;
  };
  return {
    supabase: { from: vi.fn(() => consulta()), channel: canales.channel, removeChannel: canales.removeChannel, __canales: canales },
  };
});

import { supabase } from "@/integrations/supabase/client";
import { CLAVE_OCUPACION_SALAS_DIA, useOcupacionSalasDia } from "@/hooks/useOcupacionSalasDia";
import { CLAVE_RESERVAS_SERVICIO_DIA, useReservasServicioDia } from "@/hooks/useReservasServicioDia";
import { useReservasPorAsignar } from "@/hooks/useReservasPorAsignar";
import { CLAVE_RESUMEN_ASIGNACION_DIA } from "@/hooks/useResumenAsignacionDia";
import { ReservasEnVivoContexto } from "@/hooks/useReservasEnVivo";
import { CLAVE_ASIGNACIONES_MESA, useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { ESPERA_INVALIDACION_MS, INTERVALO_SONDEO_MS, olvidarAvisosRealtime, REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import type { DobleCanales } from "./dobleCanalRealtime";

const canales = (supabase as unknown as { __canales: DobleCanales }).__canales;

const FECHA = "2026-10-01";
const HASTA = "2026-10-08";
const ERROR_SIN_PUBLICAR = {
  extension: "postgres_changes",
  status: "error",
  message: "Unable to subscribe to changes with given parameters. Please check Realtime is enabled…",
};

/** Las opciones con las que se observa una consulta (p. ej. su `refetchInterval`). */
const opciones = (queryClient: QueryClient, queryKey: unknown[]) =>
  queryClient.getQueryCache().find({ queryKey })?.observers[0]?.options;

function conCliente<T>(hook: () => T, config: { enVivo?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ReservasEnVivoContexto.Provider value={!!config.enVivo}>{children}</ReservasEnVivoContexto.Provider>
    </QueryClientProvider>
  );
  return { queryClient, ...renderHook(hook, { wrapper }) };
}

const HOOKS = [
  {
    nombre: "useOcupacionSalasDia",
    montar: () => conCliente(() => useOcupacionSalasDia(FECHA)),
    canales: 1,
    invalidacionesTrasRafaga: 1,
  },
  {
    nombre: "useReservasServicioDia",
    montar: () => conCliente(() => useReservasServicioDia(FECHA)),
    canales: 2,
    // Cada canal invalida lo suyo: las reservas del día y las mesas.
    invalidacionesTrasRafaga: 2,
  },
  {
    nombre: "useReservasPorAsignar",
    montar: () => conCliente(() => useReservasPorAsignar(FECHA, HASTA)),
    canales: 2,
    // Los dos canales refrescan la misma consulta: una sola invalidación para los dos.
    invalidacionesTrasRafaga: 1,
  },
] as const;

describe("suscripciones realtime de la rejilla de salas, el modo servicio y Asignación", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    canales.reiniciar();
    olvidarAvisosRealtime();
    h.responderAlMomento = false;
    vi.mocked(supabase.from).mockClear();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  it.each(HOOKS)("$nombre: dos instancias a la vez nunca comparten nombre de canal", ({ montar, canales: porInstancia }) => {
    montar();
    montar();

    const nombres = canales.nombres();
    expect(nombres).toHaveLength(porInstancia * 2);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it.each(HOOKS)(
    "$nombre: cada canal pasa su callback de estado y escucha `system`: un fallo avisa UNA vez",
    ({ montar }) => {
      montar();

      for (const canal of canales.canales) {
        warn.mockClear();
        olvidarAvisosRealtime(); // cada canal por separado (los avisos son de uno por tabla y sesión)
        expect(canal.alEstado, canal.nombre).toBeTypeOf("function");
        // La tabla sin publicar: el canal SÍ llega a SUBSCRIBED y solo lo dice el `system` del servidor.
        act(() => {
          canal.estado("SUBSCRIBED");
          canal.sistema(ERROR_SIN_PUBLICAR);
        });
        expect(warn, canal.nombre).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain(canal.nombre);
        expect(String(warn.mock.calls[0][0])).toContain(`(tabla ${canal.tablas()[0]})`);

        act(() => {
          canal.estado("CHANNEL_ERROR");
          canal.estado("TIMED_OUT");
        });
        expect(warn, canal.nombre).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each(HOOKS)("$nombre: ningún canal mezcla `reservas` con `asignaciones_mesa`", ({ montar }) => {
    montar();

    for (const canal of canales.canales) {
      expect(canal.tablas(), canal.nombre).toHaveLength(1);
    }
  });

  it("useReservasPorAsignar escucha `reservas` y `asignaciones_mesa`, cada una en su canal", () => {
    conCliente(() => useReservasPorAsignar(FECHA, HASTA));

    expect(canales.canales.map((c) => c.tablas())).toEqual([["reservas"], ["asignaciones_mesa"]]);
  });

  it.each(HOOKS)(
    "$nombre: una ráfaga (20 eventos por canal) invalida $invalidacionesTrasRafaga vez/veces, 1 s después, no una por evento",
    ({ montar, invalidacionesTrasRafaga }) => {
      vi.useFakeTimers();
      const { queryClient } = montar();
      const invalidar = vi.spyOn(queryClient, "invalidateQueries");

      for (const canal of canales.canales) {
        for (let i = 0; i < 20; i++) canal.cambio({ eventType: "INSERT", new: { id: `r${i}` } });
      }
      expect(invalidar).not.toHaveBeenCalled();
      vi.advanceTimersByTime(ESPERA_INVALIDACION_MS);
      expect(invalidar).toHaveBeenCalledTimes(invalidacionesTrasRafaga);
    },
  );

  it("modo servicio: el canal de mesas invalida SOLO las mesas y el de reservas SOLO las reservas de ese día", () => {
    vi.useFakeTimers();
    const { queryClient } = conCliente(() => useReservasServicioDia(FECHA));
    const invalidar = vi.spyOn(queryClient, "invalidateQueries");
    const canalDe = (tabla: string) => canales.canales.find((c) => c.tablas()[0] === tabla)!;

    canalDe("asignaciones_mesa").cambio({ eventType: "INSERT", new: { id: "a1" } });
    vi.advanceTimersByTime(ESPERA_INVALIDACION_MS);
    expect(invalidar.mock.calls.map(([filtro]) => filtro)).toEqual([{ queryKey: [CLAVE_ASIGNACIONES_MESA] }]);

    invalidar.mockClear();
    canalDe("reservas").cambio({ eventType: "UPDATE", new: { id: "r1" } });
    vi.advanceTimersByTime(ESPERA_INVALIDACION_MS);
    expect(invalidar.mock.calls.map(([filtro]) => filtro)).toEqual([{ queryKey: [CLAVE_RESERVAS_SERVICIO_DIA, FECHA] }]);
  });

  it("la rejilla de salas no abre canal propio dentro de una pantalla con `useReservasEnVivo` (Hoy, Calendario)", () => {
    conCliente(() => useOcupacionSalasDia(FECHA), { enVivo: true });
    expect(canales.canales).toHaveLength(0);

    conCliente(() => useOcupacionSalasDia(FECHA));
    expect(canales.canales.map((c) => c.tablas())).toEqual([["reservas"]]);
  });

  it("dentro de esa pantalla la rejilla se relee cada minuto como el resto (sin realtime no le llega nada); fuera, no", () => {
    const dentro = conCliente(() => useOcupacionSalasDia(FECHA), { enVivo: true });
    const fuera = conCliente(() => useOcupacionSalasDia("2026-10-05"));

    expect(opciones(dentro.queryClient, [CLAVE_OCUPACION_SALAS_DIA, FECHA])).toMatchObject({
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
    expect(opciones(fuera.queryClient, [CLAVE_OCUPACION_SALAS_DIA, "2026-10-05"])?.refetchInterval).toBeUndefined();
  });

  it("useAsignacionesMesa aplica el refresco que se le pide (Hoy, modo servicio) y, si no se pide, ninguno", () => {
    const con = conCliente(() => useAsignacionesMesa(FECHA, undefined, undefined, REFRESCO_PERIODICO));
    const sin = conCliente(() => useAsignacionesMesa("2026-10-05"));

    expect(opciones(con.queryClient, [CLAVE_ASIGNACIONES_MESA, FECHA, undefined])).toMatchObject({
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
    expect(opciones(sin.queryClient, [CLAVE_ASIGNACIONES_MESA, "2026-10-05", undefined])?.refetchInterval).toBeUndefined();
  });

  it("modo servicio y Asignación se releen cada minuto con la pestaña a la vista (respaldo sin realtime)", () => {
    const servicio = conCliente(() => useReservasServicioDia(FECHA));
    const asignacion = conCliente(() => useReservasPorAsignar(FECHA, HASTA));

    expect(opciones(servicio.queryClient, [CLAVE_RESERVAS_SERVICIO_DIA, FECHA, null])).toMatchObject({
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
    expect(opciones(asignacion.queryClient, [CLAVE_RESUMEN_ASIGNACION_DIA, "rango", FECHA, HASTA])).toMatchObject({
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
  });

  it("Asignación: el refresco de cada minuto no se solapa con una lectura por lotes en curso", async () => {
    vi.useFakeTimers();
    const lecturasDeLaVista = () =>
      vi.mocked(supabase.from).mock.calls.filter(([tabla]) => String(tabla) === "vista_asignacion_dia").length;

    // Lectura en vuelo: pasan minutos y no se lanza otra encima.
    conCliente(() => useReservasPorAsignar(FECHA, HASTA));
    expect(lecturasDeLaVista()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_SONDEO_MS * 3);
    });
    expect(lecturasDeLaVista()).toBe(1);

    // Con la lectura terminada, el minuto siguiente sí relee.
    h.responderAlMomento = true;
    vi.mocked(supabase.from).mockClear();
    conCliente(() => useReservasPorAsignar("2026-11-01", "2026-11-08"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(lecturasDeLaVista()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_SONDEO_MS);
    });
    expect(lecturasDeLaVista()).toBe(2);
  });

  it.each(HOOKS)("$nombre: al desmontar quita sus canales y el CLOSED de esa salida no avisa", ({ montar }) => {
    const { unmount } = montar();
    const abiertos = [...canales.canales];

    unmount(); // el doble emite CLOSED dentro de removeChannel, como realtime-js
    for (const canal of abiertos) {
      expect(canales.removeChannel).toHaveBeenCalledWith(canal);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});
