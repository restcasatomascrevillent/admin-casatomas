/**
 * `useAccionesServicioReserva` — tests de caracterización de EFECTOS.
 *
 * Fijan lo que el hook hace HOY, aunque alguna parte sea fea, para que el paso
 * que lo amplíe (un único ejecutor de acciones sobre una reserva) sepa qué está
 * cambiando. Lo que se afirma son efectos y mutaciones —qué se escribe y con qué
 * filtros, quién manda correo, qué cachés se tocan y cuáles se refrescan, qué pasa
 * cuando la escritura falla—, NO el DOM ni el número de botones. Lo que ya cubre
 * `useAccionesServicioReserva.test.tsx` (rollback básico, reintento sin
 * `llegada_at`, «0 filas = error» en mover y llegada) no se repite.
 *
 * `// BUG conocido` marca lo que está mal y se deja así a propósito: este fichero
 * NO arregla nada, describe el punto de partida.
 *
 * Nada llega a Supabase: el cliente y `sonner` están mockeados.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  CLAVES_LISTAS_RESERVAS,
  ErrorSinFilasReserva,
  useAccionesServicioReserva,
  __resetColumnaLlegadaParaTests,
} from "@/hooks/useAccionesServicioReserva";
import type { ReservaServicio } from "@/lib/reservas/servicioSala";

const DIA = "2026-09-30";

const reserva = (extra: Partial<ReservaServicio> = {}): ReservaServicio => ({
  id: "r1",
  nombre: "Ana",
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  espacio_id: null,
  ...extra,
});

// ─── Doble de Supabase: registra cada escritura completa ─────────────────────

interface Escritura {
  tabla: string;
  payload: Record<string, unknown>;
  eq: [string, unknown] | null;
  select: string | null;
}
interface Respuesta {
  error?: unknown;
  data?: unknown;
  /** La escritura no se resuelve hasta que esta promesa lo haga. */
  esperar?: Promise<void>;
}

/** Cada `await` de una escritura consume la siguiente respuesta; sin más, éxito con 1 fila. */
function mockEscrituras(respuestas: Respuesta[] = []) {
  const escrituras: Escritura[] = [];
  vi.mocked(supabase.from).mockImplementation(((tabla: string) => {
    const escritura: Escritura = { tabla, payload: {}, eq: null, select: null };
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
      select: vi.fn((columnas: string) => {
        escritura.select = columnas;
        return builder;
      }),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const r = respuestas.shift() ?? {};
        const resolver = async () => {
          if (r.esperar) await r.esperar;
          const data = "data" in r ? r.data : r.error ? null : [{ id: "r1" }];
          return { data, error: r.error ?? null };
        };
        return resolver().then(ok, ko);
      },
    };
    return builder;
  }) as never);
  return escrituras;
}

// ─── Montaje: un QueryClient con la reserva en todas las listas que el hook toca ─

function montar(enCache: ReservaServicio = reserva()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClient.setQueryData(["reservas-kanban", DIA], [enCache]);
  queryClient.setQueryData(["reservas-hoy", DIA], [enCache]);
  // Cuelga del prefijo "reservas-hoy" (la franja «Pendientes de mesa» de VistaHoy).
  queryClient.setQueryData(["reservas-hoy", "pendientes-mesa", DIA], [enCache]);
  queryClient.setQueryData(["reservas-lista"], [enCache]);
  // Bajo el mismo prefijo, pero con datos que NO son una lista de filas: no se tocan.
  queryClient.setQueryData(["reservas-hoy", "resumen"], { total: 7 });
  // Otra familia de claves: tampoco.
  queryClient.setQueryData(["otra-cosa", DIA], [enCache]);

  const invalidadas: string[] = [];
  const canceladas: string[] = [];
  const invalidar = queryClient.invalidateQueries.bind(queryClient);
  const cancelar = queryClient.cancelQueries.bind(queryClient);
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filtros, opciones) => {
    invalidadas.push(String((filtros as { queryKey: unknown[] }).queryKey[0]));
    return invalidar(filtros, opciones);
  });
  vi.spyOn(queryClient, "cancelQueries").mockImplementation((filtros, opciones) => {
    canceladas.push(String((filtros as { queryKey: unknown[] }).queryKey[0]));
    return cancelar(filtros, opciones);
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useAccionesServicioReserva(), { wrapper });

  const fila = (clave: unknown[]) => queryClient.getQueryData<ReservaServicio[]>(clave)![0];
  return { result, queryClient, invalidadas, canceladas, fila };
}

/** Las once claves que el hook refresca SIEMPRE, en este orden (listas, luego derivadas). */
const CLAVES_QUE_REFRESCA = [
  "reservas-kanban",
  "reservas-hoy",
  "reservas-lista",
  "reservas_hoy_resumen",
  "reservas_hoy_todas",
  "ocupacion_hoy",
  "today-reservations",
  "today-confirmed-reservations",
  "dashboard-stats",
  "reservas_mes",
  "ocupacion-salas-dia",
];

/**
 * Cambiar la sala (mover, y su «Deshacer») refresca además las mesas asignadas: el trigger
 * `trg_reservas_sincronizar_asignaciones` las BORRA al cambiar `espacio_id`. Mismas dos claves
 * y mismo orden que `useCambiarSalaReserva`.
 */
const CLAVES_QUE_REFRESCA_AL_CAMBIAR_SALA = [...CLAVES_QUE_REFRESCA, "resumen-asignacion-dia", "asignaciones_mesa"];

/** Acción del botón «Deshacer» del toast de éxito que se acaba de lanzar. */
function accionDeshacerDelToast() {
  const llamadas = vi.mocked(toast.success).mock.calls;
  const opciones = llamadas.at(-1)?.[1] as { action?: { label: string; onClick: () => void } } | undefined;
  return opciones?.action;
}

let consolaError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetColumnaLlegadaParaTests();
  consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consolaError.mockRestore();
});

describe("qué se escribe, y dónde", () => {
  it("escribe en `reservas`, filtrando por id y pidiendo la fila de vuelta (`select('id')`)", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar();

    await act(async () => {
      await result.current.moverEspacio(reserva(), "terraza", "Terraza");
    });

    expect(escrituras).toEqual([
      { tabla: "reservas", payload: { espacio_id: "terraza" }, eq: ["id", "r1"], select: "id" },
    ]);
  });

  it("mover a «Sin asignar» escribe espacio_id null", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar(reserva({ espacio_id: "salon" }));

    await act(async () => {
      await result.current.moverEspacio(reserva({ espacio_id: "salon" }), null, "Sin asignar");
    });

    expect(escrituras[0].payload).toEqual({ espacio_id: null });
  });

  it("«Ha llegado»: estado 'completada' + llegada_at con la hora de ahora (ISO)", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar();
    const antes = Date.now();

    await act(async () => {
      await result.current.marcarLlegada(reserva());
    });

    const { estado, llegada_at } = escrituras[0].payload as { estado: string; llegada_at: string };
    expect(estado).toBe("completada");
    expect(new Date(llegada_at).toISOString()).toBe(llegada_at);
    expect(new Date(llegada_at).getTime()).toBeGreaterThanOrEqual(antes);
    expect(new Date(llegada_at).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("«No vino»: estado 'no_show' y llegada_at null", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar();

    await act(async () => {
      await result.current.marcarNoShow(reserva());
    });

    expect(escrituras[0].payload).toEqual({ estado: "no_show", llegada_at: null });
  });

  it.each(["completada", "no_show"])("«Deshacer» desde el chip de %s: SIEMPRE vuelve a 'confirmada' y borra llegada_at", async (estado) => {
    const escrituras = mockEscrituras();
    const { result } = montar(reserva({ estado }));

    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado }));
    });

    expect(escrituras[0].payload).toEqual({ estado: "confirmada", llegada_at: null });
  });

  it("Comportamiento a decidir: deshacer desde el chip devuelve a 'confirmada' aunque la reserva viniera de 'pendiente'", async () => {
    // No es un bug claro (el comentario del hook lo defiende: «el cliente ya tenía
    // su confirmación»), pero una reserva que nunca se verificó acaba 'confirmada'
    // sin pasar por la verificación ni mandar correo. El «Deshacer» del TOAST, en
    // cambio, sí restaura el estado previo: ver más abajo.
    const escrituras = mockEscrituras([{}, {}]);
    const { result } = montar(reserva({ estado: "pendiente" }));

    await act(async () => {
      await result.current.marcarLlegada(reserva({ estado: "pendiente" }));
    });
    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    expect(escrituras[1].payload.estado).toBe("confirmada");
  });
});

describe("el «Deshacer» del toast restaura lo que había", () => {
  it("mover: vuelve a la sala de origen (o a «sin asignar»)", async () => {
    const escrituras = mockEscrituras([{}, {}]);
    const { result, fila } = montar(reserva({ espacio_id: "salon" }));

    await act(async () => {
      await result.current.moverEspacio(reserva({ espacio_id: "salon" }), "terraza", "Terraza");
    });
    const deshacer = accionDeshacerDelToast();
    expect(deshacer?.label).toBe("Deshacer");

    await act(async () => {
      deshacer!.onClick();
    });
    await waitFor(() => expect(escrituras).toHaveLength(2));
    await waitFor(() => expect(result.current.estaEnCurso("r1")).toBe(false));

    expect(escrituras[1].payload).toEqual({ espacio_id: "salon" });
    expect(fila(["reservas-kanban", DIA]).espacio_id).toBe("salon");
  });

  it("mover desde «sin asignar» deshace a null, no a undefined", async () => {
    const escrituras = mockEscrituras([{}, {}]);
    const { result } = montar(reserva({ espacio_id: undefined }));

    await act(async () => {
      await result.current.moverEspacio(reserva({ espacio_id: undefined }), "terraza", "Terraza");
    });
    await act(async () => {
      accionDeshacerDelToast()!.onClick();
    });
    await waitFor(() => expect(escrituras).toHaveLength(2));

    expect(escrituras[1].payload).toEqual({ espacio_id: null });
  });

  it("«Ha llegado»: restaura el estado que tenía (no fuerza 'confirmada') y borra llegada_at", async () => {
    const escrituras = mockEscrituras([{}, {}]);
    const { result } = montar(reserva({ estado: "verificada" }));

    await act(async () => {
      await result.current.marcarLlegada(reserva({ estado: "verificada" }));
    });
    await act(async () => {
      accionDeshacerDelToast()!.onClick();
    });
    await waitFor(() => expect(escrituras).toHaveLength(2));

    expect(escrituras[1].payload).toEqual({ estado: "verificada", llegada_at: null });
  });

  it("«No vino»: restaura el estado que tenía, sin tocar llegada_at", async () => {
    const escrituras = mockEscrituras([{}, {}]);
    const { result } = montar(reserva({ estado: "pendiente" }));

    await act(async () => {
      await result.current.marcarNoShow(reserva({ estado: "pendiente" }));
    });
    await act(async () => {
      accionDeshacerDelToast()!.onClick();
    });
    await waitFor(() => expect(escrituras).toHaveLength(2));

    expect(escrituras[1].payload).toEqual({ estado: "pendiente" });
  });

  it("el «Deshacer» del chip no lleva botón de deshacer en su aviso (no hay deshacer del deshacer)", async () => {
    mockEscrituras();
    const { result } = montar(reserva({ estado: "completada" }));

    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Reserva devuelta a «Confirmada»");
  });

  it("todos estos «Deshacer» son escrituras más: tampoco mandan correo", async () => {
    mockEscrituras([{}, {}, {}, {}, {}, {}]);
    const { result } = montar();

    for (const accion of [
      () => result.current.moverEspacio(reserva(), "terraza", "Terraza"),
      () => result.current.marcarLlegada(reserva()),
      () => result.current.marcarNoShow(reserva()),
    ]) {
      await act(async () => {
        await accion();
      });
      await act(async () => {
        accionDeshacerDelToast()!.onClick();
      });
      await waitFor(() => expect(result.current.estaEnCurso("r1")).toBe(false));
    }

    expect(vi.mocked(supabase.from)).toHaveBeenCalledTimes(6);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});

describe("quién manda correo: NINGUNA acción de servicio", () => {
  // `notify-reservation-change` es quien dispara los correos al cliente. Mover de
  // sala, registrar la llegada, marcar «No vino» y deshacer son decisiones internas:
  // 'completada' y 'no_show' no tienen plantilla de correo, y mover no se le cuenta
  // al cliente. Por eso, sea cual sea el argumento, `invoke` no se llama.
  const acciones: Array<[string, (r: ReturnType<typeof montar>["result"]) => Promise<unknown>, Partial<ReservaServicio>]> = [
    ["moverEspacio", (r) => r.current.moverEspacio(reserva(), "terraza", "Terraza"), {}],
    ["marcarLlegada", (r) => r.current.marcarLlegada(reserva()), {}],
    ["marcarNoShow", (r) => r.current.marcarNoShow(reserva()), {}],
    ["deshacerLlegadaONoShow (desde Llegó)", (r) => r.current.deshacerLlegadaONoShow(reserva({ estado: "completada" })), { estado: "completada" }],
    ["deshacerLlegadaONoShow (desde No vino)", (r) => r.current.deshacerLlegadaONoShow(reserva({ estado: "no_show" })), { estado: "no_show" }],
  ];

  it.each(acciones)("%s: escribe una vez y no llama a notify-reservation-change", async (_nombre, lanzar, enCache) => {
    const escrituras = mockEscrituras();
    const { result } = montar(reserva(enCache));

    let ok = false;
    await act(async () => {
      ok = (await lanzar(result)) as boolean;
    });

    expect(ok).toBe(true);
    expect(escrituras).toHaveLength(1);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it.each(acciones)("%s: ni siquiera cuando la escritura falla", async (_nombre, lanzar, enCache) => {
    mockEscrituras([{ error: { code: "42501", message: "permission denied" } }]);
    const { result } = montar(reserva(enCache));

    await act(async () => {
      await lanzar(result);
    });

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});

describe("caché: actualización optimista", () => {
  it("antes de que la BD conteste, la reserva ya está cambiada en TODAS las listas de filas bajo los tres prefijos", async () => {
    let liberar!: () => void;
    mockEscrituras([{ esperar: new Promise<void>((r) => (liberar = r)) }]);
    const { result, fila } = montar();

    let promesa!: Promise<boolean>;
    act(() => {
      promesa = result.current.marcarLlegada(reserva());
    });
    await waitFor(() => expect(fila(["reservas-kanban", DIA]).estado).toBe("completada"));

    // Las tres familias de `CLAVES_LISTAS_RESERVAS`, incluida la lista completa…
    expect(fila(["reservas-hoy", DIA]).estado).toBe("completada");
    expect(fila(["reservas-lista"]).estado).toBe("completada");
    // …y cualquier clave que CUELGUE de ellas con un array de filas.
    expect(fila(["reservas-hoy", "pendientes-mesa", DIA]).estado).toBe("completada");
    expect(typeof fila(["reservas-kanban", DIA]).llegada_at).toBe("string");
    // Lo que no es una lista de filas, o es de otra familia, se queda como estaba.
    expect(result.current.estaEnCurso("r1")).toBe(true);

    await act(async () => {
      liberar();
      await promesa;
    });
    expect(result.current.estaEnCurso("r1")).toBe(false);
  });

  it("no toca lo que no es una lista de filas ni otras familias de claves", async () => {
    mockEscrituras();
    const { result, queryClient, fila } = montar();

    await act(async () => {
      await result.current.marcarLlegada(reserva());
    });

    expect(queryClient.getQueryData(["reservas-hoy", "resumen"])).toEqual({ total: 7 });
    expect(fila(["otra-cosa", DIA]).estado).toBe("confirmada");
  });

  it("solo cambia la fila de esa reserva: las demás de la lista quedan igual", async () => {
    mockEscrituras();
    const { result, queryClient } = montar();
    queryClient.setQueryData(["reservas-kanban", DIA], [reserva(), reserva({ id: "r2", estado: "pendiente" })]);

    await act(async () => {
      await result.current.marcarLlegada(reserva());
    });

    const filas = queryClient.getQueryData<ReservaServicio[]>(["reservas-kanban", DIA])!;
    expect(filas.map((f) => [f.id, f.estado])).toEqual([
      ["r1", "completada"],
      ["r2", "pendiente"],
    ]);
  });

  it("cancela las consultas en vuelo de las tres listas ANTES de escribir (para que un refetch no pise el cambio)", async () => {
    mockEscrituras();
    const { result, canceladas } = montar();

    await act(async () => {
      await result.current.marcarNoShow(reserva());
    });

    expect(canceladas).toEqual([...CLAVES_LISTAS_RESERVAS]);
  });

  it("si la escritura falla restaura EXACTAMENTE lo que había, en todas las listas", async () => {
    mockEscrituras([{ error: { code: "42501", message: "denegado" } }]);
    const { result, queryClient, fila } = montar(reserva({ estado: "verificada", espacio_id: "salon" }));

    await act(async () => {
      await result.current.marcarLlegada(reserva({ estado: "verificada", espacio_id: "salon" }));
    });

    for (const clave of [["reservas-kanban", DIA], ["reservas-hoy", DIA], ["reservas-hoy", "pendientes-mesa", DIA], ["reservas-lista"]]) {
      expect(fila(clave), clave.join("/")).toEqual(reserva({ estado: "verificada", espacio_id: "salon" }));
    }
    expect(queryClient.getQueryData(["reservas-hoy", "resumen"])).toEqual({ total: 7 });
  });
});

describe("caché: qué se refresca después", () => {
  it("con éxito: las 3 listas y las 8 derivadas, una vez cada una, en este orden", async () => {
    mockEscrituras();
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.marcarLlegada(reserva());
    });

    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA);
    expect([...CLAVES_LISTAS_RESERVAS]).toEqual(["reservas-kanban", "reservas-hoy", "reservas-lista"]);
  });

  it("con fallo (error de la BD) se refresca igual: está en el `finally`", async () => {
    mockEscrituras([{ error: { code: "42501", message: "denegado" } }]);
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.marcarNoShow(reserva());
    });

    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA);
  });

  it("con la escritura denegada por RLS (0 filas) también", async () => {
    mockEscrituras([{ data: [] }]);
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.moverEspacio(reserva(), "terraza", "Terraza");
    });

    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA_AL_CAMBIAR_SALA);
  });

  it("después de escribir, no antes (las consultas se refrescan con el dato ya guardado)", async () => {
    const orden: string[] = [];
    mockEscrituras();
    vi.mocked(supabase.from).mockImplementationOnce((() => {
      const b: Record<string, unknown> = {
        update: () => b,
        eq: () => b,
        select: () => b,
        then: (ok: (v: unknown) => unknown) => {
          orden.push("escritura");
          return Promise.resolve({ data: [{ id: "r1" }], error: null }).then(ok);
        },
      };
      return b;
    }) as never);
    const { result, queryClient } = montar();
    const invalidar = queryClient.invalidateQueries as unknown as ReturnType<typeof vi.fn>;
    invalidar.mockImplementation(() => {
      orden.push("refresco");
      return Promise.resolve();
    });

    await act(async () => {
      await result.current.marcarLlegada(reserva());
    });

    expect(orden[0]).toBe("escritura");
    expect(orden.slice(1).every((o) => o === "refresco")).toBe(true);
    expect(orden).toHaveLength(1 + CLAVES_QUE_REFRESCA.length);
  });

  it("mover una reserva que no se puede mover (cancelada, No vino) no escribe, no cancela y no refresca nada", async () => {
    const escrituras = mockEscrituras();
    const { result, invalidadas, canceladas } = montar();

    for (const estado of ["cancelada", "no_show"]) {
      let ok = true;
      await act(async () => {
        ok = await result.current.moverEspacio(reserva({ estado }), "terraza", "Terraza");
      });
      expect(ok, estado).toBe(false);
    }

    expect(escrituras).toHaveLength(0);
    expect(invalidadas).toEqual([]);
    expect(canceladas).toEqual([]);
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith("Esta reserva no se puede mover.");
  });

  it("mover de sala refresca TAMBIÉN las mesas asignadas (`asignaciones_mesa`, `resumen-asignacion-dia`), como useCambiarSalaReserva", async () => {
    // El trigger `trg_reservas_sincronizar_asignaciones` BORRA las mesas de la reserva al
    // cambiar su sala: sin este refresco el plano y el panel de asignación seguían
    // enseñando mesas que ya no existen hasta el siguiente refetch.
    mockEscrituras();
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.moverEspacio(reserva(), "terraza", "Terraza");
    });

    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA_AL_CAMBIAR_SALA);
  });

  it("y también lo hace el «Deshacer» del movimiento (vuelve a cambiar la sala)", async () => {
    mockEscrituras([{}, {}]);
    const { result, invalidadas } = montar(reserva({ espacio_id: "salon" }));

    await act(async () => {
      await result.current.moverEspacio(reserva({ espacio_id: "salon" }), "terraza", "Terraza");
    });
    invalidadas.length = 0;
    await act(async () => {
      accionDeshacerDelToast()!.onClick();
    });
    await waitFor(() => expect(invalidadas.length).toBeGreaterThan(0));

    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA_AL_CAMBIAR_SALA);
  });

  it.each([
    ["marcarLlegada", (r: ReturnType<typeof montar>["result"]) => r.current.marcarLlegada(reserva())],
    ["marcarNoShow", (r: ReturnType<typeof montar>["result"]) => r.current.marcarNoShow(reserva())],
    ["deshacerLlegadaONoShow", (r: ReturnType<typeof montar>["result"]) => r.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }))],
  ])("%s NO cambia la sala: no toca las mesas asignadas", async (_n, lanzar) => {
    mockEscrituras();
    const { result, invalidadas } = montar();

    await act(async () => {
      await lanzar(result);
    });

    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA);
  });

  it("BUG conocido: mover de sala sigue sin refrescar `reservas-servicio-dia` (modo servicio) ni `disponibilidad`", async () => {
    // Fuera del alcance del paso 1 (las mesas asignadas sí): lo de modo servicio y la rejilla de
    // disponibilidad se unifica con el resto de listas de claves en el paso 2.
    mockEscrituras();
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.moverEspacio(reserva(), "terraza", "Terraza");
    });

    expect(invalidadas).not.toContain("reservas-servicio-dia");
    expect(invalidadas).not.toContain("disponibilidad");
  });
});

describe("cuando la escritura falla", () => {
  it("con error de la BD: devuelve false, avisa con el mensaje de la BD y lo deja en el log", async () => {
    mockEscrituras([{ error: { code: "42501", message: "permission denied for table reservas" } }]);
    const { result } = montar();

    let ok = true;
    await act(async () => {
      ok = await result.current.moverEspacio(reserva(), "terraza", "Terraza");
    });

    expect(ok).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("No se pudo mover la reserva: permission denied for table reservas");
    expect(consolaError).toHaveBeenCalledWith("[servicio-reserva] Error al mover la reserva:", expect.anything());
  });

  it.each([
    ["marcarLlegada", "registrar la llegada", (r: ReturnType<typeof montar>["result"]) => r.current.marcarLlegada(reserva())],
    ["marcarNoShow", "marcar «No vino»", (r: ReturnType<typeof montar>["result"]) => r.current.marcarNoShow(reserva())],
    ["moverEspacio", "mover la reserva", (r: ReturnType<typeof montar>["result"]) => r.current.moverEspacio(reserva(), "terraza", "Terraza")],
  ])("%s con la escritura denegada por RLS (0 filas, sin error): false, revierte y dice que no hay permiso", async (_n, accion, lanzar) => {
    mockEscrituras([{ data: [] }]);
    const { result, fila } = montar();

    let ok = true;
    await act(async () => {
      ok = (await lanzar(result)) as boolean;
    });

    expect(ok).toBe(false);
    expect(fila(["reservas-kanban", DIA])).toEqual(reserva());
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      `No se pudo ${accion}: no tienes permiso para cambiar esta reserva, o ya no existe.`,
    );
    expect(consolaError.mock.calls[0][1]).toBeInstanceOf(ErrorSinFilasReserva);
  });

  it("`data: null` sin error cuenta igual que 0 filas", async () => {
    mockEscrituras([{ data: null }]);
    const { result } = montar();

    let ok = true;
    await act(async () => {
      ok = await result.current.marcarLlegada(reserva());
    });

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/no tienes permiso/));
  });

  it("el trigger de aforo al deshacer se traduce a «el turno ya está completo»", async () => {
    mockEscrituras([{ error: { code: "23514", message: "Aforo superado para el turno" } }]);
    const { result } = montar(reserva({ estado: "completada" }));

    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    expect(toast.error).toHaveBeenCalledWith("No se pudo deshacer la llegada: el turno ya está completo (aforo superado).");
  });

  it("deshacer un «No vino» con el mismo fallo habla de «No vino» (vocabulario único)", async () => {
    mockEscrituras([{ error: { code: "23514", message: "Aforo superado para el turno" } }]);
    const { result } = montar(reserva({ estado: "no_show" }));

    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "no_show" }));
    });

    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo quitar el «No vino»: el turno ya está completo (aforo superado).",
    );
  });

  it("un fallo de una reserva no deja «en curso» a nadie", async () => {
    mockEscrituras([{ error: { message: "boom" } }]);
    const { result } = montar();

    await act(async () => {
      await result.current.marcarLlegada(reserva());
    });

    expect(result.current.estaEnCurso("r1")).toBe(false);
  });
});

describe("avisos de éxito (vocabulario único: «Ha llegado» / «No vino»)", () => {
  it("cada acción avisa con el nombre del cliente y, salvo deshacer, con botón «Deshacer» de 10 s", async () => {
    mockEscrituras([{}, {}, {}, {}]);
    const { result } = montar();

    await act(async () => {
      await result.current.moverEspacio(reserva(), "terraza", "Terraza");
    });
    await act(async () => {
      await result.current.marcarLlegada(reserva());
    });
    await act(async () => {
      await result.current.marcarNoShow(reserva());
    });
    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    const avisos = vi.mocked(toast.success).mock.calls;
    expect(avisos.map(([texto]) => texto)).toEqual([
      "Ana → Terraza",
      "Ana ha llegado",
      "Ana: no vino",
      "Reserva devuelta a «Confirmada»",
    ]);
    for (const [, opciones] of avisos.slice(0, 3)) {
      expect(opciones).toMatchObject({ duration: 10_000, action: { label: "Deshacer" } });
    }
    expect(avisos[3][1]).toBeUndefined();
  });

  it("una reserva sin nombre sale como «Reserva» o «Cliente», según la acción", async () => {
    mockEscrituras([{}, {}, {}]);
    const { result } = montar();
    const sinNombre = reserva({ nombre: null });

    await act(async () => {
      await result.current.moverEspacio(sinNombre, "terraza", "Terraza");
    });
    await act(async () => {
      await result.current.marcarLlegada(sinNombre);
    });
    await act(async () => {
      await result.current.marcarNoShow(sinNombre);
    });

    expect(vi.mocked(toast.success).mock.calls.map(([texto]) => texto)).toEqual([
      "Reserva → Terraza",
      "Cliente ha llegado",
      "Reserva: no vino",
    ]);
  });
});

describe("el hook no valida el estado de partida (salvo al mover)", () => {
  // Quien impide «Ha llegado» en una reserva cancelada es la pantalla (ControlLlegada
  // solo lo pinta si `esperandoLlegada(estado)`), no el hook. Hoy, llamado directamente,
  // escribe igual. Es el punto a decidir al poner un único ejecutor con sus reglas.
  it.each([
    ["marcarLlegada", "cancelada", "completada"],
    ["marcarLlegada", "completada", "completada"],
    ["marcarNoShow", "cancelada", "no_show"],
    ["marcarNoShow", "completada", "no_show"],
  ] as const)("%s sobre una reserva %s: escribe igual", async (accion, estado, resultado) => {
    const escrituras = mockEscrituras();
    const { result } = montar(reserva({ estado }));

    let ok = false;
    await act(async () => {
      ok = await result.current[accion](reserva({ estado }));
    });

    expect(ok).toBe(true);
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].payload.estado).toBe(resultado);
  });
});

describe("sin la columna llegada_at (migración sin aplicar)", () => {
  it("el reintento sin la columna no duplica ni los refrescos ni los avisos", async () => {
    const escrituras = mockEscrituras([
      { error: { code: "PGRST204", message: "Could not find the 'llegada_at' column of 'reservas' in the schema cache" } },
      {},
    ]);
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.marcarLlegada(reserva());
    });

    expect(escrituras.map((e) => Object.keys(e.payload))).toEqual([["estado", "llegada_at"], ["estado"]]);
    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});

describe("`estaEnCurso`", () => {
  it("es true solo mientras dura la escritura de ESA reserva", async () => {
    let liberar!: () => void;
    mockEscrituras([{ esperar: new Promise<void>((r) => (liberar = r)) }]);
    const { result } = montar();

    expect(result.current.estaEnCurso("r1")).toBe(false);
    let promesa!: Promise<boolean>;
    act(() => {
      promesa = result.current.marcarNoShow(reserva());
    });

    await waitFor(() => expect(result.current.estaEnCurso("r1")).toBe(true));
    expect(result.current.estaEnCurso("r2")).toBe(false);

    await act(async () => {
      liberar();
      await promesa;
    });
    expect(result.current.estaEnCurso("r1")).toBe(false);
  });
});
