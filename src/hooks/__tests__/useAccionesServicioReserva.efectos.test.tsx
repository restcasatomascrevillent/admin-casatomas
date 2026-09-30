/**
 * `useAccionesServicioReserva` (las acciones de SERVICIO: mover, «Ha llegado», «No vino»
 * y deshacer) — tests de EFECTOS.
 *
 * Nacieron como caracterización del hook tal como estaba (paso 0) y fijan lo que hace:
 * qué se escribe y con qué filtros, quién manda correo, qué cachés se tocan y cuáles se
 * refrescan, qué pasa cuando la escritura falla —NO el DOM ni el número de botones—. Lo
 * que ya cubre `useAccionesServicioReserva.test.tsx` (rollback básico, reintento sin
 * `llegada_at`, «0 filas = error» en mover y llegada) no se repite. Las acciones de
 * GESTIÓN y la estrella del mismo ejecutor se prueban en `useVerificacionReservas.efectos.test.ts`.
 *
 * PASO 2 del refactor de acciones (el hook pasa a ser el único ejecutor). Lo que cambia
 * respecto al punto de partida, y por eso cambian estos tests:
 *   · `// BUG conocido` → CORREGIDO: «mover de sala no refrescaba `reservas-servicio-dia`
 *     (modo servicio) ni `disponibilidad`»: ahora todas las acciones refrescan UNA lista
 *     única por tipo de cambio (`clavesCache.ts`).
 *   · El hook NO validaba el estado de partida (salvo al mover): ahora lo decide
 *     `accionesDisponibles` —la misma función que habilita el botón— y la escritura va
 *     CONDICIONADA a ese estado en la BD (`.in("estado", …)`). Una reserva que cambió de
 *     estado entre tanto no se pisa: 0 filas, aviso claro y refresco.
 *   · El «Deshacer» del chip devolvía SIEMPRE a «Confirmada»: ahora vuelve al estado que
 *     la reserva tenía antes de llegar / no venir (`estadoPrevio.ts`); si no se sabe,
 *     «Confirmada».
 *   · Llegada, «No vino» y deshacer refrescan también las mesas asignadas (la vista de
 *     asignación solo tiene las reservas vivas): antes solo lo hacía mover.
 *   · El aviso de «0 filas» de una escritura condicionada nombra también el cambio de
 *     estado ajeno y, como la relee, dice CUÁL es el estado de verdad («ya ha cambiado de
 *     estado (ahora está «Verificada»)»).
 *   · M1 (revisión independiente): el estado previo que se recuerda para el «Deshacer» tiene que ser
 *     el de VERDAD, y la tarjeta puede estar desfasada (el kanban y la lista no tienen realtime).
 *     «Ha llegado» y «No vino» escriben condicionados al estado de la tarjeta y, si la reserva ya
 *     no está así pero SIGUE VIVA (la tarjeta decía «Verificada» y el cliente ya había confirmado
 *     desde el enlace), se REINTENTA una vez desde el estado leído —sin error— y ese es el estado
 *     previo que se recuerda. Solo se avisa de «ya ha cambiado de estado» si ya no está viva
 *     (cancelada, «Llegó», «No vino») o el reintento también falla. El chip «Deshacer» sí exige
 *     el estado EXACTO que dejó la acción.
 * El resto de lo fijado aquí (textos, columnas, que NINGUNA acción de servicio manda
 * correo) sigue igual.
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
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";
import { __vaciarEstadosPreviosParaTests } from "@/lib/reservas/estadoPrevio";
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
  /** La condición de estado de partida (`.in("estado", …)`); `null` si la escritura no la lleva. */
  en: [string, unknown[]] | null;
  select: string | null;
}
interface Respuesta {
  error?: unknown;
  data?: unknown;
  /** La escritura no se resuelve hasta que esta promesa lo haga. */
  esperar?: Promise<void>;
}
/**
 * Lo que contesta la RELECTURA del estado (`select("estado").eq("id", …).maybeSingle()`), que solo
 * se hace cuando una escritura condicionada no toca nada. Sin ella, el doble no tiene `maybeSingle`
 * y la relectura se ignora (el aviso nombra las tres causas posibles). Con una lista, cada relectura
 * consume la siguiente (la última se repite).
 */
interface Relectura {
  data?: unknown;
  error?: unknown;
}

/** Cada `await` de una escritura consume la siguiente respuesta; sin más, éxito con 1 fila. */
function mockEscrituras(respuestas: Respuesta[] = [], relectura?: Relectura | Relectura[]) {
  const escrituras: Escritura[] = [];
  const relecturas = relectura === undefined ? undefined : Array.isArray(relectura) ? [...relectura] : [relectura];
  vi.mocked(supabase.from).mockImplementation(((tabla: string) => {
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
      maybeSingle: relecturas
        ? vi.fn(() => {
            const r = relecturas.length > 1 ? relecturas.shift()! : relecturas[0];
            return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
          })
        : undefined,
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

/**
 * Lo que refresca CUALQUIER acción de servicio (estado o sala), en este orden: las listas,
 * los contadores, el modo servicio y el plano, la disponibilidad y las mesas asignadas.
 * Antes eran dos listas (11 claves; 13 al mover) y todas distintas de las de otros escritores
 * (ver `clavesCache.ts`, donde está la lista entera comentada y fijada).
 */
const CLAVES_QUE_REFRESCA = [...CLAVES_POR_CAMBIO.ocupacion];

/** Mover refresca lo mismo que cambiar el estado: ya no hay un escritor de sala con menos claves. */
const CLAVES_QUE_REFRESCA_AL_CAMBIAR_SALA = CLAVES_QUE_REFRESCA;

/** Los estados desde los que puede partir una acción: la condición que lleva la escritura (`.in("estado", …)`). */
const VIVOS = ["pendiente", "verificada", "confirmada"];
const OCUPAN_SITIO = [...VIVOS, "completada"];
// «Ha llegado», «No vino» y el chip «Deshacer» exigen el estado EXACTO que vio el personal (M1): la
// tarjeta del montaje de abajo es «Confirmada», así que esa es su condición.

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
  __vaciarEstadosPreviosParaTests();
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
      // `en`: la escritura va condicionada a que la reserva siga en un estado que ocupa sitio.
      { tabla: "reservas", payload: { espacio_id: "terraza" }, eq: ["id", "r1"], en: ["estado", OCUPAN_SITIO], select: "id" },
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

  it.each(["completada", "no_show"])(
    "«Deshacer» desde el chip de %s sin saber de dónde venía (nadie la marcó en esta sesión): vuelve a 'confirmada' y borra llegada_at",
    async (estado) => {
      const escrituras = mockEscrituras();
      const { result } = montar(reserva({ estado }));

      await act(async () => {
        await result.current.deshacerLlegadaONoShow(reserva({ estado }));
      });

      expect(escrituras[0].payload).toEqual({ estado: "confirmada", llegada_at: null });
    },
  );

  it.each(["pendiente", "verificada", "confirmada"])(
    "CORREGIDO: deshacer desde el chip de «Ha llegado» vuelve a '%s', el estado que tenía, no siempre a 'confirmada'",
    async (estadoDePartida) => {
      // Antes (comportamiento «a decidir» del paso 0): una reserva que nunca se verificó
      // acababa 'confirmada' sin pasar por la verificación ni mandar correo.
      const escrituras = mockEscrituras([{}, {}]);
      const { result } = montar(reserva({ estado: estadoDePartida }));

      await act(async () => {
        await result.current.marcarLlegada(reserva({ estado: estadoDePartida }));
      });
      await act(async () => {
        await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
      });

      expect(escrituras[1].payload).toEqual({ estado: estadoDePartida, llegada_at: null });
    },
  );

  it("lo mismo con «No vino»: el chip devuelve la reserva a donde estaba", async () => {
    const escrituras = mockEscrituras([{}, {}]);
    const { result } = montar(reserva({ estado: "verificada" }));

    await act(async () => {
      await result.current.marcarNoShow(reserva({ estado: "verificada" }));
    });
    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "no_show" }));
    });

    expect(escrituras[1].payload).toEqual({ estado: "verificada", llegada_at: null });
  });

  it("el estado previo es de la SESIÓN, no de una instancia del hook: lo marcado desde el kanban se deshace desde el modo servicio", async () => {
    const escrituras = mockEscrituras([{}, {}]);
    const a = montar(reserva({ estado: "pendiente" }));
    await act(async () => {
      await a.result.current.marcarLlegada(reserva({ estado: "pendiente" }));
    });

    const b = montar(reserva({ estado: "completada" }));
    await act(async () => {
      await b.result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    expect(escrituras[1].payload.estado).toBe("pendiente");
  });

  it("solo sirve UNA vez: tras deshacer se olvida, y un segundo deshacer (lo marcó otro) vuelve a 'confirmada'", async () => {
    const escrituras = mockEscrituras([{}, {}, {}]);
    const { result } = montar(reserva({ estado: "pendiente" }));

    await act(async () => {
      await result.current.marcarLlegada(reserva({ estado: "pendiente" }));
    });
    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });
    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    expect(escrituras.map((e) => e.payload.estado)).toEqual(["completada", "pendiente", "confirmada"]);
  });

  it("si la llegada NO se guardó (RLS), no se recuerda nada: el chip no inventa un estado previo", async () => {
    const escrituras = mockEscrituras([{ data: [] }, {}]);
    const { result } = montar(reserva({ estado: "pendiente" }));

    await act(async () => {
      await result.current.marcarLlegada(reserva({ estado: "pendiente" }));
    });
    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    expect(escrituras[1].payload.estado).toBe("confirmada");
  });

  it("el aviso del chip dice a qué estado ha vuelto", async () => {
    mockEscrituras([{}, {}]);
    const { result } = montar(reserva({ estado: "pendiente" }));

    await act(async () => {
      await result.current.marcarLlegada(reserva({ estado: "pendiente" }));
    });
    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    expect(vi.mocked(toast.success).mock.calls.at(-1)).toEqual(["Reserva devuelta a «Pendiente»"]);
  });
});

describe("la escritura va condicionada al estado de partida (`.in('estado', …)`)", () => {
  // Es la versión en BD de `accionesDisponibles`: si entre tanto otra persona (o el cliente
  // desde su correo) cambió el estado, el UPDATE no toca nada y no se pisa.
  const casos: Array<[string, (r: ReturnType<typeof montar>["result"]) => Promise<unknown>, Partial<ReservaServicio>, string[]]> = [
    ["marcarLlegada", (r) => r.current.marcarLlegada(reserva()), {}, ["confirmada"]],
    ["marcarNoShow", (r) => r.current.marcarNoShow(reserva()), {}, ["confirmada"]],
    ["moverEspacio", (r) => r.current.moverEspacio(reserva(), "terraza", "Terraza"), {}, OCUPAN_SITIO],
    ["deshacerLlegadaONoShow (desde Llegó)", (r) => r.current.deshacerLlegadaONoShow(reserva({ estado: "completada" })), { estado: "completada" }, ["completada"]],
    ["deshacerLlegadaONoShow (desde No vino)", (r) => r.current.deshacerLlegadaONoShow(reserva({ estado: "no_show" })), { estado: "no_show" }, ["no_show"]],
  ];

  it.each(casos)("%s escribe solo si la BD sigue en el estado que vio el personal (mover: en uno que ocupe sitio)", async (_nombre, lanzar, enCache, estados) => {
    const escrituras = mockEscrituras();
    const { result } = montar(reserva(enCache));

    await act(async () => {
      await lanzar(result);
    });

    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].en).toEqual(["estado", estados]);
  });

  it("si la reserva ya cambió de estado (0 filas) no se pisa: revierte, avisa y refresca para enseñar el estado de verdad", async () => {
    // El «Ha llegado» se pulsa sobre una tarjeta «Confirmada» que lleva un rato sin
    // refrescar; mientras tanto el cliente la canceló desde su correo. El UPDATE
    // condicionado al estado que vio el personal no toca nada.
    mockEscrituras([{ data: [] }]);
    const { result, fila, invalidadas } = montar();

    let ok = true;
    await act(async () => {
      ok = await result.current.marcarLlegada(reserva());
    });

    expect(ok).toBe(false);
    expect(fila(["reservas-kanban", DIA]).estado).toBe("confirmada"); // el parche en local se deshace…
    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA); // …y se vuelve a pedir lo de verdad
    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo registrar la llegada: no tienes permiso para cambiar esta reserva, o ya no existe, o ya ha cambiado de estado.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("el «Deshacer» del aviso también va condicionado: no pisa lo que pasó después", async () => {
    const escrituras = mockEscrituras([{}, {}, {}, {}, {}, {}]);
    const { result } = montar();

    // Llegada → Deshacer: solo si sigue «Llegó».
    await act(async () => {
      await result.current.marcarLlegada(reserva());
    });
    await act(async () => {
      accionDeshacerDelToast()!.onClick();
    });
    await waitFor(() => expect(escrituras).toHaveLength(2));
    await waitFor(() => expect(result.current.estaEnCurso("r1")).toBe(false));
    // «No vino» → Deshacer: solo si sigue «No vino».
    await act(async () => {
      await result.current.marcarNoShow(reserva());
    });
    await act(async () => {
      accionDeshacerDelToast()!.onClick();
    });
    await waitFor(() => expect(escrituras).toHaveLength(4));
    await waitFor(() => expect(result.current.estaEnCurso("r1")).toBe(false));
    // Mover → Deshacer: solo si aún ocupa sitio.
    await act(async () => {
      await result.current.moverEspacio(reserva(), "terraza", "Terraza");
    });
    await act(async () => {
      accionDeshacerDelToast()!.onClick();
    });
    await waitFor(() => expect(escrituras).toHaveLength(6));

    expect(escrituras.map((e) => e.en)).toEqual([
      ["estado", ["confirmada"]], // llegada: el estado que vio el personal
      ["estado", ["completada"]], // su Deshacer
      ["estado", ["confirmada"]], // no vino: el estado que vio el personal
      ["estado", ["no_show"]], // su Deshacer
      ["estado", OCUPAN_SITIO], // mover
      ["estado", OCUPAN_SITIO], // su Deshacer
    ]);
  });
});

describe("M1: la tarjeta puede estar desfasada — «Ha llegado» y «No vino» parten del estado de VERDAD; el chip exige el que dejó la acción", () => {
  // QUÉ PASÓ EN LA REVISIÓN. El estado previo que se recuerda para el «Deshacer» salía de la tarjeta, que puede
  // ir desfasada (kanban y lista no tienen realtime): la tablet enseñaba a X «Pendiente», en la oficina la
  // verificaron, «Ha llegado» funcionaba y el chip dejaba a X «Pendiente» (la lista volvía a ofrecer «Aceptar»,
  // que reescribe hora y sala). Exigir que la BD estuviera EXACTAMENTE como la tarjeta lo arreglaba, pero daba un
  // FALSO ERROR en un caso normal en plena hora de servicio: la tarjeta decía «Verificada» y el cliente ya había
  // confirmado desde el enlace (la BD: «Confirmada»); el primer toque salía en rojo y el segundo funcionaba.
  //
  // LO QUE SE HACE: la escritura va condicionada al estado de la tarjeta y, si no toca nada, se relee el estado;
  // si la reserva SIGUE VIVA (pendiente, verificada, confirmada) se REINTENTA una vez condicionada a ESE estado y ese
  // es el que se recuerda para el «Deshacer». Solo si ya no está viva (cancelada, «Llegó», «No vino») o el
  // reintento también falla se dice que ha cambiado de estado.

  it("tarjeta «Verificada» y la BD ya «Confirmada» (el cliente confirmó desde el enlace): «Ha llegado» funciona AL PRIMER TOQUE, sin error rojo", async () => {
    const escrituras = mockEscrituras([{ data: [] }, {}], { data: { estado: "confirmada" } });
    const { result, fila } = montar(reserva({ estado: "verificada" }));

    let ok = false;
    await act(async () => {
      ok = await result.current.marcarLlegada(reserva({ estado: "verificada" }));
    });

    expect(ok).toBe(true);
    // Primero con el estado de la tarjeta; al no tocar nada, UN reintento con el estado de verdad.
    expect(escrituras.map((e) => e.en)).toEqual([["estado", ["verificada"]], ["estado", ["confirmada"]]]);
    expect(escrituras.map((e) => e.payload.estado)).toEqual(["completada", "completada"]);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Ana ha llegado", expect.anything());
    // Sin ruido en el log: el primer intento no es un error, y la tarjeta se queda en «Llegó».
    expect(consolaError).not.toHaveBeenCalled();
    expect(fila(["reservas-kanban", DIA]).estado).toBe("completada");
  });

  it("…y el «Deshacer» del aviso devuelve a «Confirmada» (el estado de verdad), no a «Verificada» (el de la tarjeta)", async () => {
    const escrituras = mockEscrituras([{ data: [] }, {}, {}], { data: { estado: "confirmada" } });
    const { result } = montar(reserva({ estado: "verificada" }));

    await act(async () => {
      await result.current.marcarLlegada(reserva({ estado: "verificada" }));
    });
    await act(async () => {
      accionDeshacerDelToast()!.onClick();
    });
    await waitFor(() => expect(escrituras).toHaveLength(3));

    expect(escrituras[2].payload).toEqual({ estado: "confirmada", llegada_at: null });
    expect(escrituras[2].en).toEqual(["estado", ["completada"]]);
  });

  it("…y el chip «Deshacer» también vuelve a «Confirmada» (lo que se recuerda es el estado leído)", async () => {
    const escrituras = mockEscrituras([{ data: [] }, {}, {}], { data: { estado: "confirmada" } });
    const { result } = montar(reserva({ estado: "verificada" }));

    await act(async () => {
      await result.current.marcarLlegada(reserva({ estado: "verificada" }));
    });
    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    expect(escrituras[2].payload).toEqual({ estado: "confirmada", llegada_at: null });
    expect(escrituras[2].en).toEqual(["estado", ["completada"]]);
  });

  it("«No vino» igual: tarjeta «Verificada», BD «Confirmada» → funciona al primer toque y el «Deshacer» vuelve a «Confirmada»", async () => {
    const escrituras = mockEscrituras([{ data: [] }, {}, {}, {}], { data: { estado: "confirmada" } });
    const { result } = montar(reserva({ estado: "verificada" }));

    let ok = false;
    await act(async () => {
      ok = await result.current.marcarNoShow(reserva({ estado: "verificada" }));
    });
    expect(ok).toBe(true);
    expect(escrituras.map((e) => e.en)).toEqual([["estado", ["verificada"]], ["estado", ["confirmada"]]]);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Ana: no vino", expect.anything());

    // El «Deshacer» del aviso restaura el estado de verdad.
    await act(async () => {
      accionDeshacerDelToast()!.onClick();
    });
    await waitFor(() => expect(escrituras).toHaveLength(3));
    expect(escrituras[2].payload).toEqual({ estado: "confirmada" });
    await waitFor(() => expect(result.current.estaEnCurso("r1")).toBe(false));

    // Y el chip, si se marca de nuevo y se deshace desde él.
    await act(async () => {
      await result.current.marcarNoShow(reserva({ estado: "confirmada" }));
    });
    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "no_show" }));
    });
    expect(escrituras[4].payload).toEqual({ estado: "confirmada", llegada_at: null });
  });

  it("el escenario original de la revisión: tarjeta «Pendiente», BD ya «Verificada» → «Ha llegado» funciona y el chip vuelve a «Verificada», NUNCA a «Pendiente»", async () => {
    const escrituras = mockEscrituras([{ data: [] }, {}, {}], { data: { estado: "verificada" } });
    const { result } = montar(reserva({ estado: "pendiente" }));

    await act(async () => {
      expect(await result.current.marcarLlegada(reserva({ estado: "pendiente" }))).toBe(true);
    });
    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    expect(escrituras.map((e) => e.en)).toEqual([
      ["estado", ["pendiente"]],
      ["estado", ["verificada"]],
      ["estado", ["completada"]],
    ]);
    expect(escrituras[2].payload).toEqual({ estado: "verificada", llegada_at: null });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    ["cancelada", "«Cancelada»"],
    ["completada", "«Llegó»"],
    ["no_show", "«No vino»"],
  ])("«Ha llegado» sobre una tarjeta «Confirmada» cuya reserva ya está %s (no viva): NO escribe, error claro y se refresca", async (estadoReal, nombre) => {
    const escrituras = mockEscrituras([{ data: [] }], { data: { estado: estadoReal } });
    const { result, fila, invalidadas } = montar(reserva({ estado: "confirmada" }));

    let ok = true;
    await act(async () => {
      ok = await result.current.marcarLlegada(reserva({ estado: "confirmada" }));
    });

    expect(ok).toBe(false);
    // Sin reintento: no hay un estado vivo desde el que escribir.
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].en).toEqual(["estado", ["confirmada"]]);
    expect(toast.error).toHaveBeenCalledWith(
      `No se pudo registrar la llegada: la reserva ya ha cambiado de estado (ahora está ${nombre}). Se ha refrescado la pantalla.`,
    );
    expect(toast.success).not.toHaveBeenCalled();
    // El parche en local se deshace y se vuelve a pedir lo de verdad.
    expect(fila(["reservas-kanban", DIA]).estado).toBe("confirmada");
    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA);
  });

  it.each([
    ["cancelada", "«Cancelada»"],
    ["completada", "«Llegó»"],
  ])("«No vino» igual: si la reserva ya está %s no escribe y lo dice", async (estadoReal, nombre) => {
    const escrituras = mockEscrituras([{ data: [] }], { data: { estado: estadoReal } });
    const { result } = montar(reserva({ estado: "confirmada" }));

    let ok = true;
    await act(async () => {
      ok = await result.current.marcarNoShow(reserva({ estado: "confirmada" }));
    });

    expect(ok).toBe(false);
    expect(escrituras).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith(
      `No se pudo marcar «No vino»: la reserva ya ha cambiado de estado (ahora está ${nombre}). Se ha refrescado la pantalla.`,
    );
  });

  it("si el REINTENTO también falla (cambió otra vez) se dice el estado más reciente, y solo se reintenta UNA vez", async () => {
    // Tarjeta «Pendiente»; la BD estaba «Verificada» (reintento desde ahí) y, antes de que escriba, la cancelan.
    const escrituras = mockEscrituras([{ data: [] }, { data: [] }], [
      { data: { estado: "verificada" } },
      { data: { estado: "cancelada" } },
    ]);
    const { result, fila, invalidadas } = montar(reserva({ estado: "pendiente" }));

    let ok = true;
    await act(async () => {
      ok = await result.current.marcarLlegada(reserva({ estado: "pendiente" }));
    });

    expect(ok).toBe(false);
    expect(escrituras.map((e) => e.en)).toEqual([["estado", ["pendiente"]], ["estado", ["verificada"]]]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo registrar la llegada: la reserva ya ha cambiado de estado (ahora está «Cancelada»). Se ha refrescado la pantalla.",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(fila(["reservas-kanban", DIA]).estado).toBe("pendiente"); // parche deshecho
    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA);
  });

  it("el chip «Deshacer» NO reintenta: exige el estado EXACTO que dejó la acción, aunque la BD esté en un estado vivo", async () => {
    // El chip de «Llegó» sobre una tarjeta desfasada: en la BD otra persona ya la devolvió a «Confirmada».
    const escrituras = mockEscrituras([{ data: [] }], { data: { estado: "confirmada" } });
    const { result } = montar(reserva({ estado: "completada" }));

    let ok = true;
    await act(async () => {
      ok = await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    expect(ok).toBe(false);
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].en).toEqual(["estado", ["completada"]]);
    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo deshacer la llegada: la reserva ya ha cambiado de estado (ahora está «Confirmada»). Se ha refrescado la pantalla.",
    );
  });

  it("el chip «Deshacer» de «Llegó» tampoco pisa: si en la BD ya es «No vino», no escribe y lo dice", async () => {
    const escrituras = mockEscrituras([{ data: [] }], { data: { estado: "no_show" } });
    const { result } = montar(reserva({ estado: "completada" }));

    let ok = true;
    await act(async () => {
      ok = await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    expect(ok).toBe(false);
    expect(escrituras[0].en).toEqual(["estado", ["completada"]]);
    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo deshacer la llegada: la reserva ya ha cambiado de estado (ahora está «No vino»). Se ha refrescado la pantalla.",
    );
  });

  it("con la tarjeta al día escribe a la primera, con esa condición exacta: lo que se recuerda para el «Deshacer» es verdad", async () => {
    const escrituras = mockEscrituras([{}, {}]);
    const { result } = montar(reserva({ estado: "verificada" }));

    await act(async () => {
      await result.current.marcarLlegada(reserva({ estado: "verificada" }));
    });
    await act(async () => {
      await result.current.deshacerLlegadaONoShow(reserva({ estado: "completada" }));
    });

    expect(escrituras.map((e) => e.en)).toEqual([["estado", ["verificada"]], ["estado", ["completada"]]]);
    expect(escrituras[1].payload).toEqual({ estado: "verificada", llegada_at: null });
  });

  it("si la relectura del estado no es posible, no hay reintento (no se sabe desde dónde) y el aviso nombra las tres causas", async () => {
    const escrituras = mockEscrituras([{ data: [] }]); // sin `maybeSingle`: la relectura se ignora
    const { result } = montar(reserva({ estado: "pendiente" }));

    await act(async () => {
      await result.current.marcarLlegada(reserva({ estado: "pendiente" }));
    });

    expect(escrituras).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo registrar la llegada: no tienes permiso para cambiar esta reserva, o ya no existe, o ya ha cambiado de estado.",
    );
  });

  it("la RLS (la reserva sigue como la vio el personal y aun así no se escribe): dice «no tienes permiso», sin reintento ni inventar un cambio", async () => {
    const escrituras = mockEscrituras([{ data: [] }], { data: { estado: "confirmada" } });
    const { result } = montar(reserva({ estado: "confirmada" }));

    await act(async () => {
      await result.current.marcarLlegada(reserva({ estado: "confirmada" }));
    });

    expect(escrituras).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith("No se pudo registrar la llegada: no tienes permiso para cambiar esta reserva.");
  });

  it("un error de la BD en el primer intento no se reintenta (solo se reintenta el «ya ha cambiado de estado» con la reserva viva)", async () => {
    const escrituras = mockEscrituras([{ error: { code: "42501", message: "denegado" } }], { data: { estado: "confirmada" } });
    const { result } = montar(reserva({ estado: "verificada" }));

    await act(async () => {
      await result.current.marcarLlegada(reserva({ estado: "verificada" }));
    });

    expect(escrituras).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith("No se pudo registrar la llegada: denegado");
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
  it("con éxito: la lista única de claves (listas, contadores, modo servicio, disponibilidad, mesas), una vez cada una, en este orden", async () => {
    mockEscrituras();
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.marcarLlegada(reserva());
    });

    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA);
    expect(new Set(invalidadas).size).toBe(invalidadas.length);
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
        in: () => b,
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
  ])("CAMBIADO: %s también refresca las mesas asignadas y el panel de asignación (antes solo lo hacía mover)", async (_n, lanzar) => {
    // `vista_asignacion_dia` solo tiene las reservas VIVAS: una que llega o no viene sale de
    // ahí, y el panel «Asignación» la seguía enseñando hasta el siguiente refetch.
    mockEscrituras();
    const { result, invalidadas } = montar();

    await act(async () => {
      await lanzar(result);
    });

    expect(invalidadas).toEqual(CLAVES_QUE_REFRESCA);
    expect(invalidadas).toEqual(expect.arrayContaining(["resumen-asignacion-dia", "asignaciones_mesa"]));
  });

  it("CORREGIDO (antes BUG conocido): mover de sala refresca `reservas-servicio-dia` (modo servicio) y todas las consultas de `disponibilidad`", async () => {
    // Antes solo se refrescaban las once de kanban y contadores (y, desde el paso 1, las mesas
    // asignadas): el modo servicio y la rejilla de horas seguían enseñando la sala vieja.
    mockEscrituras();
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.moverEspacio(reserva(), "terraza", "Terraza");
    });

    expect(invalidadas).toContain("reservas-servicio-dia");
    expect(invalidadas).toContain("reservas_sala_dia");
    // Son CUATRO consultas con nombre distinto: `disponibilidad` no cubre las otras tres.
    for (const clave of ["disponibilidad", "disponibilidad-detallada", "disponibilidad-rango", "disponibilidad-calculada"]) {
      expect(invalidadas, clave).toContain(clave);
    }
  });

  it("llegada y «No vino» (que liberan aforo o sitio) también refrescan la disponibilidad y el modo servicio", async () => {
    mockEscrituras([{}, {}]);
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.marcarLlegada(reserva());
    });
    expect(invalidadas).toEqual(expect.arrayContaining(["disponibilidad", "reservas-servicio-dia"]));
    invalidadas.length = 0;
    await act(async () => {
      await result.current.marcarNoShow(reserva());
    });
    expect(invalidadas).toEqual(expect.arrayContaining(["disponibilidad", "reservas-servicio-dia"]));
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
    // La escritura va condicionada al estado de partida: con 0 filas la causa puede ser la RLS,
    // que la reserva ya no exista o que alguien la cambiara antes, y el aviso dice las tres.
    expect(toast.error).toHaveBeenCalledWith(
      `No se pudo ${accion}: no tienes permiso para cambiar esta reserva, o ya no existe, o ya ha cambiado de estado.`,
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

describe("CORREGIDO (antes «el hook no valida el estado de partida»): el ejecutor aplica la regla que habilita el botón", () => {
  // Antes quien impedía «Ha llegado» en una reserva cancelada era solo la pantalla
  // (ControlLlegada no lo pinta): llamado directamente, el hook escribía igual. Ahora la
  // guarda es `accionesDisponibles` —la misma función—, así que una acción lanzada de otra
  // manera no se salta la regla: sin escritura, sin refresco y con el motivo.
  it.each([
    ["marcarLlegada", "cancelada", "No se puede registrar la llegada: la reserva está «Cancelada»."],
    ["marcarLlegada", "completada", "No se puede registrar la llegada: la reserva está «Llegó»."],
    ["marcarLlegada", "no_show", "No se puede registrar la llegada: la reserva está «No vino»."],
    ["marcarNoShow", "cancelada", "No se puede marcar «No vino»: la reserva está «Cancelada»."],
    ["marcarNoShow", "completada", "No se puede marcar «No vino»: la reserva está «Llegó»."],
    ["marcarNoShow", "no_show", "No se puede marcar «No vino»: la reserva está «No vino»."],
  ] as const)("%s sobre una reserva %s: no escribe, no refresca y dice por qué", async (accion, estado, motivo) => {
    const escrituras = mockEscrituras();
    const { result, invalidadas, canceladas } = montar(reserva({ estado }));

    let ok = true;
    await act(async () => {
      ok = await result.current[accion](reserva({ estado }));
    });

    expect(ok).toBe(false);
    expect(escrituras).toHaveLength(0);
    expect(invalidadas).toEqual([]);
    expect(canceladas).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(motivo);
    expect(toast.success).not.toHaveBeenCalled();
    expect(result.current.estaEnCurso("r1")).toBe(false);
  });

  it.each(["pendiente", "verificada", "confirmada", "cancelada"])(
    "deshacer una reserva %s (no es «Llegó» ni «No vino»): no hay nada que deshacer",
    async (estado) => {
      const escrituras = mockEscrituras();
      const { result } = montar(reserva({ estado }));

      let ok = true;
      await act(async () => {
        ok = await result.current.deshacerLlegadaONoShow(reserva({ estado }));
      });

      expect(ok).toBe(false);
      expect(escrituras).toHaveLength(0);
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^No hay nada que deshacer/));
    },
  );

  it.each(["pendiente", "verificada", "confirmada"])("%s sí admite «Ha llegado» y «No vino»", async (estado) => {
    const escrituras = mockEscrituras([{}, {}]);
    const { result } = montar(reserva({ estado }));

    await act(async () => {
      expect(await result.current.marcarLlegada(reserva({ estado }))).toBe(true);
    });
    await act(async () => {
      expect(await result.current.marcarNoShow(reserva({ estado }))).toBe(true);
    });

    expect(escrituras.map((e) => e.payload.estado)).toEqual(["completada", "no_show"]);
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
    // El reintento conserva la condición de estado de partida.
    expect(escrituras.map((e) => e.en)).toEqual([["estado", ["confirmada"]], ["estado", ["confirmada"]]]);
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
