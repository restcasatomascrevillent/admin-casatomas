/**
 * Las acciones de GESTIÓN de una reserva (aceptar de un clic, verificar con hora y sala,
 * rechazar, aceptar en bloque, confirmar, cancelar) y la estrella («importante») — tests
 * de EFECTOS del único ejecutor, `useAccionesServicioReserva`. Más `notificarCambioReserva`.
 *
 * Este fichero nació (paso 0) como caracterización de las funciones de
 * `useVerificacionReservas` —`aceptarComoSolicitado`, `verificarConHoraYSala`,
 * `rechazarReserva`, `aceptarVariasComoSolicitado`— y del `updateReservationStatus` y el
 * `toggleImportante` de la lista y del kanban, que cada uno escribía a su manera. En el
 * paso 2 todo eso pasa por el ejecutor y los `// BUG conocido` de entonces pasan a
 * CORREGIDO:
 *   · una escritura denegada por RLS (0 filas, sin error) se daba por buena: «Reserva
 *     verificada», correo al cliente… sin que nada se hubiera guardado. Ahora el ejecutor
 *     pide la fila de vuelta (`.select("id")`) y lo trata como error, sin correo;
 *   · ninguna acción miraba el estado de partida: se podía «verificar» una reserva que ya
 *     llegó o «rechazar» (cancelar) una «Llegó» / «No vino». Ahora lo decide
 *     `accionesDisponibles` y la escritura va condicionada al estado (`.in("estado", …)`);
 *   · `notificarCambioReserva` solo veía las excepciones: un correo que no salía (la
 *     función responde con `{ error }`, no lanza) no lo sabía nadie. Ahora la respuesta
 *     se comprueba y, si falla, sale un aviso honesto sin deshacer lo guardado.
 *
 * REVISIÓN INDEPENDIENTE DEL PASO 2 (lo que añade):
 *   · B1: «Rechazar» (el modal de una solicitud) parte SOLO de una pendiente, como «Verificar». Si A
 *     tiene el modal abierto y B acepta la solicitud (al cliente le sale la «propuesta»), rechazarla
 *     después mandaría «rechazada»: dos correos contradictorios. Ahora esa escritura no toca nada.
 *   · B3: en «aceptar en bloque», las solicitudes que ya no estaban pendientes se cuentan APARTE
 *     («N ya habían cambiado de estado»), no como «No se pudieron guardar. Inténtalo otra vez.»
 *     (reintentar fallaría igual).
 *   · B4: si el correo falló pero `emails-reserva` lo reintenta solo (`fallido_reintentable`), el aviso
 *     no manda llamar al cliente: dice que se reintentará.
 *
 * CONTRATO DEL SERVIDOR: `notify-reservation-change/index.ts` solo lee `reserva_id ?? id`, y
 * `emails-reserva` RELEE el estado de la reserva en la BD para elegir la plantilla. Por eso basta el
 * cuerpo `{ id, ...cambios }` y por eso se avisa siempre DESPUÉS de guardar.
 *
 * LAS TRES FORMAS DE LLAMAR A `notify-reservation-change` eran (el servidor solo lee
 * `reserva_id ?? id`: el resto del cuerpo se ignora):
 *   1. `notificarCambioReserva`:                 `{ id, ...cambios }`
 *   2. `updateReservationStatus` de la lista:    `{ ...reservaEntera, estado }`
 *   3. `useSolicitudesPendientes`:               `{ reserva_id }`
 * Ahora hay UNA (`notificarCliente.ts`): `{ id, ...cambios }`. Confirmar y cancelar dejan de
 * mandar la fila entera: pasan a `{ id, estado }`, que es lo único que el servidor lee.
 *
 * LO QUE NO CAMBIA: los textos de los avisos y de los errores, y QUIÉN avisa al cliente
 * (aceptar, verificar, confirmar, cancelar y rechazar; nadie más). Qué se escribe tampoco,
 * salvo en «Aceptar» (párrafo siguiente).
 *
 * CAMBIO ACORDADO CON EL DUEÑO (2026-10-01): «Aceptar» —de un clic y en bloque— acepta la
 * reserva TAL COMO ESTÁ AHORA (lo que ve el personal). Antes escribía `hora = hora_solicitada` y
 * `espacio_id = espacio_solicitado_id`; en Casa Tomás esa sala es null, así que dejaba
 * `espacio_id` en null y el trigger de la BD BORRABA la sala y las mesas que el personal ya
 * hubiera asignado, y revertía en silencio la hora que hubiera editado antes de aceptar. Ahora el
 * UPDATE lleva SOLO el estado (y `espacio_id` únicamente para rellenar una sala que falta y se
 * pidió: Touza). El correo no cambia: lo dispara el estado y el servidor relee la BD.
 *
 * Nada llega a Supabase: el cliente y `sonner` están mockeados.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import * as clienteMock from "@/integrations/supabase/client";
const { resetSupabaseMocks } = clienteMock as unknown as { resetSupabaseMocks: () => void };
import { toast } from "sonner";
import { useAccionesServicioReserva, __resetColumnaLlegadaParaTests } from "@/hooks/useAccionesServicioReserva";
import { notificarCambioReserva, type ReservaParaVerificar } from "@/hooks/useVerificacionReservas";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";
import { __vaciarEstadosPreviosParaTests } from "@/lib/reservas/estadoPrevio";

const reserva = (extra: Partial<ReservaParaVerificar> = {}): ReservaParaVerificar => ({
  id: "res-1",
  nombre: "Miguel Benito",
  telefono: "+34600111222",
  email: "miguel@ejemplo.com",
  fecha: "2026-10-02",
  hora: "14:00:00",
  numero_comensales: 4,
  estado: "pendiente",
  notas_cliente: null,
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
  /** Columnas pedidas de vuelta con `.select(...)`; `null` si nunca se pidió. */
  select: string | null;
}
interface Respuesta {
  error?: unknown;
  data?: unknown;
  /** La escritura no se resuelve hasta que esta promesa lo haga. */
  esperar?: Promise<void>;
}
/**
 * Lo que contesta la RELECTURA del estado (`select("estado").eq("id", …).maybeSingle()`), que solo se
 * hace cuando una escritura condicionada no toca nada. Sin ella, el doble no tiene `maybeSingle` y la
 * relectura se ignora (el aviso nombra las tres causas posibles).
 */
interface Relectura {
  data?: unknown;
  error?: unknown;
}

/** Cada `await` de una escritura consume la siguiente respuesta. Sin más, éxito con la fila de ESA reserva. */
function mockEscrituras(respuestas: Respuesta[] = [], relectura?: Relectura) {
  const escrituras: Escritura[] = [];
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
      maybeSingle: relectura
        ? vi.fn(() => Promise.resolve({ data: relectura.data ?? null, error: relectura.error ?? null }))
        : undefined,
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const r = respuestas.shift() ?? {};
        const resolver = async () => {
          if (r.esperar) await r.esperar;
          const data = "data" in r ? r.data : r.error ? null : [{ id: escritura.eq?.[1] }];
          return { data, error: r.error ?? null };
        };
        return resolver().then(ok, ko);
      },
    };
    return builder;
  }) as never);
  return escrituras;
}

/** Lo que se le ha pedido a `notify-reservation-change`, en orden. */
const notificaciones = () =>
  vi
    .mocked(supabase.functions.invoke)
    .mock.calls.map(([funcion, opciones]) => ({ funcion, body: (opciones as { body: unknown }).body }));

/** La función contesta con un error (la forma habitual de supabase-js ante un 4xx/5xx: NO lanza). */
const RESPUESTA_CON_ERROR = { data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code" } };
/** `emails-reserva` dice que no ha enviado nada por ese motivo. */
const sinEnviar = (motivo: string) => ({
  data: { success: true, status: 200, resultado: JSON.stringify({ ok: false, motivo }) },
  error: null,
});

const FALLO_DE_BD = { code: "42501", message: "permission denied for table reservas" };

// ─── Montaje ─────────────────────────────────────────────────────────────────

function montar(enCache: ReservaParaVerificar[] = [reserva()]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClient.setQueryData(["reservas-lista"], enCache);
  const invalidadas: string[] = [];
  const invalidar = queryClient.invalidateQueries.bind(queryClient);
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filtros, opciones) => {
    invalidadas.push(String((filtros as { queryKey: unknown[] }).queryKey[0]));
    return invalidar(filtros, opciones);
  });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
  const { result } = renderHook(() => useAccionesServicioReserva(), { wrapper });
  const fila = (id = "res-1") => queryClient.getQueryData<ReservaParaVerificar[]>(["reservas-lista"])!.find((r) => r.id === id)!;
  return { result, queryClient, invalidadas, fila };
}

type Montaje = ReturnType<typeof montar>;
type Resultado = Awaited<ReturnType<Montaje["result"]["current"]["aceptar"]>>;

let consolaError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetSupabaseMocks();
  vi.mocked(supabase.functions.invoke).mockReset().mockResolvedValue({ data: null, error: null } as never);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
  __resetColumnaLlegadaParaTests();
  __vaciarEstadosPreviosParaTests();
  consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consolaError.mockRestore();
});

/** Lanza una acción y, si avisa al cliente, espera a que conteste el servidor. */
async function lanzar(accion: () => Promise<Resultado>): Promise<Resultado> {
  let resultado!: Resultado;
  await act(async () => {
    resultado = await accion();
  });
  await resultado.correo;
  return resultado;
}

// ============================================================================
describe("aceptar (el «Aceptar» de un clic de la lista)", () => {
  it("escribe SOLO el estado 'verificada' en `reservas`, filtrando por id, pidiendo la fila de vuelta y SOLO si sigue pendiente", async () => {
    // cambio acordado con el dueño: antes escribía además `hora` y `espacio_id` (los pedidos).
    const escrituras = mockEscrituras();
    const { result } = montar();

    const resultado = await lanzar(() => result.current.aceptar(reserva()));

    expect(resultado.ok).toBe(true);
    expect(resultado.cambios).toEqual({ estado: "verificada" });
    expect(escrituras).toEqual([
      {
        tabla: "reservas",
        payload: { estado: "verificada" },
        eq: ["id", "res-1"],
        en: ["estado", ["pendiente"]],
        select: "id",
      },
    ]);
  });

  describe("«Aceptar» acepta la reserva TAL COMO ESTÁ AHORA (cambio acordado con el dueño, 2026-10-01)", () => {
    // Antes escribía `hora = hora_solicitada` y `espacio_id = espacio_solicitado_id`. En Casa Tomás el cliente ya no
    // elige sala (`espacio_solicitado_id` null): el UPDATE dejaba `espacio_id` en null y
    // `trg_reservas_sincronizar_asignaciones` BORRABA la sala y las mesas que el personal ya hubiera asignado; y
    // revertía en silencio la hora que el personal hubiera editado antes de aceptar.

    it("con la sala (y las mesas) que ya asignó el personal: el UPDATE no lleva `espacio_id`, así que el trigger no borra ni sala ni mesas", async () => {
      const escrituras = mockEscrituras();
      const { result } = montar();

      await lanzar(() =>
        result.current.aceptar(reserva({ hora_solicitada: "14:00:00", espacio_id: "salon", espacio_solicitado_id: null })),
      );

      expect(escrituras[0].payload).toEqual({ estado: "verificada" });
      expect(escrituras[0].payload).not.toHaveProperty("espacio_id");
      // El `WHEN` del trigger salta con estado → cancelada o con espacio_id/fecha/hora DISTINTOS: aquí solo cambia el estado.
      expect(Object.keys(escrituras[0].payload)).toEqual(["estado"]);
    });

    it("con la hora EDITADA por el personal antes de aceptar: no se revierte (el UPDATE no lleva `hora`) y la fila conserva la editada", async () => {
      const editada = reserva({ hora: "14:30:00", hora_solicitada: "14:00:00" });
      const escrituras = mockEscrituras();
      const { result, fila } = montar([editada]);

      await lanzar(() => result.current.aceptar(editada));

      expect(escrituras[0].payload).toEqual({ estado: "verificada" });
      expect(escrituras[0].payload).not.toHaveProperty("hora");
      // El parche en local solo cambia el estado: la hora de la lista sigue siendo la editada.
      expect(fila().hora).toBe("14:30:00");
      expect(fila().estado).toBe("verificada");
    });

    it("hora editada Y sala asignada a la vez: lo único que se escribe es el estado, y la fila conserva las dos", async () => {
      const editada = reserva({ hora: "21:15:00", hora_solicitada: "14:00:00", espacio_id: "salon", espacio_solicitado_id: null });
      const escrituras = mockEscrituras();
      const { result, fila } = montar([editada]);

      await lanzar(() => result.current.aceptar(editada));

      expect(escrituras[0].payload).toEqual({ estado: "verificada" });
      expect(fila()).toMatchObject({ hora: "21:15:00", espacio_id: "salon", estado: "verificada" });
    });

    it("Touza (El Reservado) con su espacio ya fijado: lo guardado queda igual que antes, solo el estado", async () => {
      const escrituras = mockEscrituras();
      const { result } = montar();

      await lanzar(() =>
        result.current.aceptar(reserva({ espacio_id: "reservado", espacio_solicitado_id: "reservado", hora_solicitada: "14:00:00" })),
      );

      expect(escrituras[0].payload).toEqual({ estado: "verificada" });
    });

    it("sin sala ahora y con una pedida (Touza): la RELLENA con la pedida, en el mismo UPDATE", async () => {
      const escrituras = mockEscrituras();
      const { result, fila } = montar();

      await lanzar(() => result.current.aceptar(reserva({ espacio_id: null, espacio_solicitado_id: "reservado" })));

      expect(escrituras[0].payload).toEqual({ espacio_id: "reservado", estado: "verificada" });
      expect(fila().espacio_id).toBe("reservado");
    });

    it("con la sala actual distinta de la pedida: manda la ACTUAL, no se cambia por la pedida", async () => {
      const escrituras = mockEscrituras();
      const { result } = montar();

      await lanzar(() => result.current.aceptar(reserva({ espacio_id: "salon", espacio_solicitado_id: "reservado" })));

      expect(escrituras[0].payload).toEqual({ estado: "verificada" });
    });

    it("jamás escribe la `hora` ni `espacio_id` en null, sea cual sea la combinación", async () => {
      for (const hora_solicitada of [null, "14:00:00", "20:00:00"]) {
        for (const espacio_id of [null, "salon"]) {
          for (const espacio_solicitado_id of [null, "salon", "reservado"]) {
            const escrituras = mockEscrituras();
            const { result } = montar();

            await lanzar(() =>
              result.current.aceptar(reserva({ hora: "14:30:00", hora_solicitada, espacio_id, espacio_solicitado_id })),
            );

            const combinacion = JSON.stringify({ hora_solicitada, espacio_id, espacio_solicitado_id });
            expect(escrituras, combinacion).toHaveLength(1);
            expect(escrituras[0].payload, combinacion).not.toHaveProperty("hora");
            expect(escrituras[0].payload.espacio_id, combinacion).not.toBeNull();
          }
        }
      }
    });
  });

  it("manda UN aviso a notify-reservation-change con `{ id, ...cambios }` y nada más de la reserva", async () => {
    // cambio acordado con el dueño: el cuerpo ya no lleva `hora` ni `espacio_id` (el servidor solo lee el id y relee la BD).
    mockEscrituras();
    const { result } = montar();

    await lanzar(() => result.current.aceptar(reserva()));

    expect(notificaciones()).toEqual([
      {
        funcion: "notify-reservation-change",
        body: { id: "res-1", estado: "verificada" },
      },
    ]);
  });

  it("el aviso sale DESPUÉS de guardar: si la escritura falla no se manda nada", async () => {
    mockEscrituras([{ error: FALLO_DE_BD }]);
    const { result } = montar();

    const resultado = await lanzar(() => result.current.aceptar(reserva()));

    expect(resultado).toEqual({ ok: false });
    expect(notificaciones()).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("No se pudo guardar: permission denied for table reservas");
  });

  it.each([
    ["PGRST204 (columna ausente en el UPDATE)", { code: "PGRST204", message: "x" }],
    ["42703 (undefined_column)", { code: "42703", message: "x" }],
    ["PGRST203 (caché de esquema de PostgREST)", { code: "PGRST203", message: "x" }],
    ["un mensaje que nombra la columna nueva", { message: "column reservas.hora_solicitada does not exist" }],
  ])("con la migración de hora_solicitada sin aplicar (%s) avisa de qué falta, no del error crudo", async (_n, error) => {
    mockEscrituras([{ error }]);
    const { result } = montar();

    await lanzar(() => result.current.aceptar(reserva()));

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("falta aplicar en la base de datos la migración pendiente"));
    expect(notificaciones()).toEqual([]);
  });

  it("CORREGIDO (antes BUG conocido): una escritura denegada por RLS (0 filas, sin error) NO se da por buena: sin «verificada», sin correo, y se deshace el parche", async () => {
    // Antes la escritura no pedía la fila de vuelta: con RLS una actualización denegada
    // devuelve `{ data: [], error: null }` y pasaba por éxito («Reserva verificada para las
    // 14:00» y correo al cliente) sin que nada se hubiera guardado.
    const escrituras = mockEscrituras([{ data: [] }]);
    const { result, fila } = montar();

    const resultado = await lanzar(() => result.current.aceptar(reserva()));

    expect(escrituras[0].select).toBe("id");
    expect(resultado).toEqual({ ok: false });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo guardar: no tienes permiso para cambiar esta reserva, o ya no existe, o ya ha cambiado de estado.",
    );
    expect(notificaciones()).toEqual([]);
    expect(fila().estado).toBe("pendiente");
  });

  it("CORREGIDO (antes BUG conocido): no mira el estado de partida → ahora solo se acepta una PENDIENTE; 'verificada' no se escribe sobre una que ya llegó", async () => {
    // Que solo se pudiera aceptar una pendiente lo garantizaba la pantalla (el botón), no la
    // función. Ahora lo garantiza `accionesDisponibles` dentro del ejecutor.
    const escrituras = mockEscrituras();
    const { result, invalidadas } = montar();

    const resultado = await lanzar(() => result.current.aceptar(reserva({ estado: "completada" })));

    // `cambioDeEstado`: la reserva ya no está en un estado desde el que se pueda aceptar (no es un fallo
    // que se arregle reintentando; el aceptar en bloque lo cuenta aparte).
    expect(resultado).toEqual({ ok: false, cambioDeEstado: true });
    expect(escrituras).toEqual([]);
    expect(notificaciones()).toEqual([]);
    expect(invalidadas).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("Solo se puede aceptar una reserva pendiente: esta está «Llegó».");
  });

  it.each(["verificada", "confirmada", "cancelada", "no_show"])("tampoco acepta una reserva %s", async (estado) => {
    const escrituras = mockEscrituras();
    const { result } = montar();

    const resultado = await lanzar(() => result.current.aceptar(reserva({ estado })));

    expect(resultado.ok).toBe(false);
    expect(escrituras).toEqual([]);
    expect(notificaciones()).toEqual([]);
  });

  it("los avisos de éxito: título corto con la hora ACTUAL de la reserva y, debajo, si al cliente le llega el correo", async () => {
    // cambio acordado con el dueño: «Aceptar» no cambia la hora, así que el aviso dice la que tiene la reserva
    // (14:00), no la que pidió el cliente (13:30).
    mockEscrituras();
    const { result } = montar();

    await lanzar(() => result.current.aceptar(reserva({ hora_solicitada: "13:30:00" })));

    expect(toast.success).toHaveBeenCalledWith("Reserva verificada para las 14:00", {
      description: "Se le manda el correo a miguel@ejemplo.com",
    });
    expect(String(vi.mocked(toast.success).mock.calls[0][0])).not.toContain("Miguel");
  });

  it("sin correo del cliente lo dice en vez de dar por hecho el aviso (y aun así llama a notify: el servidor decide)", async () => {
    mockEscrituras();
    const { result } = montar();

    await lanzar(() => result.current.aceptar(reserva({ email: null })));

    expect(toast.success).toHaveBeenCalledWith("Reserva verificada para las 14:00", {
      description: "No tiene correo: hay que avisarle por teléfono",
    });
    expect(notificaciones()).toHaveLength(1);
  });

  it("antes de que la BD conteste, la fila ya sale verificada en la lista (update optimista), y se queda así al guardar", async () => {
    let liberar!: () => void;
    mockEscrituras([{ esperar: new Promise<void>((r) => (liberar = r)) }]);
    const { result, fila } = montar();

    let promesa!: Promise<Resultado>;
    act(() => {
      promesa = result.current.aceptar(reserva());
    });
    await waitFor(() => expect(fila().estado).toBe("verificada"));
    expect(result.current.estaEnCurso("res-1")).toBe(true);

    await act(async () => {
      liberar();
      await promesa;
    });
    expect(fila().estado).toBe("verificada");
    expect(result.current.estaEnCurso("res-1")).toBe(false);
  });

  it("refresca la lista única de claves (y solo después de escribir), aunque falle", async () => {
    mockEscrituras([{}, { error: FALLO_DE_BD }]);
    const { result, invalidadas } = montar();

    await lanzar(() => result.current.aceptar(reserva()));
    expect(invalidadas).toEqual([...CLAVES_POR_CAMBIO.ocupacion]);

    invalidadas.length = 0;
    await lanzar(() => result.current.aceptar(reserva()));
    expect(invalidadas).toEqual([...CLAVES_POR_CAMBIO.ocupacion]);
  });
});

// ============================================================================
describe("verificar (el modal «Verificar solicitud»)", () => {
  it("escribe la hora y la sala DECIDIDAS con estado 'verificada' y avisa con lo mismo", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar();

    const resultado = await lanzar(() => result.current.verificar(reserva(), { hora: "21:00", espacio_id: "salon" }));

    expect(resultado.ok).toBe(true);
    expect(resultado.cambios).toEqual({ hora: "21:00", espacio_id: "salon", estado: "verificada" });
    expect(escrituras).toEqual([
      {
        tabla: "reservas",
        payload: { hora: "21:00", espacio_id: "salon", estado: "verificada" },
        eq: ["id", "res-1"],
        en: ["estado", ["pendiente"]],
        select: "id",
      },
    ]);
    expect(notificaciones()).toEqual([
      {
        funcion: "notify-reservation-change",
        body: { id: "res-1", hora: "21:00", espacio_id: "salon", estado: "verificada" },
      },
    ]);
  });

  it("sin sala decidida manda espacio_id null (quita la que hubiera)", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar();

    await lanzar(() => result.current.verificar(reserva({ espacio_id: "terraza" }), { hora: "14:00", espacio_id: null }));

    expect(escrituras[0].payload).toEqual({ hora: "14:00", espacio_id: null, estado: "verificada" });
  });

  it("si falla, no avisa al cliente y dice qué pasó", async () => {
    mockEscrituras([{ error: FALLO_DE_BD }]);
    const { result } = montar();

    const resultado = await lanzar(() => result.current.verificar(reserva(), { hora: "21:00", espacio_id: null }));

    expect(resultado).toEqual({ ok: false });
    expect(notificaciones()).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("No se pudo guardar: permission denied for table reservas");
  });

  it("CORREGIDO (antes BUG conocido): con la RLS denegando la escritura en silencio NO da «verificada» ni manda el correo", async () => {
    mockEscrituras([{ data: [] }]);
    const { result } = montar();

    const resultado = await lanzar(() => result.current.verificar(reserva(), { hora: "21:00", espacio_id: null }));

    expect(resultado.ok).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^No se pudo guardar: no tienes permiso/));
    expect(notificaciones()).toEqual([]);
  });

  it("los avisos: título corto con la hora y el efecto de verdad debajo; sin correo, lo dice", async () => {
    mockEscrituras([{}, {}]);
    const { result } = montar();

    await lanzar(() => result.current.verificar(reserva(), { hora: "21:00", espacio_id: "salon" }));
    await lanzar(() => result.current.verificar(reserva({ email: null }), { hora: "14:00", espacio_id: null }));

    expect(toast.success).toHaveBeenNthCalledWith(1, "Reserva verificada para las 21:00", {
      description: "Se le manda el correo a miguel@ejemplo.com",
    });
    expect(toast.success).toHaveBeenNthCalledWith(2, "Reserva verificada para las 14:00", {
      description: "No tiene correo: hay que avisarle por teléfono",
    });
  });

  it("solo se verifica una pendiente", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar();

    const resultado = await lanzar(() => result.current.verificar(reserva({ estado: "verificada" }), { hora: "21:00", espacio_id: null }));

    expect(resultado.ok).toBe(false);
    expect(escrituras).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("Solo se puede verificar una reserva pendiente: esta está «Verificada».");
  });
});

// ============================================================================
describe("rechazar (el «Rechazar» del modal)", () => {
  it("pasa a 'cancelada' (no existe un estado «rechazada») y avisa con `{ id, estado }`", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar();

    const resultado = await lanzar(() => result.current.rechazar(reserva()));

    expect(resultado.ok).toBe(true);
    expect(resultado.cambios).toEqual({ estado: "cancelada" });
    expect(escrituras).toEqual([
      {
        tabla: "reservas",
        payload: { estado: "cancelada" },
        eq: ["id", "res-1"],
        // B1: SOLO si sigue pendiente (igual que «Verificar»: el modal solo se abre con una pendiente).
        en: ["estado", ["pendiente"]],
        select: "id",
      },
    ]);
    expect(notificaciones()).toEqual([
      { funcion: "notify-reservation-change", body: { id: "res-1", estado: "cancelada" } },
    ]);
  });

  it("B1: si otra persona aceptó la solicitud con el modal abierto, rechazarla NO escribe ni manda «rechazada» (dos correos contradictorios)", async () => {
    // A abre el modal con la solicitud pendiente; B la acepta (sale la «propuesta»); A pulsa «Rechazar».
    // El UPDATE va condicionado a «pendiente»: no toca ninguna fila, se relee el estado y se avisa.
    const escrituras = mockEscrituras([{ data: [] }], { data: { estado: "verificada" } });
    const { result, fila, invalidadas } = montar();

    const resultado = await lanzar(() => result.current.rechazar(reserva()));

    expect(resultado.ok).toBe(false);
    expect(escrituras[0].en).toEqual(["estado", ["pendiente"]]);
    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo rechazar la solicitud: la reserva ya ha cambiado de estado (ahora está «Verificada»). Se ha refrescado la pantalla.",
    );
    expect(toast.success).not.toHaveBeenCalled();
    // Ningún correo: al cliente ya le salió la «propuesta» y no se le manda encima la «rechazada».
    expect(notificaciones()).toEqual([]);
    expect(fila().estado).toBe("pendiente"); // el parche en local se deshace…
    expect(invalidadas).toEqual([...CLAVES_POR_CAMBIO.ocupacion]); // …y se refresca lo de verdad
  });

  it("si falla, no avisa y el mensaje es el del rechazo", async () => {
    mockEscrituras([{ error: FALLO_DE_BD }]);
    const { result } = montar();

    const resultado = await lanzar(() => result.current.rechazar(reserva()));

    expect(resultado).toEqual({ ok: false });
    expect(notificaciones()).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("No se pudo rechazar la solicitud: permission denied for table reservas");
  });

  it("CORREGIDO (antes BUG conocido): con la RLS denegando en silencio NO da «Solicitud rechazada» ni avisa al cliente", async () => {
    const escrituras = mockEscrituras([{ data: [] }]);
    const { result } = montar();

    const resultado = await lanzar(() => result.current.rechazar(reserva()));

    expect(escrituras[0].select).toBe("id");
    expect(resultado.ok).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^No se pudo rechazar la solicitud: no tienes permiso/));
    expect(notificaciones()).toEqual([]);
  });

  it.each(["completada", "no_show", "cancelada"])(
    "CORREGIDO (antes BUG conocido): una reserva %s ya no se cancela (decisión del dueño): sin escritura y sin correo",
    async (estado) => {
      // Esa regla vivía solo en el botón de la lista; la función que escribía la ignoraba.
      const escrituras = mockEscrituras();
      const { result } = montar();

      const resultado = await lanzar(() => result.current.rechazar(reserva({ estado })));

      expect(resultado.ok).toBe(false);
      expect(escrituras).toEqual([]);
      expect(notificaciones()).toEqual([]);
      expect(toast.error).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["verificada", "confirmada"])(
    "B1: una reserva %s tampoco se «rechaza»: eso es «Cancelar» de la lista (con su confirmación); el modal de una solicitud solo rechaza pendientes",
    async (estado) => {
      const escrituras = mockEscrituras();
      const { result } = montar();

      const resultado = await lanzar(() => result.current.rechazar(reserva({ estado })));

      expect(resultado.ok).toBe(false);
      expect(escrituras).toEqual([]);
      expect(notificaciones()).toEqual([]);
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Solo se puede rechazar una reserva pendiente: esta está «/));
    },
  );

  it("los avisos: «Solicitud rechazada» y si al cliente le llega el correo", async () => {
    mockEscrituras();
    const { result } = montar();

    await lanzar(() => result.current.rechazar(reserva({ email: null })));

    expect(toast.success).toHaveBeenCalledWith("Solicitud rechazada", {
      description: "No tiene correo: hay que avisarle por teléfono",
    });
  });
});

// ============================================================================
describe("confirmar y cancelar (los botones «Confirmar» y «Cancelar» de la lista)", () => {
  it("confirmar: 'confirmada' SOLO si sigue verificada, y avisa con `{ id, estado }` (antes, la fila entera)", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar([reserva({ estado: "verificada" })]);

    const resultado = await lanzar(() => result.current.confirmar(reserva({ estado: "verificada" })));

    expect(resultado.ok).toBe(true);
    expect(escrituras).toEqual([
      { tabla: "reservas", payload: { estado: "confirmada" }, eq: ["id", "res-1"], en: ["estado", ["verificada"]], select: "id" },
    ]);
    // La fila entera de la reserva (nombre, teléfono, email…) ya no viaja: el servidor solo lee el id.
    expect(notificaciones()).toEqual([
      { funcion: "notify-reservation-change", body: { id: "res-1", estado: "confirmada" } },
    ]);
  });

  it("cancelar: 'cancelada' desde un estado vivo, y avisa con `{ id, estado }`", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar([reserva({ estado: "confirmada" })]);

    const resultado = await lanzar(() => result.current.cancelar(reserva({ estado: "confirmada" })));

    expect(resultado.ok).toBe(true);
    expect(escrituras).toEqual([
      {
        tabla: "reservas",
        payload: { estado: "cancelada" },
        eq: ["id", "res-1"],
        en: ["estado", ["pendiente", "verificada", "confirmada"]],
        select: "id",
      },
    ]);
    expect(notificaciones()).toEqual([
      { funcion: "notify-reservation-change", body: { id: "res-1", estado: "cancelada" } },
    ]);
  });

  it.each(["confirmar", "cancelar"] as const)("%s: con email el aviso es «Estado actualizado correctamente», a secas", async (accion) => {
    mockEscrituras();
    const { result } = montar([reserva({ estado: "verificada" })]);

    await lanzar(() => result.current[accion](reserva({ estado: "verificada" })));

    expect(vi.mocked(toast.success).mock.calls).toEqual([["Estado actualizado correctamente"]]);
  });

  it.each(["confirmar", "cancelar"] as const)("%s: sin email (o en blanco) avisa de que no sale ningún correo", async (accion) => {
    mockEscrituras([{}, {}]);
    const { result } = montar([reserva({ estado: "verificada" })]);

    await lanzar(() => result.current[accion](reserva({ estado: "verificada", email: null })));
    await lanzar(() => result.current[accion](reserva({ estado: "verificada", email: "   " })));

    const aviso = ["Estado actualizado correctamente", { description: "Sin email: no se envía ningún correo al cliente." }];
    expect(vi.mocked(toast.success).mock.calls).toEqual([aviso, aviso]);
  });

  it("si falla, el aviso da el motivo («No se pudo confirmar la reserva: …»), no el genérico «Error al actualizar estado»", async () => {
    mockEscrituras([{ error: FALLO_DE_BD }, { error: FALLO_DE_BD }]);
    const { result } = montar([reserva({ estado: "verificada" })]);

    await lanzar(() => result.current.confirmar(reserva({ estado: "verificada" })));
    await lanzar(() => result.current.cancelar(reserva({ estado: "verificada" })));

    expect(toast.error).toHaveBeenNthCalledWith(1, "No se pudo confirmar la reserva: permission denied for table reservas");
    expect(toast.error).toHaveBeenNthCalledWith(2, "No se pudo cancelar la reserva: permission denied for table reservas");
    expect(notificaciones()).toEqual([]);
  });

  it("CORREGIDO: con la RLS denegando en silencio no da «Estado actualizado» ni manda el correo", async () => {
    mockEscrituras([{ data: [] }, { data: [] }]);
    const { result } = montar([reserva({ estado: "verificada" })]);

    const a = await lanzar(() => result.current.confirmar(reserva({ estado: "verificada" })));
    const b = await lanzar(() => result.current.cancelar(reserva({ estado: "verificada" })));

    expect([a.ok, b.ok]).toEqual([false, false]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(notificaciones()).toEqual([]);
  });

  it("confirmar solo admite una VERIFICADA (el botón de la lista está deshabilitado en las demás)", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar();

    for (const estado of ["pendiente", "confirmada", "completada", "cancelada", "no_show"]) {
      const resultado = await lanzar(() => result.current.confirmar(reserva({ estado })));
      expect(resultado.ok, estado).toBe(false);
    }

    expect(escrituras).toEqual([]);
    expect(notificaciones()).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("Solo se puede confirmar una reserva verificada: esta está «Pendiente».");
  });

  it("CORREGIDO: cancelar una reserva «Llegó» o «No vino» ya no se puede (decisión del dueño), ni por esta vía", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar();

    for (const estado of ["completada", "no_show", "cancelada"]) {
      const resultado = await lanzar(() => result.current.cancelar(reserva({ estado })));
      expect(resultado.ok, estado).toBe(false);
    }

    expect(escrituras).toEqual([]);
    expect(notificaciones()).toEqual([]);
    expect(vi.mocked(toast.error).mock.calls.map(([texto]) => texto)).toEqual([
      "No se puede cancelar una reserva que ya llegó",
      "No se puede cancelar una reserva marcada como «No vino»",
      "La reserva ya está cancelada",
    ]);
  });

  it("refresca la lista única de claves y la fila cambia al instante en la lista", async () => {
    mockEscrituras();
    const { result, invalidadas, fila } = montar([reserva({ estado: "verificada" })]);

    await lanzar(() => result.current.confirmar(reserva({ estado: "verificada" })));

    expect(fila().estado).toBe("confirmada");
    expect(invalidadas).toEqual([...CLAVES_POR_CAMBIO.ocupacion]);
  });
});

// ============================================================================
describe("aceptarVarias (aceptar en bloque)", () => {
  const tres = [
    reserva({ id: "a", nombre: "Ana", email: "ana@ejemplo.com" }),
    reserva({ id: "b", nombre: "Berta", email: "berta@ejemplo.com", hora: "21:00:00", hora_solicitada: "20:30:00" }),
    reserva({ id: "c", nombre: "Carlos", email: null }),
  ];

  /** Las tres reservas, y esperar a que salgan los correos en segundo plano. */
  async function aceptarTres(respuestas: Respuesta[] = [], relectura?: Relectura) {
    const escrituras = mockEscrituras(respuestas, relectura);
    const montaje = montar(tres);
    let devuelto!: Awaited<ReturnType<typeof montaje.result.current.aceptarVarias>>;
    await act(async () => {
      devuelto = await montaje.result.current.aceptarVarias(tres);
    });
    return { ...montaje, escrituras, ...devuelto };
  }

  it("una escritura y UN aviso por reserva (no hay aviso en bloque), cada uno con su id", async () => {
    const { escrituras } = await aceptarTres();

    expect(escrituras.map((e) => e.eq)).toEqual([["id", "a"], ["id", "b"], ["id", "c"]]);
    // cambio acordado con el dueño: cada una se acepta TAL COMO ESTÁ; el UPDATE lleva solo el estado (también la «b»,
    // cuya hora actual 21:00 difiere de la pedida 20:30: antes se reescribía con la pedida).
    expect(escrituras.map((e) => e.payload)).toEqual([{ estado: "verificada" }, { estado: "verificada" }, { estado: "verificada" }]);
    expect(escrituras.map((e) => e.select)).toEqual(["id", "id", "id"]);
    await waitFor(() => expect(notificaciones()).toHaveLength(3));
    expect(notificaciones().map((n) => n.body)).toEqual([
      { id: "a", estado: "verificada" },
      { id: "b", estado: "verificada" },
      { id: "c", estado: "verificada" },
    ]);
  });

  it("«Aceptar en bloque» también acepta cada una TAL COMO ESTÁ: ningún UPDATE lleva `hora` ni `espacio_id` en null (no se borra sala ni mesas); solo se rellena la sala que falta y se pidió", async () => {
    // cambio acordado con el dueño (2026-10-01). «a»: Casa Tomás sin sala; «b»: hora editada (21:00 ≠ 20:30 pedida) y
    // sala puesta por el personal; «c»: Touza, sin sala y con la pedida.
    const bloque = [
      reserva({ id: "a", hora_solicitada: "14:00:00", espacio_id: null, espacio_solicitado_id: null }),
      reserva({ id: "b", hora: "21:00:00", hora_solicitada: "20:30:00", espacio_id: "salon", espacio_solicitado_id: null }),
      reserva({ id: "c", espacio_id: null, espacio_solicitado_id: "reservado" }),
    ];
    const escrituras = mockEscrituras();
    const { result } = montar(bloque);

    let devuelto!: Awaited<ReturnType<typeof result.current.aceptarVarias>>;
    await act(async () => {
      devuelto = await result.current.aceptarVarias(bloque);
    });

    expect(escrituras.map((e) => [e.eq?.[1], e.payload])).toEqual([
      ["a", { estado: "verificada" }],
      ["b", { estado: "verificada" }],
      ["c", { espacio_id: "reservado", estado: "verificada" }],
    ]);
    expect(escrituras.every((e) => !("hora" in e.payload))).toBe(true);
    expect(escrituras.every((e) => e.payload.espacio_id !== null)).toBe(true);
    expect([...devuelto.ok.entries()]).toEqual([
      ["a", { estado: "verificada" }],
      ["b", { estado: "verificada" }],
      ["c", { espacio_id: "reservado", estado: "verificada" }],
    ]);
  });

  it("un solo aviso de resumen, y cuenta a quién hay que llamar porque no tiene correo", async () => {
    const { ok, fallidas } = await aceptarTres();

    expect([...ok.keys()]).toEqual(["a", "b", "c"]);
    expect(ok.get("b")).toEqual({ estado: "verificada" });
    expect(fallidas).toEqual([]);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("3 solicitudes verificadas", {
      description: "1 sin correo: hay que avisarles por teléfono",
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("si todos tienen correo lo dice; en singular, en singular", async () => {
    mockEscrituras();
    const { result } = montar(tres);

    await act(async () => {
      await result.current.aceptarVarias([tres[0]]);
    });

    expect(toast.success).toHaveBeenCalledWith("1 solicitud verificada", { description: "Se les manda el correo a todos" });
  });

  it("si una falla: esa no avisa al cliente, las demás sí, y el resumen cuenta las dos cosas", async () => {
    const { ok, fallidas } = await aceptarTres([{}, { error: FALLO_DE_BD }, {}]);

    expect([...ok.keys()]).toEqual(["a", "c"]);
    expect(fallidas).toEqual(["b"]);
    await waitFor(() => expect(notificaciones()).toHaveLength(2));
    expect(notificaciones().map((n) => (n.body as { id: string }).id)).toEqual(["a", "c"]);
    expect(toast.success).toHaveBeenCalledWith("2 solicitudes verificadas", expect.anything());
    expect(toast.error).toHaveBeenCalledWith("1 solicitud sin verificar", {
      description: "No se pudieron guardar. Inténtalo otra vez.",
    });
  });

  it("si fallan todas: ningún aviso de éxito, ninguna notificación", async () => {
    const { ok, fallidas } = await aceptarTres([{ error: FALLO_DE_BD }, { error: FALLO_DE_BD }, { error: FALLO_DE_BD }]);

    expect(ok.size).toBe(0);
    expect(fallidas).toEqual(["a", "b", "c"]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("3 solicitudes sin verificar", expect.anything());
    expect(notificaciones()).toEqual([]);
  });

  it("los avisos individuales no salen: solo el resumen (ni siquiera el de error de cada escritura)", async () => {
    await aceptarTres([{}, { error: FALLO_DE_BD }, {}]);

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("sin reservas no escribe, no avisa, no refresca y no pinta nada", async () => {
    const escrituras = mockEscrituras();
    const { result, invalidadas } = montar([]);

    let devuelto!: Awaited<ReturnType<typeof result.current.aceptarVarias>>;
    await act(async () => {
      devuelto = await result.current.aceptarVarias([]);
    });

    expect(devuelto.ok.size).toBe(0);
    expect(devuelto.fallidas).toEqual([]);
    expect(escrituras).toEqual([]);
    expect(invalidadas).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(notificaciones()).toEqual([]);
  });

  it("CORREGIDO (antes BUG conocido): con la RLS denegando en silencio NINGUNA cuenta como verificada y no se avisa a los clientes", async () => {
    const { ok, fallidas } = await aceptarTres([{ data: [] }, { data: [] }, { data: [] }]);

    expect(ok.size).toBe(0);
    expect(fallidas).toEqual(["a", "b", "c"]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(notificaciones()).toEqual([]);
  });

  it("B3: las que dejaron de ser pendientes (la lista ya las enseña cambiadas) se cuentan APARTE, no como fallidas, y no se pisan", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar(tres);
    const yaVerificada = reserva({ id: "b", estado: "verificada" });

    let devuelto!: Awaited<ReturnType<typeof result.current.aceptarVarias>>;
    await act(async () => {
      devuelto = await result.current.aceptarVarias([tres[0], yaVerificada, tres[2]]);
    });

    expect(devuelto.yaCambiadas).toEqual(["b"]);
    expect(devuelto.fallidas).toEqual([]);
    expect([...devuelto.ok.keys()]).toEqual(["a", "c"]);
    expect(escrituras.map((e) => (e.eq as [string, string])[1])).toEqual(["a", "c"]);
  });

  it("B3: y lo dice con sus palabras («ya habían cambiado de estado»), sin el «No se pudieron guardar. Inténtalo otra vez.» que no sirve (reintentar falla igual)", async () => {
    mockEscrituras();
    const { result } = montar(tres);
    const cambiadas = [reserva({ id: "b", estado: "verificada" }), reserva({ id: "c", estado: "confirmada" })];

    await act(async () => {
      await result.current.aceptarVarias([tres[0], ...cambiadas]);
    });

    expect(toast.success).toHaveBeenCalledWith("1 solicitud verificada", expect.anything());
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("2 solicitudes ya habían cambiado de estado", {
      description: "Ya estaban gestionadas: no se ha tocado nada y se ha actualizado la lista.",
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("B3: en singular", async () => {
    mockEscrituras();
    const { result } = montar(tres);

    await act(async () => {
      await result.current.aceptarVarias([reserva({ id: "b", estado: "verificada" })]);
    });

    expect(toast.info).toHaveBeenCalledWith("1 solicitud ya había cambiado de estado", {
      description: "Ya estaba gestionada: no se ha tocado nada y se ha actualizado la lista.",
    });
    // Nada verificado: ni resumen de éxito ni de error.
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("B3: la que cambió DESPUÉS de cargar la lista (la BD la tiene ya verificada) también se cuenta como cambiada, no como fallo", async () => {
    // La lista la enseñaba pendiente, pero entre tanto la aceptó otra persona: el UPDATE condicionado
    // no toca nada y la relectura del estado lo confirma.
    const { ok, fallidas, yaCambiadas, escrituras } = await aceptarTres([{}, { data: [] }, {}], { data: { estado: "verificada" } });

    expect([...ok.keys()]).toEqual(["a", "c"]);
    expect(yaCambiadas).toEqual(["b"]);
    expect(fallidas).toEqual([]);
    expect(escrituras).toHaveLength(3);
    expect(toast.info).toHaveBeenCalledWith("1 solicitud ya había cambiado de estado", expect.anything());
    expect(toast.error).not.toHaveBeenCalled();
    // Y al cliente de esa no se le avisa otra vez (no se ha escrito nada): solo a las otras dos.
    await waitFor(() => expect(notificaciones()).toHaveLength(2));
    expect(notificaciones().map((n) => (n.body as { id: string }).id)).toEqual(["a", "c"]);
  });

  it("B3: cada cosa en su cuenta: verificadas, ya cambiadas y fallidas de verdad", async () => {
    const cuatro = [...tres, reserva({ id: "d", nombre: "Diego", email: "diego@ejemplo.com" })];
    mockEscrituras([{}, { error: FALLO_DE_BD }, { data: [] }, {}], { data: { estado: "verificada" } });
    const { result } = montar(cuatro);

    let devuelto!: Awaited<ReturnType<typeof result.current.aceptarVarias>>;
    await act(async () => {
      devuelto = await result.current.aceptarVarias(cuatro);
    });

    expect([...devuelto.ok.keys()]).toEqual(["a", "d"]);
    expect(devuelto.fallidas).toEqual(["b"]);
    expect(devuelto.yaCambiadas).toEqual(["c"]);
    expect(toast.success).toHaveBeenCalledWith("2 solicitudes verificadas", expect.anything());
    expect(toast.info).toHaveBeenCalledWith("1 solicitud ya había cambiado de estado", expect.anything());
    // Lo de «inténtalo otra vez» solo para la que falló de verdad.
    expect(toast.error).toHaveBeenCalledWith("1 solicitud sin verificar", {
      description: "No se pudieron guardar. Inténtalo otra vez.",
    });
  });

  it("UN solo refresco para todo el bloque (no uno por reserva), y sin parche en local (los snapshots de varias a la vez se pisarían)", async () => {
    mockEscrituras();
    const { result, invalidadas, queryClient } = montar(tres);
    const parches: unknown[] = [];
    vi.spyOn(queryClient, "setQueriesData").mockImplementation((...args) => {
      parches.push(args);
      return [];
    });

    await act(async () => {
      await result.current.aceptarVarias(tres);
    });

    expect(invalidadas).toEqual([...CLAVES_POR_CAMBIO.ocupacion]);
    expect(parches).toEqual([]);
  });

  it("si algún correo no sale, UN aviso con cuántos (no uno por cliente), sin tocar lo guardado", async () => {
    // Dos de los tres correos fallan: la función responde con un error y otra dirección está bloqueada.
    vi.mocked(supabase.functions.invoke)
      .mockResolvedValueOnce(RESPUESTA_CON_ERROR as never)
      .mockResolvedValueOnce({ data: null, error: null } as never)
      .mockResolvedValueOnce(sinEnviar("destinatario_suprimido") as never);

    const { ok, escrituras } = await aceptarTres();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith("2 correos a clientes no han salido", {
      description: "Las reservas ya están verificadas, pero esos clientes no reciben el correo. Avísales por teléfono.",
      duration: 10_000,
    });
    // Lo guardado sigue guardado: tres escrituras, tres verificadas, y el resumen de éxito salió.
    expect(escrituras).toHaveLength(3);
    expect(ok.size).toBe(3);
    expect(toast.success).toHaveBeenCalledWith("3 solicitudes verificadas", expect.anything());
  });

  it("y si solo falla uno, lo dice en singular: «la reserva», «ese cliente», «Avísale»", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(RESPUESTA_CON_ERROR as never);

    await aceptarTres();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith("1 correo al cliente no ha salido", {
      description: "La reserva ya está verificada, pero ese cliente no recibe el correo. Avísale por teléfono.",
      duration: 10_000,
    });
  });

  it("B4: si los correos que fallaron se REINTENTAN automáticamente, no manda llamar: lo dice y que el panel avisará si no salen", async () => {
    vi.mocked(supabase.functions.invoke)
      .mockResolvedValueOnce(sinEnviar("fallido_reintentable") as never)
      .mockResolvedValueOnce({ data: null, error: null } as never)
      .mockResolvedValueOnce(sinEnviar("fallido_reintentable") as never);

    await aceptarTres();

    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    expect(toast.info).toHaveBeenCalledWith("2 correos a clientes no han salido todavía", {
      description:
        "Las reservas ya están verificadas. Se reintentarán los envíos automáticamente en unos minutos; si no salen, el panel te avisará.",
      duration: 10_000,
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("B4: con UN solo correo reintentable, en singular: «la reserva», «el envío», «si no sale»", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(sinEnviar("fallido_reintentable") as never);

    await aceptarTres();

    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    expect(toast.info).toHaveBeenCalledWith("1 correo al cliente no ha salido todavía", {
      description:
        "La reserva ya está verificada. Se reintentará el envío automáticamente en unos minutos; si no sale, el panel te avisará.",
      duration: 10_000,
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("B4: mezcla: a los que NO se reintentan hay que llamarlos (en singular), y se dice cuántos se reintentarán automáticamente", async () => {
    vi.mocked(supabase.functions.invoke)
      .mockResolvedValueOnce(sinEnviar("fallido_reintentable") as never)
      .mockResolvedValueOnce(sinEnviar("destinatario_suprimido") as never)
      .mockResolvedValueOnce({ data: null, error: null } as never);

    await aceptarTres();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith("1 correo al cliente no ha salido", {
      description:
        "La reserva ya está verificada, pero ese cliente no recibe el correo. Avísale por teléfono. Otro se reintentará automáticamente.",
      duration: 10_000,
    });
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("B4: mezcla con varios: «Otros 2 se reintentarán automáticamente» y «Avísale» (uno solo al que llamar)", async () => {
    vi.mocked(supabase.functions.invoke)
      .mockResolvedValueOnce(sinEnviar("fallido_reintentable") as never)
      .mockResolvedValueOnce(sinEnviar("destinatario_suprimido") as never)
      .mockResolvedValueOnce(sinEnviar("fallido_reintentable") as never);

    await aceptarTres();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith("1 correo al cliente no ha salido", {
      description:
        "La reserva ya está verificada, pero ese cliente no recibe el correo. Avísale por teléfono. Otros 2 se reintentarán automáticamente.",
      duration: 10_000,
    });
  });

  it("B4: y con varios a los que llamar, en plural: «esos clientes», «Avísales»", async () => {
    vi.mocked(supabase.functions.invoke)
      .mockResolvedValueOnce(sinEnviar("destinatario_suprimido") as never)
      .mockResolvedValueOnce(sinEnviar("destinatario_suprimido") as never)
      .mockResolvedValueOnce(sinEnviar("fallido_reintentable") as never);

    await aceptarTres();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith("2 correos a clientes no han salido", {
      description:
        "Las reservas ya están verificadas, pero esos clientes no reciben el correo. Avísales por teléfono. Otro se reintentará automáticamente.",
      duration: 10_000,
    });
  });
});

// ============================================================================
describe("alternarImportante (la estrella, en la lista y en el kanban)", () => {
  const importante = (extra: Partial<ReservaParaVerificar> & { importante?: boolean } = {}) =>
    ({ ...reserva({ estado: "confirmada" }), importante: false, ...extra }) as ReservaParaVerificar & { importante: boolean };

  it("marcar: escribe `{ importante: true }` filtrando por id y AHORA pide la fila de vuelta, sin condición de estado", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar();

    let ok = false;
    await act(async () => {
      ok = await result.current.alternarImportante(importante());
    });

    expect(ok).toBe(true);
    expect(escrituras).toEqual([
      { tabla: "reservas", payload: { importante: true }, eq: ["id", "res-1"], en: null, select: "id" },
    ]);
  });

  it("desmarcar: escribe `{ importante: false }`; los avisos son los de siempre", async () => {
    mockEscrituras([{}, {}]);
    const { result } = montar();

    await act(async () => {
      await result.current.alternarImportante(importante());
    });
    await act(async () => {
      await result.current.alternarImportante(importante({ importante: true }));
    });

    expect(vi.mocked(toast.success).mock.calls).toEqual([["Reserva marcada como importante"], ["Reserva desmarcada"]]);
  });

  it("vale en CUALQUIER estado (también una cancelada o una que ya llegó)", async () => {
    const escrituras = mockEscrituras();
    const { result } = montar();

    for (const estado of ["pendiente", "verificada", "confirmada", "completada", "cancelada", "no_show"]) {
      await act(async () => {
        expect(await result.current.alternarImportante(importante({ estado })), estado).toBe(true);
      });
    }
    expect(escrituras).toHaveLength(6);
    expect(escrituras.every((e) => e.en === null)).toBe(true);
  });

  it("NO avisa al cliente", async () => {
    mockEscrituras();
    const { result } = montar();

    await act(async () => {
      await result.current.alternarImportante(importante());
    });

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("refresca las listas y lo que enseña la estrella (modo servicio, plano de sala); ni contadores ni disponibilidad", async () => {
    mockEscrituras();
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.alternarImportante(importante());
    });

    expect(invalidadas).toEqual([...CLAVES_POR_CAMBIO.importante]);
    expect(invalidadas).toEqual(["reservas-kanban", "reservas-hoy", "reservas-lista", "reservas-servicio-dia", "reservas_sala_dia"]);
  });

  it("la estrella cambia al instante en la lista (update optimista)", async () => {
    let liberar!: () => void;
    mockEscrituras([{ esperar: new Promise<void>((r) => (liberar = r)) }]);
    const { result, fila } = montar([importante()]);

    let promesa!: Promise<boolean>;
    act(() => {
      promesa = result.current.alternarImportante(importante());
    });
    await waitFor(() => expect((fila() as { importante?: boolean }).importante).toBe(true));

    await act(async () => {
      liberar();
      await promesa;
    });
    expect((fila() as { importante?: boolean }).importante).toBe(true);
  });

  it("si la BD falla: avisa con el mensaje, deshace el parche, REFRESCA (antes no) y lo deja en el log", async () => {
    mockEscrituras([{ error: FALLO_DE_BD }]);
    const { result, invalidadas, fila } = montar([importante()]);

    await act(async () => {
      await result.current.alternarImportante(importante());
    });

    expect(toast.error).toHaveBeenCalledWith("No se pudo actualizar la reserva: permission denied for table reservas");
    expect(toast.success).not.toHaveBeenCalled();
    expect((fila() as { importante?: boolean }).importante).toBe(false);
    // Antes no refrescaba nada al fallar; ahora, como todas las acciones, está en el `finally`.
    expect(invalidadas).toEqual([...CLAVES_POR_CAMBIO.importante]);
    expect(consolaError).toHaveBeenCalledWith("[servicio-reserva] Error al actualizar la reserva:", expect.anything());
  });

  it("CORREGIDO (antes BUG conocido): con la RLS denegando la escritura en silencio NO da «marcada como importante» y deshace el parche", async () => {
    // A diferencia de llegada / no vino / mover (`ErrorSinFilasReserva`), la estrella no pedía la
    // fila de vuelta: una escritura denegada por RLS devolvía `data: null` sin error y pasaba por
    // éxito. El usuario leía «marcada» y no lo estaba.
    mockEscrituras([{ data: null }]);
    const { result, fila } = montar([importante()]);

    let ok = true;
    await act(async () => {
      ok = await result.current.alternarImportante(importante());
    });

    expect(ok).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("No se pudo actualizar la reserva: no tienes permiso para cambiar esta reserva, o ya no existe.");
    expect((fila() as { importante?: boolean }).importante).toBe(false);
  });
});

// ============================================================================
describe("quién avisa al cliente: CINCO acciones, y las demás no", () => {
  // Es la prueba de que unificar el ejecutor no ha movido quién manda correo: aceptar,
  // verificar, confirmar, cancelar y rechazar llaman a `notify-reservation-change` UNA vez con
  // `{ id, ...columnas escritas }`; llegada, «No vino», deshacer, mover y la estrella, nunca.
  it("aceptar, verificar, confirmar, cancelar y rechazar: una llamada cada una, con el id y lo escrito", async () => {
    mockEscrituras();
    const { result } = montar();

    await lanzar(() => result.current.aceptar(reserva({ id: "r-aceptar" })));
    await lanzar(() => result.current.verificar(reserva({ id: "r-verificar" }), { hora: "21:00", espacio_id: "salon" }));
    await lanzar(() => result.current.confirmar(reserva({ id: "r-confirmar", estado: "verificada" })));
    await lanzar(() => result.current.cancelar(reserva({ id: "r-cancelar", estado: "confirmada" })));
    await lanzar(() => result.current.rechazar(reserva({ id: "r-rechazar" })));

    // cambio acordado con el dueño: «Aceptar» ya no manda `hora` ni `espacio_id`, solo el estado (el servidor lee el id).
    expect(notificaciones()).toEqual([
      { funcion: "notify-reservation-change", body: { id: "r-aceptar", estado: "verificada" } },
      { funcion: "notify-reservation-change", body: { id: "r-verificar", hora: "21:00", espacio_id: "salon", estado: "verificada" } },
      { funcion: "notify-reservation-change", body: { id: "r-confirmar", estado: "confirmada" } },
      { funcion: "notify-reservation-change", body: { id: "r-cancelar", estado: "cancelada" } },
      { funcion: "notify-reservation-change", body: { id: "r-rechazar", estado: "cancelada" } },
    ]);
  });

  it("llegada, «No vino», deshacer, mover y la estrella: ninguna llamada", async () => {
    mockEscrituras();
    const { result } = montar();
    const r = { ...reserva({ estado: "confirmada" }), importante: false };

    await act(async () => {
      await result.current.marcarLlegada(r);
      await result.current.marcarNoShow(r);
      await result.current.deshacerLlegadaONoShow({ ...r, estado: "completada" });
      await result.current.moverEspacio(r, "terraza", "Terraza");
      await result.current.alternarImportante(r);
    });

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("y tampoco cuando la escritura falla: sin guardar no se avisa a nadie", async () => {
    mockEscrituras([{ error: FALLO_DE_BD }, { error: FALLO_DE_BD }, { error: FALLO_DE_BD }, { error: FALLO_DE_BD }, { error: FALLO_DE_BD }]);
    const { result } = montar();

    await lanzar(() => result.current.aceptar(reserva()));
    await lanzar(() => result.current.verificar(reserva(), { hora: "21:00", espacio_id: null }));
    await lanzar(() => result.current.confirmar(reserva({ estado: "verificada" })));
    await lanzar(() => result.current.cancelar(reserva({ estado: "confirmada" })));
    await lanzar(() => result.current.rechazar(reserva()));

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});

// ============================================================================
describe("si el correo no sale, el aviso es honesto y lo guardado NO se deshace", () => {
  it.each([
    ["la función responde con un error (401, 500…)", RESPUESTA_CON_ERROR, "no se ha podido pedir el envío del correo."],
    ["la dirección está bloqueada (rebotó o se quejó)", sinEnviar("destinatario_suprimido"), "ese email está bloqueado porque antes rebotó o se quejó."],
    ["el envío falla (Resend caído)", sinEnviar("fallido_definitivo"), "el correo no ha salido (fallido_definitivo)."],
  ])("%s", async (_n, respuesta, problema) => {
    const escrituras = mockEscrituras();
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(respuesta as never);
    const { result, fila } = montar();

    const resultado = await lanzar(() => result.current.aceptar(reserva()));

    // Lo guardado sigue guardado: una sola escritura, la reserva verificada, sin «deshacer».
    expect(resultado.ok).toBe(true);
    expect(escrituras).toHaveLength(1);
    expect(fila().estado).toBe("verificada");
    expect(toast.success).toHaveBeenCalledWith("Reserva verificada para las 14:00", expect.anything());
    // Y el personal se entera, con el nombre y qué hacer.
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("El correo al cliente no ha salido", {
      description: `Miguel Benito: la reserva ya está guardada, pero ${problema} Avísale por teléfono.`,
      duration: 10_000,
    });
  });

  it("B4: si el envío falló pero se reintenta solo (`fallido_reintentable`), NO manda llamar al cliente: dice que se reintentará", async () => {
    mockEscrituras();
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(sinEnviar("fallido_reintentable") as never);
    const { result } = montar();

    const resultado = await lanzar(() => result.current.aceptar(reserva()));

    // Lo guardado sigue guardado y el aviso no es rojo ni habla de teléfono.
    expect(resultado.ok).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("El correo al cliente no ha salido todavía", {
      description:
        "Miguel Benito: la reserva ya está guardada y el correo se reintentará automáticamente en unos minutos; si no consigue salir, el panel te avisará.",
      duration: 10_000,
    });
  });

  it.each(["confirmar", "cancelar", "rechazar"] as const)("%s también avisa si el correo no sale", async (accion) => {
    mockEscrituras();
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(RESPUESTA_CON_ERROR as never);
    // «Rechazar» (el modal de una solicitud) solo parte de una pendiente; «Confirmar» de una verificada.
    const estado = accion === "rechazar" ? "pendiente" : "verificada";
    const { result } = montar([reserva({ estado })]);

    await lanzar(() => result.current[accion](reserva({ estado })));

    expect(toast.error).toHaveBeenCalledWith("El correo al cliente no ha salido", expect.anything());
  });

  it("si la llamada LANZA (red caída) también: lo deja en el log, avisa y no revienta", async () => {
    mockEscrituras();
    vi.mocked(supabase.functions.invoke).mockRejectedValueOnce(new Error("red caída"));
    const { result } = montar();

    const resultado = await lanzar(() => result.current.aceptar(reserva()));

    expect(resultado.ok).toBe(true);
    expect(consolaError).toHaveBeenCalledWith("Error notificando cambio de reserva:", expect.any(Error));
    expect(toast.error).toHaveBeenCalledWith("El correo al cliente no ha salido", expect.anything());
  });

  it.each([
    ["el cliente no tiene correo (ya lo dijo el aviso de éxito)", sinEnviar("reserva_sin_email")],
    ["ya se le había enviado antes (no se repite)", sinEnviar("ya_enviado_o_en_curso")],
    ["la respuesta no dice si salió: no se afirma nada", { data: { success: true, resultado: "?" }, error: null }],
    ["enviado", { data: { success: true, resultado: JSON.stringify({ ok: true }) }, error: null }],
  ])("%s: ningún aviso de fallo", async (_n, respuesta) => {
    mockEscrituras();
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(respuesta as never);
    const { result } = montar();

    await lanzar(() => result.current.aceptar(reserva()));

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("el correo no retrasa el «hecho»: la acción devuelve en cuanto se guarda, sin esperar a la función", async () => {
    mockEscrituras();
    let contestar!: (v: unknown) => void;
    vi.mocked(supabase.functions.invoke).mockReturnValueOnce(new Promise((r) => (contestar = r)) as never);
    const { result } = montar();

    let resultado!: Resultado;
    await act(async () => {
      resultado = await result.current.aceptar(reserva());
    });

    expect(resultado.ok).toBe(true);
    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();

    contestar(RESPUESTA_CON_ERROR);
    await resultado.correo;
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
describe("notificarCambioReserva (la llamada suelta: la usa el alta del panel)", () => {
  it("llama a la Edge Function con `{ id, ...cambios }`", async () => {
    notificarCambioReserva("res-9", { estado: "confirmada" });

    await waitFor(() => expect(notificaciones()).toHaveLength(1));
    expect(notificaciones()).toEqual([
      { funcion: "notify-reservation-change", body: { id: "res-9", estado: "confirmada" } },
    ]);
  });

  it("no espera la respuesta: devuelve undefined al momento", () => {
    expect(notificarCambioReserva("res-9", { estado: "confirmada" })).toBeUndefined();
  });

  it("si la llamada LANZA (red caída), no revienta a quien llama y lo deja en el log", async () => {
    vi.mocked(supabase.functions.invoke).mockRejectedValueOnce(new Error("red caída"));

    expect(() => notificarCambioReserva("res-9", { estado: "confirmada" })).not.toThrow();
    await vi.waitFor(() =>
      expect(consolaError).toHaveBeenCalledWith("Error notificando cambio de reserva:", expect.any(Error)),
    );
  });

  it("CORREGIDO (antes BUG conocido): si la función responde con un error (la forma habitual de supabase-js), ya no se entera nadie a medias: se loguea y se avisa", async () => {
    // `supabase.functions.invoke` no lanza ante un 4xx/5xx: devuelve `{ data, error }`. Antes el
    // `.catch` solo veía las excepciones, así que un correo que no sale (401 por permisos, 400
    // sin id, 500…) ni se logueaba ni se avisaba.
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(RESPUESTA_CON_ERROR as never);

    notificarCambioReserva("res-9", { estado: "confirmada" });

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(consolaError).toHaveBeenCalledWith("Error notificando cambio de reserva:", RESPUESTA_CON_ERROR.error);
    // No hay nombre que poner (solo se conoce el id).
    expect(toast.error).toHaveBeenCalledWith("El correo al cliente no ha salido", {
      description: "La reserva ya está guardada, pero no se ha podido pedir el envío del correo. Avísale por teléfono.",
      duration: 10_000,
    });
  });

  it("si el correo sale, no dice nada", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: { success: true, resultado: JSON.stringify({ ok: true }) },
      error: null,
    } as never);

    notificarCambioReserva("res-9", { estado: "confirmada" });
    await new Promise((r) => setTimeout(r, 0));

    expect(toast.error).not.toHaveBeenCalled();
  });
});
