/**
 * `useVerificacionReservas` — tests de caracterización de EFECTOS.
 *
 * Fijan lo que hacen HOY las acciones de verificación (aceptar de un clic,
 * verificar con hora y sala, rechazar, aceptar en bloque) y `notificarCambioReserva`,
 * aunque alguna parte sea fea: qué se escribe en `reservas` y con qué filtros, qué
 * argumento recibe `notify-reservation-change`, en qué casos NO se llama, qué pasa
 * cuando la escritura falla o la RLS la deniega en silencio.
 *
 * No se repite lo que ya cubre `useVerificacionReservas.test.ts` (la regla
 * `difiereSolicitudDeOferta` contra el correo real y los textos de los avisos).
 *
 * `// BUG conocido` marca lo que está mal y se deja así a propósito: este fichero
 * NO arregla nada, describe el punto de partida para el paso que unifique cómo se
 * escribe el estado de una reserva.
 *
 * LAS TRES FORMAS DE LLAMAR A `notify-reservation-change` (el servidor solo lee
 * `reserva_id ?? id`: el resto del cuerpo se ignora)
 * ----------------------------------------------------------------------------
 *   1. Este módulo (`notificarCambioReserva`):   `{ id, ...cambios }`
 *   2. El `updateReservationStatus` de la lista: `{ ...reservaEntera, estado }`
 *   3. `useSolicitudesPendientes`:               `{ reserva_id }`
 * Aquí solo se fija la primera; las otras viven en código que este paso no toca.
 *
 * Nada llega a Supabase: el cliente y `sonner` están mockeados.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner");

import { supabase } from "@/integrations/supabase/client";
import * as clienteMock from "@/integrations/supabase/client";
const { resetSupabaseMocks } = clienteMock as unknown as { resetSupabaseMocks: () => void };
import { toast } from "sonner";
import {
  type ReservaParaVerificar,
  aceptarComoSolicitado,
  aceptarVariasComoSolicitado,
  notificarCambioReserva,
  rechazarReserva,
  verificarConHoraYSala,
} from "@/hooks/useVerificacionReservas";

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
  /** Columnas pedidas de vuelta con `.select(...)`; `null` si nunca se pidió. */
  select: string | null;
}
interface Respuesta {
  error?: unknown;
  data?: unknown;
}

/**
 * Cada `await` de una escritura consume la siguiente respuesta. Sin más, éxito.
 * `data` por defecto es `null`: estas funciones NUNCA piden la fila de vuelta.
 */
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
        return Promise.resolve({ data: "data" in r ? r.data : null, error: r.error ?? null }).then(ok, ko);
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

const FALLO_DE_BD = { code: "42501", message: "permission denied for table reservas" };

let consolaError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetSupabaseMocks();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consolaError.mockRestore();
});

describe("aceptarComoSolicitado (el «Aceptar» de un clic de la lista)", () => {
  it("escribe hora + espacio_id + estado 'verificada' en `reservas`, filtrando por id", async () => {
    const escrituras = mockEscrituras();

    const resultado = await aceptarComoSolicitado(reserva());

    expect(resultado).toEqual({
      ok: true,
      cambios: { hora: "14:00:00", espacio_id: null, estado: "verificada" },
    });
    expect(escrituras).toEqual([
      {
        tabla: "reservas",
        payload: { hora: "14:00:00", espacio_id: null, estado: "verificada" },
        eq: ["id", "res-1"],
        select: null,
      },
    ]);
  });

  it("acepta lo que pidió el cliente: hora_solicitada y espacio_solicitado_id mandan sobre los vigentes", async () => {
    const escrituras = mockEscrituras();

    await aceptarComoSolicitado(
      reserva({ hora: "21:00:00", hora_solicitada: "13:30:00", espacio_id: "salon", espacio_solicitado_id: null }),
    );

    expect(escrituras[0].payload).toEqual({ hora: "13:30:00", espacio_id: null, estado: "verificada" });
  });

  it("manda UN aviso a notify-reservation-change con `{ id, ...cambios }` y nada más de la reserva", async () => {
    mockEscrituras();

    await aceptarComoSolicitado(reserva());

    expect(notificaciones()).toEqual([
      {
        funcion: "notify-reservation-change",
        body: { id: "res-1", hora: "14:00:00", espacio_id: null, estado: "verificada" },
      },
    ]);
  });

  it("el aviso sale DESPUÉS de guardar: si la escritura falla no se manda nada", async () => {
    mockEscrituras([{ error: FALLO_DE_BD }]);

    const resultado = await aceptarComoSolicitado(reserva());

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

    await aceptarComoSolicitado(reserva());

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("falta aplicar en la base de datos la migración pendiente"));
    expect(notificaciones()).toEqual([]);
  });

  it("BUG conocido: una escritura denegada por RLS (0 filas, sin error) se da por buena y se avisa al cliente", async () => {
    // La escritura NO pide la fila de vuelta (`.select("id")`), así que con RLS una
    // actualización denegada devuelve `{ data: [], error: null }` y aquí pasa por
    // éxito: «Reserva verificada para las 14:00» y correo al cliente, sin que nada se
    // haya guardado. `useAccionesServicioReserva` y `useCambiarSalaReserva` sí lo
    // comprueban (`ErrorSinFilasReserva`); estas funciones no.
    const escrituras = mockEscrituras([{ data: [] }]);

    const resultado = await aceptarComoSolicitado(reserva());

    expect(escrituras[0].select).toBeNull();
    expect(resultado.ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Reserva verificada para las 14:00", expect.anything());
    expect(toast.error).not.toHaveBeenCalled();
    expect(notificaciones()).toHaveLength(1);
  });

  it("`silencioso`: sin avisos en pantalla, pero el correo al cliente sale igual", async () => {
    mockEscrituras();

    const resultado = await aceptarComoSolicitado(reserva(), { silencioso: true });

    expect(resultado.ok).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(notificaciones()).toHaveLength(1);
  });

  it("`silencioso` y fallo: tampoco avisa del error (quien llama cuenta los fallos)", async () => {
    mockEscrituras([{ error: FALLO_DE_BD }]);

    const resultado = await aceptarComoSolicitado(reserva(), { silencioso: true });

    expect(resultado).toEqual({ ok: false });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("BUG conocido: no mira el estado de partida; 'verificada' se escribe también sobre una reserva que ya llegó", async () => {
    // Que solo se pueda aceptar una pendiente lo garantiza la pantalla (el botón), no la
    // función. Con un único ejecutor que conozca las reglas, esto es lo que hay que guardar.
    const escrituras = mockEscrituras();

    await aceptarComoSolicitado(reserva({ estado: "completada" }));

    expect(escrituras[0].payload.estado).toBe("verificada");
    expect(notificaciones()).toHaveLength(1);
  });
});

describe("verificarConHoraYSala (el modal «Verificar solicitud»)", () => {
  it("escribe la hora y la sala DECIDIDAS con estado 'verificada' y avisa con lo mismo", async () => {
    const escrituras = mockEscrituras();

    const resultado = await verificarConHoraYSala(reserva(), { hora: "21:00", espacio_id: "salon" });

    expect(resultado).toEqual({ ok: true, cambios: { hora: "21:00", espacio_id: "salon", estado: "verificada" } });
    expect(escrituras).toEqual([
      {
        tabla: "reservas",
        payload: { hora: "21:00", espacio_id: "salon", estado: "verificada" },
        eq: ["id", "res-1"],
        select: null,
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

    await verificarConHoraYSala(reserva({ espacio_id: "terraza" }), { hora: "14:00", espacio_id: null });

    expect(escrituras[0].payload).toEqual({ hora: "14:00", espacio_id: null, estado: "verificada" });
  });

  it("si falla, no avisa al cliente y dice qué pasó", async () => {
    mockEscrituras([{ error: FALLO_DE_BD }]);

    const resultado = await verificarConHoraYSala(reserva(), { hora: "21:00", espacio_id: null });

    expect(resultado).toEqual({ ok: false });
    expect(notificaciones()).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("No se pudo guardar: permission denied for table reservas");
  });

  it("BUG conocido: con la RLS denegando la escritura en silencio, da «verificada» y manda el correo", async () => {
    mockEscrituras([{ data: [] }]);

    const resultado = await verificarConHoraYSala(reserva(), { hora: "21:00", espacio_id: null });

    expect(resultado.ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Reserva verificada para las 21:00", expect.anything());
    expect(notificaciones()).toHaveLength(1);
  });
});

describe("rechazarReserva (el «Rechazar» del modal)", () => {
  it("pasa a 'cancelada' (no existe un estado «rechazada») y avisa con `{ id, estado }`", async () => {
    const escrituras = mockEscrituras();

    const resultado = await rechazarReserva(reserva());

    expect(resultado).toEqual({ ok: true, cambios: { estado: "cancelada" } });
    expect(escrituras).toEqual([
      { tabla: "reservas", payload: { estado: "cancelada" }, eq: ["id", "res-1"], select: null },
    ]);
    expect(notificaciones()).toEqual([
      { funcion: "notify-reservation-change", body: { id: "res-1", estado: "cancelada" } },
    ]);
  });

  it("si falla, no avisa y el mensaje es el del rechazo", async () => {
    mockEscrituras([{ error: FALLO_DE_BD }]);

    const resultado = await rechazarReserva(reserva());

    expect(resultado).toEqual({ ok: false });
    expect(notificaciones()).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("No se pudo rechazar la solicitud: permission denied for table reservas");
  });

  it("BUG conocido: con la RLS denegando la escritura en silencio, da «Solicitud rechazada» y avisa al cliente", async () => {
    const escrituras = mockEscrituras([{ data: [] }]);

    const resultado = await rechazarReserva(reserva());

    expect(escrituras[0].select).toBeNull();
    expect(resultado.ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Solicitud rechazada", expect.anything());
    expect(notificaciones()).toHaveLength(1);
  });

  it("BUG conocido: tampoco mira el estado de partida; cancela una reserva que ya llegó o no vino", async () => {
    // Decisión del dueño: una reserva «Llegó» / «No vino» ya no se cancela. Esa regla
    // vive hoy solo en el botón de la lista; esta función la ignora.
    for (const estado of ["completada", "no_show"]) {
      const escrituras = mockEscrituras();
      vi.mocked(supabase.functions.invoke).mockClear();

      await rechazarReserva(reserva({ estado }));

      expect(escrituras[0].payload, estado).toEqual({ estado: "cancelada" });
      expect(notificaciones(), estado).toHaveLength(1);
    }
  });

  it("`silencioso`: sin avisos en pantalla, el correo sí sale", async () => {
    mockEscrituras();

    await rechazarReserva(reserva(), { silencioso: true });

    expect(toast.success).not.toHaveBeenCalled();
    expect(notificaciones()).toHaveLength(1);
  });
});

describe("aceptarVariasComoSolicitado (aceptar en bloque)", () => {
  const tres = [
    reserva({ id: "a", nombre: "Ana", email: "ana@ejemplo.com" }),
    reserva({ id: "b", nombre: "Berta", email: "berta@ejemplo.com", hora: "21:00:00", hora_solicitada: "20:30:00" }),
    reserva({ id: "c", nombre: "Carlos", email: null }),
  ];

  it("una escritura y UN aviso por reserva (no hay aviso en bloque), cada uno con su id", async () => {
    const escrituras = mockEscrituras();

    await aceptarVariasComoSolicitado(tres);

    expect(escrituras.map((e) => e.eq)).toEqual([["id", "a"], ["id", "b"], ["id", "c"]]);
    expect(escrituras.map((e) => e.payload.estado)).toEqual(["verificada", "verificada", "verificada"]);
    expect(notificaciones().map((n) => n.body)).toEqual([
      { id: "a", hora: "14:00:00", espacio_id: null, estado: "verificada" },
      { id: "b", hora: "20:30:00", espacio_id: null, estado: "verificada" },
      { id: "c", hora: "14:00:00", espacio_id: null, estado: "verificada" },
    ]);
  });

  it("un solo aviso de resumen, y cuenta a quién hay que llamar porque no tiene correo", async () => {
    mockEscrituras();

    const { ok, fallidas } = await aceptarVariasComoSolicitado(tres);

    expect([...ok.keys()]).toEqual(["a", "b", "c"]);
    expect(fallidas).toEqual([]);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("3 solicitudes verificadas", {
      description: "1 sin correo: hay que avisarles por teléfono",
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("si todos tienen correo lo dice; en singular, en singular", async () => {
    mockEscrituras();

    await aceptarVariasComoSolicitado([tres[0]]);

    expect(toast.success).toHaveBeenCalledWith("1 solicitud verificada", { description: "Se les manda el correo a todos" });
  });

  it("si una falla: esa no avisa al cliente, las demás sí, y el resumen cuenta las dos cosas", async () => {
    mockEscrituras([{}, { error: FALLO_DE_BD }, {}]);

    const { ok, fallidas } = await aceptarVariasComoSolicitado(tres);

    expect([...ok.keys()]).toEqual(["a", "c"]);
    expect(fallidas).toEqual(["b"]);
    expect(notificaciones().map((n) => (n.body as { id: string }).id)).toEqual(["a", "c"]);
    expect(toast.success).toHaveBeenCalledWith("2 solicitudes verificadas", expect.anything());
    expect(toast.error).toHaveBeenCalledWith("1 solicitud sin verificar", {
      description: "No se pudieron guardar. Inténtalo otra vez.",
    });
  });

  it("si fallan todas: ningún aviso de éxito, ninguna notificación", async () => {
    mockEscrituras([{ error: FALLO_DE_BD }, { error: FALLO_DE_BD }, { error: FALLO_DE_BD }]);

    const { ok, fallidas } = await aceptarVariasComoSolicitado(tres);

    expect(ok.size).toBe(0);
    expect(fallidas).toEqual(["a", "b", "c"]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("3 solicitudes sin verificar", expect.anything());
    expect(notificaciones()).toEqual([]);
  });

  it("los avisos individuales no salen: solo el resumen", async () => {
    mockEscrituras([{}, { error: FALLO_DE_BD }, {}]);

    await aceptarVariasComoSolicitado(tres);

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("sin reservas no escribe, no avisa y no pinta nada", async () => {
    const escrituras = mockEscrituras();

    const { ok, fallidas } = await aceptarVariasComoSolicitado([]);

    expect(ok.size).toBe(0);
    expect(fallidas).toEqual([]);
    expect(escrituras).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(notificaciones()).toEqual([]);
  });

  it("BUG conocido: con la RLS denegando en silencio, las cuenta TODAS como verificadas y avisa a los clientes", async () => {
    mockEscrituras([{ data: [] }, { data: [] }, { data: [] }]);

    const { ok, fallidas } = await aceptarVariasComoSolicitado(tres);

    expect(ok.size).toBe(3);
    expect(fallidas).toEqual([]);
    expect(notificaciones()).toHaveLength(3);
  });
});

describe("notificarCambioReserva (fire-and-forget)", () => {
  it("llama a la Edge Function con `{ id, ...cambios }`", () => {
    notificarCambioReserva("res-9", { estado: "confirmada" });

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

  it("BUG conocido: si la función responde con un error (la forma habitual de supabase-js), nadie se entera", async () => {
    // `supabase.functions.invoke` no lanza ante un 4xx/5xx: devuelve `{ data, error }`.
    // El `.catch` de `notificarCambioReserva` solo ve las excepciones, así que un correo
    // que no sale (401 por permisos, 400 sin id, 500…) ni se loguea ni se avisa.
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: null,
      error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code" },
    } as never);

    notificarCambioReserva("res-9", { estado: "confirmada" });
    await new Promise((r) => setTimeout(r, 0));

    expect(consolaError).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("este módulo no toca la caché de React Query", () => {
  it("escribe solo en `reservas` y sin refrescar nada: quien llama refresca (la lista con refetch, el modal con onSuccess)", async () => {
    const escrituras = mockEscrituras();

    await aceptarComoSolicitado(reserva());
    await verificarConHoraYSala(reserva({ id: "res-2" }), { hora: "14:00", espacio_id: null });
    await rechazarReserva(reserva({ id: "res-3" }));

    expect(escrituras.map((e) => e.tabla)).toEqual(["reservas", "reservas", "reservas"]);
    // No hay QueryClient en juego: ni se importa ni se recibe. Cualquier otra pantalla
    // que ya tuviera cargada esa reserva (kanban de Hoy, resumen…) la sigue viendo vieja
    // hasta su siguiente refetch, salvo que quien llama invalide sus claves.
  });
});
