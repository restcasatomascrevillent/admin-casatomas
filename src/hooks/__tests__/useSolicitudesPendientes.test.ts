/**
 * Tests para src/hooks/useSolicitudesPendientes.ts
 *
 * Cubre:
 * - Carga inicial de solicitudes
 * - Filtrado local por estado
 *
 * La cifra de solicitudes pendientes ya no la da el hook (`countPendientes`, retirado el 2026-10-01: contaba
 * también las de Touza y nadie la usaba): la calcula `contarSolicitudesPendientes`
 * (src/lib/reservas/vistaUnificada.ts), probada en src/lib/__tests__/negocios.test.ts.
 * - updateEstado: llama a Supabase y recarga
 * - updateNotasInternas: llama a Supabase y recarga
 * - Manejo de errores
 * - Suscripción realtime (setup/cleanup)
 * - Realtime y su respaldo (2026-10-01, la tabla no estaba en la publicación y nada avisaba):
 *   canal con nombre propio, relectura al llegar SUBSCRIBED, avisos que se agrupan en UNA
 *   relectura, sondeo cada minuto solo con la pestaña a la vista y sin pisar otra lectura,
 *   sin «cargando» ni toasts en las relecturas que llegan solas, aviso por consola una vez y
 *   salida limpia al desmontar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner");

import * as clienteMock from "@/integrations/supabase/client";
// `resetSupabaseMocks` solo existe en el mock (__mocks__/client.ts), no en el
// cliente real: se saca con un cast para no sumar un error de tipos.
const { supabase } = clienteMock;
const { resetSupabaseMocks } = clienteMock as unknown as { resetSupabaseMocks: () => void };
import { toast } from "sonner";
import {
  INTERVALO_SONDEO_SOLICITUDES_MS,
  PREFIJO_CANAL_SOLICITUDES,
  useSolicitudesPendientes,
} from "@/hooks/useSolicitudesPendientes";
import { olvidarAvisosRealtime } from "@/lib/realtimeCanal";
import { crearDobleCanales, type DobleCanales } from "./dobleCanalRealtime";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeSolicitud = (overrides = {}) => ({
  id: "sol-1",
  nombre: "Juan García",
  telefono: "+34 666 111 222",
  email: "juan@test.com",
  fecha_solicitada: "2026-04-01",
  hora_solicitada: "13:00",
  numero_comensales: 8,
  notas_cliente: "Cumpleaños",
  motivo_rechazo: "grupo_grande",
  descripcion_rechazo: "Grupo superior al máximo permitido",
  estado: "pendiente",
  notas_internas: null,
  created_at: "2026-03-21T10:00:00Z",
  updated_at: "2026-03-21T10:00:00Z",
  ...overrides,
});

// Helper: mock de supabase.from para SELECT devolviendo una lista de solicitudes
function mockSelectSolicitudes(items: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: items[0] ?? null, error: null }),
    then: (onfulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: items, error: null }).then(onfulfilled),
  };
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  return builder;
}

// Helper: mock de supabase.from para UPDATE sin error
function mockUpdateSuccess() {
  const builder = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: (onfulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(onfulfilled),
  };
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  return builder;
}

// Helper: mock de supabase.from para UPDATE con error
function mockUpdateError(message = "DB error") {
  const error = { message };
  const builder = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error }),
    then: (onfulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error }).then(onfulfilled),
  };
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  return builder;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useSolicitudesPendientes", () => {
  beforeEach(() => {
    resetSupabaseMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Carga inicial ──────────────────────────────────────────────────────────

  it("comienza con loading=true y lista vacía", () => {
    // Promesa que nunca resuelve para capturar el estado inicial
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: () => new Promise(() => {}),
    });

    const { result } = renderHook(() => useSolicitudesPendientes());

    expect(result.current.loading).toBe(true);
    expect(result.current.solicitudes).toEqual([]);
  });

  it("carga la lista de solicitudes correctamente", async () => {
    const items = [
      makeSolicitud({ id: "sol-1", estado: "pendiente" }),
      makeSolicitud({ id: "sol-2", estado: "resuelta" }),
      makeSolicitud({ id: "sol-3", estado: "pendiente" }),
    ];
    mockSelectSolicitudes(items);

    const { result } = renderHook(() => useSolicitudesPendientes());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.solicitudes).toHaveLength(3);
    expect(result.current.solicitudes[0].id).toBe("sol-1");
  });

  // Touza no admite reservas (decisión del dueño 2026-10-01): se retiran «calcula countPendientes
  // correctamente» y «muestra 0 pendientes cuando todas están resueltas». El hook ya no cuenta: devuelve las
  // solicitudes tal cual y la cifra la calcula `contarSolicitudesPendientes` (ver la cabecera).
  it("ya no devuelve una cifra de pendientes propia (la que contaba también las de Touza)", async () => {
    mockSelectSolicitudes([makeSolicitud({ id: "sol-1", estado: "pendiente", marca: "touza" })]);

    const { result } = renderHook(() => useSolicitudesPendientes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).not.toHaveProperty("countPendientes");
    expect(result.current.solicitudes).toHaveLength(1);
  });

  it("maneja error de Supabase en la carga inicial", async () => {
    const error = { message: "connection error" };
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: (onfulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error }).then(onfulfilled),
    });

    const { result } = renderHook(() => useSolicitudesPendientes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.solicitudes).toEqual([]);
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Error al cargar solicitudes pendientes"
    );
  });

  // ── Filtrado por estado (lógica de cliente) ────────────────────────────────

  it("filtrar solicitudes por estado=pendiente funciona", async () => {
    const items = [
      makeSolicitud({ id: "sol-1", estado: "pendiente" }),
      makeSolicitud({ id: "sol-2", estado: "resuelta" }),
    ];
    mockSelectSolicitudes(items);

    const { result } = renderHook(() => useSolicitudesPendientes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const pendientes = result.current.solicitudes.filter(
      (s) => s.estado === "pendiente"
    );
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].id).toBe("sol-1");
  });

  // ── updateEstado ───────────────────────────────────────────────────────────

  it("updateEstado llama a Supabase con los argumentos correctos y recarga", async () => {
    const items = [makeSolicitud({ id: "sol-1", estado: "pendiente" })];

    // Primera llamada: carga inicial. Siguientes: update + recarga.
    let callCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const isUpdate = callCount > 1;
      return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: (v: unknown) => unknown) =>
          Promise.resolve({
            data: isUpdate ? null : items,
            error: null,
          }).then(onfulfilled),
      };
    });

    const { result } = renderHook(() => useSolicitudesPendientes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let updateResult: boolean | undefined;
    await act(async () => {
      updateResult = await result.current.updateEstado("sol-1", "resuelta");
    });

    expect(updateResult).toBe(true);
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Solicitud marcada como "resuelta"'
    );
  });

  it("updateEstado devuelve false y muestra error si Supabase falla", async () => {
    const items = [makeSolicitud({ id: "sol-1", estado: "pendiente" })];
    let callCount = 0;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const isUpdate = callCount > 1;
      return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: (v: unknown) => unknown) =>
          Promise.resolve({
            data: isUpdate ? null : items,
            error: isUpdate ? { message: "DB error" } : null,
          }).then(onfulfilled),
      };
    });

    const { result } = renderHook(() => useSolicitudesPendientes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let updateResult: boolean | undefined;
    await act(async () => {
      updateResult = await result.current.updateEstado("sol-1", "resuelta");
    });

    expect(updateResult).toBe(false);
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Error al actualizar estado");
  });

  // ── updateNotasInternas ────────────────────────────────────────────────────

  it("updateNotasInternas llama a Supabase correctamente y recarga", async () => {
    const items = [makeSolicitud({ id: "sol-1", notas_internas: null })];
    let callCount = 0;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const isUpdate = callCount > 1;
      return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: (v: unknown) => unknown) =>
          Promise.resolve({
            data: isUpdate ? null : items,
            error: null,
          }).then(onfulfilled),
      };
    });

    const { result } = renderHook(() => useSolicitudesPendientes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let updateResult: boolean | undefined;
    await act(async () => {
      updateResult = await result.current.updateNotasInternas(
        "sol-1",
        "Llamar mañana por la mañana"
      );
    });

    expect(updateResult).toBe(true);
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Notas guardadas");
  });

  it("updateNotasInternas devuelve false si Supabase falla", async () => {
    const items = [makeSolicitud({ id: "sol-1" })];
    let callCount = 0;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const isUpdate = callCount > 1;
      return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: (v: unknown) => unknown) =>
          Promise.resolve({
            data: isUpdate ? null : items,
            error: isUpdate ? { message: "update failed" } : null,
          }).then(onfulfilled),
      };
    });

    const { result } = renderHook(() => useSolicitudesPendientes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let updateResult: boolean | undefined;
    await act(async () => {
      updateResult = await result.current.updateNotasInternas("sol-1", "nota");
    });

    expect(updateResult).toBe(false);
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Error al guardar notas");
  });

  // ── Realtime ───────────────────────────────────────────────────────────────

  it("suscribe a canal realtime al montar y desuscribe al desmontar", async () => {
    mockSelectSolicitudes([]);

    const { unmount } = renderHook(() => useSolicitudesPendientes());
    // El nombre lleva un número propio de cada suscripción (ver «dos instancias» más abajo).
    await waitFor(() => {
      expect(supabase.channel).toHaveBeenCalledWith(expect.stringMatching(/^solicitudes_realtime-\d+$/));
    });

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });
});

// ─── Realtime y respaldo sin realtime ─────────────────────────────────────────

/**
 * Cada `supabase.from(...)` deja una lectura EN VUELO que el test resuelve cuando quiere
 * (`resolver(i, filas)` / `fallar(i)`), para poder cruzarlas con eventos realtime y con el sondeo.
 */
function lecturasControladas() {
  const pendientes: Array<(r: { data: unknown[] | null; error: unknown }) => void> = [];
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
    let resolver: (r: { data: unknown[] | null; error: unknown }) => void = () => {};
    const respuesta = new Promise<{ data: unknown[] | null; error: unknown }>((ok) => {
      resolver = ok;
    });
    pendientes.push(resolver);
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.order = () => b;
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => respuesta.then(ok, ko);
    return b;
  });
  return {
    /** Cuántas lecturas se han lanzado. */
    total: () => pendientes.length,
    resolver: (i: number, filas: unknown[]) => pendientes[i]({ data: filas, error: null }),
    fallar: (i: number) => pendientes[i]({ data: null, error: { message: "Failed to fetch" } }),
  };
}

describe("useSolicitudesPendientes · realtime y respaldo sin realtime", () => {
  let canales: DobleCanales;
  let warn: ReturnType<typeof vi.spyOn>;
  let visibilidad: DocumentVisibilityState;

  beforeEach(() => {
    resetSupabaseMocks();
    olvidarAvisosRealtime();
    canales = crearDobleCanales();
    (supabase.channel as ReturnType<typeof vi.fn>).mockImplementation(canales.channel);
    // Como realtime-js: el CLOSED de la salida llega DENTRO de removeChannel.
    (supabase.removeChannel as ReturnType<typeof vi.fn>).mockImplementation(canales.removeChannel);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    visibilidad = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidad });
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
    delete (document as { visibilityState?: unknown }).visibilityState;
    (supabase.removeChannel as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    vi.clearAllMocks();
  });

  it("dos instancias montadas a la vez usan canales DISTINTOS", () => {
    mockSelectSolicitudes([]);

    renderHook(() => useSolicitudesPendientes());
    renderHook(() => useSolicitudesPendientes());

    const nombres = canales.nombres();
    expect(nombres).toHaveLength(2);
    expect(new Set(nombres).size).toBe(2);
    for (const nombre of nombres) expect(nombre.startsWith(`${PREFIJO_CANAL_SOLICITUDES}-`)).toBe(true);
  });

  it("al llegar SUBSCRIBED relee EN SILENCIO (sin «cargando») y aplica lo nuevo", async () => {
    const lecturas = lecturasControladas();
    const { result } = renderHook(() => useSolicitudesPendientes());
    await act(async () => lecturas.resolver(0, [makeSolicitud({ id: "sol-1" })]));

    act(() => canales.ultimo().estado("SUBSCRIBED"));
    expect(lecturas.total()).toBe(2);
    expect(result.current.loading).toBe(false);

    await act(async () =>
      lecturas.resolver(1, [makeSolicitud({ id: "sol-hoy", motivo_rechazo: "reserva_hoy" }), makeSolicitud({ id: "sol-1" })]),
    );
    expect(result.current.solicitudes.map((s) => s.id)).toEqual(["sol-hoy", "sol-1"]);
  });

  it("los avisos que llegan con una lectura en curso se agrupan: UNA relectura al terminar, nunca dos a la vez", async () => {
    const lecturas = lecturasControladas();
    const { result } = renderHook(() => useSolicitudesPendientes());
    expect(lecturas.total()).toBe(1); // la del montaje, en vuelo

    act(() => {
      canales.ultimo().estado("SUBSCRIBED");
      canales.ultimo().cambio({ eventType: "INSERT" });
      canales.ultimo().cambio({ eventType: "UPDATE" });
      canales.ultimo().cambio({ eventType: "DELETE" });
    });
    expect(lecturas.total()).toBe(1);

    await act(async () => lecturas.resolver(0, [makeSolicitud({ id: "sol-1" })]));
    expect(lecturas.total()).toBe(2); // la relectura apuntada, una sola

    await act(async () => lecturas.resolver(1, [makeSolicitud({ id: "sol-2" }), makeSolicitud({ id: "sol-1" })]));
    expect(lecturas.total()).toBe(2);
    expect(result.current.solicitudes.map((s) => s.id)).toEqual(["sol-2", "sol-1"]);
  });

  it("sondeo cada minuto SOLO con la pestaña a la vista, en silencio (sin «cargando»)", async () => {
    vi.useFakeTimers();
    const lecturas = lecturasControladas();
    const { result } = renderHook(() => useSolicitudesPendientes());
    await act(async () => lecturas.resolver(0, [makeSolicitud({ id: "sol-1" })]));
    expect(lecturas.total()).toBe(1);

    visibilidad = "hidden";
    act(() => {
      vi.advanceTimersByTime(INTERVALO_SONDEO_SOLICITUDES_MS * 3);
    });
    expect(lecturas.total()).toBe(1);

    visibilidad = "visible";
    act(() => {
      vi.advanceTimersByTime(INTERVALO_SONDEO_SOLICITUDES_MS);
    });
    expect(lecturas.total()).toBe(2);
    expect(result.current.loading).toBe(false);

    await act(async () =>
      lecturas.resolver(1, [makeSolicitud({ id: "sol-hoy", motivo_rechazo: "reserva_hoy" }), makeSolicitud({ id: "sol-1" })]),
    );
    expect(result.current.solicitudes.map((s) => s.id)).toEqual(["sol-hoy", "sol-1"]);
    expect(result.current.loading).toBe(false);
  });

  it("el sondeo no se solapa con una lectura en curso: se salta ese minuto", async () => {
    vi.useFakeTimers();
    const lecturas = lecturasControladas();
    renderHook(() => useSolicitudesPendientes());
    expect(lecturas.total()).toBe(1); // la del montaje, en vuelo

    act(() => {
      vi.advanceTimersByTime(INTERVALO_SONDEO_SOLICITUDES_MS * 2);
    });
    expect(lecturas.total()).toBe(1);

    await act(async () => lecturas.resolver(0, []));
    expect(lecturas.total()).toBe(1); // saltarse un minuto no deja nada apuntado

    act(() => {
      vi.advanceTimersByTime(INTERVALO_SONDEO_SOLICITUDES_MS);
    });
    expect(lecturas.total()).toBe(2);
  });

  it("un sondeo que no trae cambios deja la MISMA lista (la Lista no se recalcula cada minuto)", async () => {
    vi.useFakeTimers();
    const lecturas = lecturasControladas();
    const { result } = renderHook(() => useSolicitudesPendientes());
    await act(async () => lecturas.resolver(0, [makeSolicitud({ id: "sol-1" })]));
    const antes = result.current.solicitudes;

    act(() => {
      vi.advanceTimersByTime(INTERVALO_SONDEO_SOLICITUDES_MS);
    });
    await act(async () => lecturas.resolver(1, [makeSolicitud({ id: "sol-1" })]));
    expect(result.current.solicitudes).toBe(antes);

    act(() => {
      vi.advanceTimersByTime(INTERVALO_SONDEO_SOLICITUDES_MS);
    });
    await act(async () => lecturas.resolver(2, [makeSolicitud({ id: "sol-1", estado: "resuelta" })]));
    expect(result.current.solicitudes).not.toBe(antes);
    expect(result.current.solicitudes[0].estado).toBe("resuelta");
  });

  it("si falla una relectura que llega sola (sondeo) no sale toast; si falla la carga que pide alguien, sí", async () => {
    vi.useFakeTimers();
    const lecturas = lecturasControladas();
    const { result } = renderHook(() => useSolicitudesPendientes());
    await act(async () => lecturas.resolver(0, [makeSolicitud({ id: "sol-1" })]));

    act(() => {
      vi.advanceTimersByTime(INTERVALO_SONDEO_SOLICITUDES_MS);
    });
    await act(async () => lecturas.fallar(1));
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(result.current.solicitudes.map((s) => s.id)).toEqual(["sol-1"]); // lo de antes sigue

    let pedida: Promise<void> | undefined;
    act(() => {
      pedida = result.current.fetchSolicitudes();
    });
    await act(async () => {
      lecturas.fallar(2);
      await pedida;
    });
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Error al cargar solicitudes pendientes");
  });

  it("avisa por consola UNA vez: el `system` de error del servidor (tabla sin publicar) y luego los fallos del canal", () => {
    mockSelectSolicitudes([]);
    renderHook(() => useSolicitudesPendientes());
    const canal = canales.ultimo();
    expect(canal.alEstado).toBeTypeOf("function");

    act(() =>
      canal.sistema({
        extension: "postgres_changes",
        status: "error",
        message: "Unable to subscribe to changes with given parameters. Please check Realtime is enabled…",
      }),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[realtime]");
    expect(String(warn.mock.calls[0][0])).toContain(canal.nombre);

    act(() => {
      canal.estado("CHANNEL_ERROR", new Error("mismatch between server and client bindings for postgres changes"));
      canal.estado("TIMED_OUT");
      canal.estado("CLOSED");
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("al desmontar quita SU canal, para el sondeo y el CLOSED de esa salida no avisa", async () => {
    vi.useFakeTimers();
    const lecturas = lecturasControladas();
    const { unmount } = renderHook(() => useSolicitudesPendientes());
    await act(async () => lecturas.resolver(0, []));
    const canal = canales.ultimo();

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalledWith(canal);
    expect(vi.getTimerCount()).toBe(0); // el sondeo ya no está programado

    vi.advanceTimersByTime(INTERVALO_SONDEO_SOLICITUDES_MS * 3);
    expect(lecturas.total()).toBe(1);

    canal.estado("CLOSED");
    expect(warn).not.toHaveBeenCalled();
  });
});
