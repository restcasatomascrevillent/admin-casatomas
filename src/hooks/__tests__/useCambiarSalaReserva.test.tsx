/**
 * `useCambiarSalaReserva` (vive en `useReservasPorAsignar.ts`) — tests de
 * caracterización de EFECTOS.
 *
 * Es el escritor de sala del panel «Asignación». Fijan qué se escribe y con qué
 * filtros, que NO manda correo, qué pasa cuando la escritura la deniega la RLS en
 * silencio, y qué cachés refresca.
 *
 * PASO 2 del refactor de acciones: comparte escritura (`escribirReserva`) y lista de
 * claves (`clavesCache.ts`) con el ejecutor de acciones (`useAccionesServicioReserva`),
 * el otro escritor de sala (el del kanban). Lo que cambia respecto al punto de partida:
 *   · `// BUG conocido` → CORREGIDO: no refrescaba las claves derivadas (contadores, panel,
 *     dashboard, modo servicio, disponibilidad…) que sí refrescaba el kanban; ahora las dos
 *     escrituras de sala refrescan exactamente lo mismo;
 *   · la escritura va condicionada al estado de partida (`.in("estado", …)`): una reserva
 *     cancelada o «No vino» no ocupa sitio y no se mueve, aunque el panel la enseñara.
 *   · (revisión independiente, B2) el aviso de «0 filas» YA NO miente: con la escritura condicionada,
 *     «no tienes permiso… o ya no existe» no cubre que otra persona cambiara el estado. Se relee el estado
 *     (un SELECT solo en ese fallo) y se dice «ya ha cambiado de estado (ahora está «Cancelada»)», o
 *     «no tienes permiso», o —si no se puede saber— las tres causas.
 * El contrato de la mutación (`mutateAsync({ reservaId, espacioId })`, `isPending`,
 * `variables`, `ErrorSinPermisoSala`) y que NO hay actualización optimista siguen igual.
 *
 * Afirman efectos y mutaciones, no el DOM.
 *
 * Nada llega a Supabase: el cliente y `sonner` están mockeados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ErrorSinPermisoSala, useCambiarSalaReserva } from "@/hooks/useReservasPorAsignar";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";

const DIA = "2026-09-30";

interface Escritura {
  tabla: string;
  payload: Record<string, unknown>;
  eq: [string, unknown] | null;
  /** La condición de estado de partida (`.in("estado", …)`); `null` si la escritura no la lleva. */
  en: [string, unknown[]] | null;
  select: string | null;
}
interface Respuesta {
  error?: unknown;
  data?: unknown;
  esperar?: Promise<void>;
}
/**
 * Lo que contesta la RELECTURA del estado (`select("estado").eq("id", …).maybeSingle()`), que solo se
 * hace cuando la escritura condicionada no toca nada. Sin ella, el doble no tiene `maybeSingle` y la
 * relectura se ignora (el aviso nombra las tres causas posibles).
 */
interface Relectura {
  data?: unknown;
  error?: unknown;
}

/** Cada `await` de una escritura consume la siguiente respuesta; sin más, éxito con 1 fila. */
function mockEscrituras(respuestas: Respuesta[] = [], relectura?: Relectura) {
  const escrituras: Escritura[] = [];
  const tablasConsultadas: string[] = [];
  vi.mocked(supabase.from).mockImplementation(((tabla: string) => {
    tablasConsultadas.push(tabla);
    const escritura: Escritura = { tabla, payload: {}, eq: null, en: null, select: null };
    const builder: Record<string, unknown> = {
      update: vi.fn((payload: Record<string, unknown>) => {
        escritura.payload = { ...payload };
        escrituras.push(escritura);
        return builder;
      }),
      eq: vi.fn((columna: string, valor: unknown) => {
        escritura.eq = [columna, valor];
        return builder;
      }),
      in: vi.fn((columna: string, valores: unknown[]) => {
        escritura.en = [columna, valores];
        return builder;
      }),
      select: vi.fn((columnas: string) => {
        escritura.select = columnas;
        return builder;
      }),
      maybeSingle: relectura
        ? vi.fn(() => Promise.resolve({ data: relectura.data ?? null, error: relectura.error ?? null }))
        : undefined,
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const r = respuestas.shift() ?? {};
        const resolver = async () => {
          if (r.esperar) await r.esperar;
          const data = "data" in r ? r.data : r.error ? null : [{ id: "res-1" }];
          return { data, error: r.error ?? null };
        };
        return resolver().then(ok, ko);
      },
    };
    return builder;
  }) as never);
  return { escrituras, tablasConsultadas };
}

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const reservaEnCache = { id: "res-1", estado: "confirmada", espacio_id: "salon" };
  queryClient.setQueryData(["reservas-kanban", DIA], [reservaEnCache]);
  queryClient.setQueryData(["reservas-hoy", DIA], [reservaEnCache]);
  queryClient.setQueryData(["reservas-lista"], [reservaEnCache]);

  const invalidadas: string[] = [];
  const invalidar = queryClient.invalidateQueries.bind(queryClient);
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filtros, opciones) => {
    invalidadas.push(String((filtros as { queryKey: unknown[] }).queryKey[0]));
    return invalidar(filtros, opciones);
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCambiarSalaReserva(), { wrapper });
  return { result, queryClient, invalidadas };
}

/**
 * Lo que refresca SIEMPRE este escritor (éxito o fallo), en este orden: la lista única de
 * `clavesCache.ts`, la misma que el kanban. Antes eran seis (mesas, rejilla de salas y
 * listas) y NO las del kanban.
 */
const CLAVES_QUE_REFRESCA = [...CLAVES_POR_CAMBIO.ocupacion];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCambiarSalaReserva · qué escribe", () => {
  it("cambia `espacio_id` en `reservas`, filtrando por id, SOLO si ocupa sitio, y pidiendo la fila de vuelta (`select('id')`)", async () => {
    const { escrituras } = mockEscrituras();
    const { result } = montar();

    let devuelto: unknown;
    await act(async () => {
      devuelto = await result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" });
    });

    expect(escrituras).toEqual([
      {
        tabla: "reservas",
        payload: { espacio_id: "terraza" },
        eq: ["id", "res-1"],
        // Cancelada y «No vino» no ocupan sitio: no se mueven (la misma regla que «Mover a…» del kanban).
        en: ["estado", ["pendiente", "verificada", "confirmada", "completada"]],
        select: "id",
      },
    ]);
    expect(devuelto).toEqual({ id: "res-1" });
  });

  it("solo toca `reservas`: no consulta las mesas asignadas antes de quitar la sala (el trigger de la BD las borra)", async () => {
    // `trg_reservas_sincronizar_asignaciones` BORRA las mesas de la reserva cuando cambia
    // su sala. El hook no lo comprueba ni lo avisa: lo hace quien lo llama, pidiendo
    // confirmación antes (ver su docstring).
    const { tablasConsultadas } = mockEscrituras();
    const { result } = montar();

    await act(async () => {
      await result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" });
    });

    expect(tablasConsultadas).toEqual(["reservas"]);
  });

  it.each([
    ["sin reserva", { reservaId: "", espacioId: "terraza" }],
    ["sin sala", { reservaId: "res-1", espacioId: "" }],
    ["con la sala a null (nunca se deja una reserva sin sala desde aquí)", { reservaId: "res-1", espacioId: null as unknown as string }],
  ])("%s: rechaza antes de escribir nada", async (_n, variables) => {
    const { escrituras } = mockEscrituras();
    const { result } = montar();

    await act(async () => {
      await expect(result.current.mutateAsync(variables)).rejects.toThrow("Falta la reserva o la sala");
    });

    expect(escrituras).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("useCambiarSalaReserva · quién manda correo: nadie", () => {
  // Cambiar la sala es una asignación INTERNA: la sala no sale en el correo del cliente.
  it("con éxito no llama a notify-reservation-change ni a ninguna otra función", async () => {
    mockEscrituras();
    const { result } = montar();

    await act(async () => {
      await result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" });
    });

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("con fallo tampoco", async () => {
    mockEscrituras([{ error: { code: "42501", message: "denegado" } }]);
    const { result } = montar();

    await act(async () => {
      await expect(result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" })).rejects.toBeTruthy();
    });

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});

describe("useCambiarSalaReserva · cuando la escritura falla", () => {
  it("con error de la BD: la mutación falla con ESE error (el aviso lo pone quien llama; el hook no usa toast)", async () => {
    const errorDeBd = { code: "42501", message: "permission denied for table reservas" };
    mockEscrituras([{ error: errorDeBd }]);
    const { result } = montar();

    await act(async () => {
      await expect(result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" })).rejects.toBe(errorDeBd);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    ["0 filas", []],
    ["data null", null],
  ])("escritura denegada por RLS (%s, sin error): falla con ErrorSinPermisoSala en vez de dar el cambio por hecho", async (_n, data) => {
    mockEscrituras([{ data }]);
    const { result } = montar();

    await act(async () => {
      const promesa = result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" });
      await expect(promesa).rejects.toBeInstanceOf(ErrorSinPermisoSala);
      // Como la escritura va condicionada al estado, «no tienes permiso… o ya no existe» se quedaba corto:
      // si no se puede releer el estado, el aviso nombra también el cambio de estado ajeno.
      await expect(promesa).rejects.toThrow(
        "No tienes permiso para cambiar la sala de esta reserva, o la reserva ya no existe o ya ha cambiado de estado.",
      );
    });

    expect(toast.success).not.toHaveBeenCalled();
  });

  it("B2: una reserva que ya se canceló mientras el panel la enseñaba no se mueve: lo dice, con el estado de verdad, en vez de «no tienes permiso»", async () => {
    // La escritura va condicionada al estado; con la reserva ya cancelada no toca ninguna fila y se relee.
    mockEscrituras([{ data: [] }], { data: { estado: "cancelada" } });
    const { result } = montar();

    await act(async () => {
      const promesa = result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" });
      await expect(promesa).rejects.toBeInstanceOf(ErrorSinPermisoSala);
      await expect(promesa).rejects.toThrow(
        "La reserva ya ha cambiado de estado (ahora está «Cancelada») y no se ha cambiado la sala. Se ha refrescado la pantalla.",
      );
    });
  });

  it("B2: lo mismo con «No vino»", async () => {
    mockEscrituras([{ data: [] }], { data: { estado: "no_show" } });
    const { result } = montar();

    await act(async () => {
      await expect(result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" })).rejects.toThrow(
        "(ahora está «No vino»)",
      );
    });
  });

  it("B2: si la reserva sigue en un estado que se puede mover y aun así no se escribe, es la RLS: «no tienes permiso», sin inventar que ya no existe", async () => {
    mockEscrituras([{ data: [] }], { data: { estado: "confirmada" } });
    const { result } = montar();

    await act(async () => {
      await expect(result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" })).rejects.toThrow(
        "No tienes permiso para cambiar la sala de esta reserva.",
      );
    });
  });

  it("B2: si ni se puede ver la reserva: «no tienes permiso, o la reserva ya no existe»", async () => {
    mockEscrituras([{ data: [] }], { data: null });
    const { result } = montar();

    await act(async () => {
      await expect(result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" })).rejects.toThrow(
        "No tienes permiso para cambiar la sala de esta reserva, o la reserva ya no existe.",
      );
    });
  });

  it("todos estos avisos son del mismo tipo (`ErrorSinPermisoSala`): el panel enseña su mensaje tal cual", async () => {
    mockEscrituras([{ data: [] }], { data: { estado: "cancelada" } });
    const { result } = montar();

    await act(async () => {
      const promesa = result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" });
      await expect(promesa).rejects.toBeInstanceOf(ErrorSinPermisoSala);
      await expect(promesa).rejects.toHaveProperty("name", "ErrorSinPermisoSala");
    });
  });
});

describe("useCambiarSalaReserva · caché", () => {
  it("con éxito refresca la lista única de claves, una vez cada una, en este orden", async () => {
    mockEscrituras();
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" });
    });

    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA);
  });

  it("con error de la BD las refresca igual (`onSettled`)", async () => {
    mockEscrituras([{ error: { code: "42501", message: "denegado" } }]);
    const { result, invalidadas } = montar();

    await act(async () => {
      await expect(result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" })).rejects.toBeTruthy();
    });

    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA);
  });

  it("con la escritura denegada por RLS (0 filas) también", async () => {
    mockEscrituras([{ data: [] }]);
    const { result, invalidadas } = montar();

    await act(async () => {
      await expect(result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" })).rejects.toBeInstanceOf(
        ErrorSinPermisoSala,
      );
    });

    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA);
  });

  it("con parámetros inválidos refresca igual (la validación está dentro del `mutationFn` y `onSettled` corre al fallar)", async () => {
    // Refresca la lista entera aunque no se haya escrito nada. Se fija tal cual.
    mockEscrituras();
    const { result, invalidadas } = montar();

    await act(async () => {
      await expect(result.current.mutateAsync({ reservaId: "", espacioId: "x" })).rejects.toBeTruthy();
    });

    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA);
  });

  it("NO hay actualización optimista: las listas se quedan como estaban hasta el refetch", async () => {
    // `useAccionesServicioReserva` (kanban) sí cambia la fila en local antes de escribir y
    // hace rollback si falla. Este escritor no: la reserva sigue en su sala vieja hasta
    // que vuelve la consulta.
    let liberar!: () => void;
    mockEscrituras([{ esperar: new Promise<void>((r) => (liberar = r)) }]);
    const { result, queryClient } = montar();

    let promesa!: Promise<unknown>;
    act(() => {
      promesa = result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" });
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));

    expect(queryClient.getQueryData<{ espacio_id: string }[]>(["reservas-kanban", DIA])![0].espacio_id).toBe("salon");

    await act(async () => {
      liberar();
      await promesa;
    });
    expect(queryClient.getQueryData<{ espacio_id: string }[]>(["reservas-kanban", DIA])![0].espacio_id).toBe("salon");
  });

  it("CORREGIDO (antes BUG conocido): refresca también las claves derivadas que sí refrescaba el kanban (contadores, panel, dashboard, modo servicio, disponibilidad…)", async () => {
    // Dos escritores de sala (este y `useAccionesServicioReserva.moverEspacio`) hacen el mismo
    // UPDATE de `espacio_id`. Este no refrescaba los contadores de Hoy, el dashboard, el modo
    // servicio ni la disponibilidad; ahora los dos leen la misma lista (`clavesCache.ts`).
    mockEscrituras();
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" });
    });

    for (const clave of [
      "reservas_hoy_resumen",
      "reservas_hoy_todas",
      "ocupacion_hoy",
      "today-reservations",
      "dashboard-stats",
      "reservas_mes",
      "reservas-servicio-dia",
      "reservas_sala_dia",
      "disponibilidad",
      "disponibilidad-detallada",
      "disponibilidad-rango",
      "disponibilidad-calculada",
    ]) {
      expect(invalidadas, clave).toContain(clave);
    }
  });
});

describe("useCambiarSalaReserva · estado de la mutación", () => {
  it("`isPending` y `variables` dicen qué reserva está en curso (lo usa el panel para pintar «guardando»)", async () => {
    let liberar!: () => void;
    mockEscrituras([{ esperar: new Promise<void>((r) => (liberar = r)) }]);
    const { result } = montar();

    expect(result.current.isPending).toBe(false);
    let promesa!: Promise<unknown>;
    act(() => {
      promesa = result.current.mutateAsync({ reservaId: "res-1", espacioId: "terraza" });
    });

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(result.current.variables).toEqual({ reservaId: "res-1", espacioId: "terraza" });

    await act(async () => {
      liberar();
      await promesa;
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});
