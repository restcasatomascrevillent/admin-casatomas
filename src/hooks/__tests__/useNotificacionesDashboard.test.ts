/**
 * Tests para src/hooks/useNotificacionesDashboard.ts
 *
 * Cubre:
 * - Estado inicial
 * - Carga de notificaciones y cálculo de no leídas
 * - marcarLeida: actualiza estado local optimistamente
 * - marcarTodasLeidas: pone todas a leida=true
 * - eliminarNotificacion: quita la notificación de la lista optimistamente
 * - Inserción realtime: nueva notificación se añade al inicio
 * - Suscripción / cleanup del canal realtime
 * - Realtime (2026-10-01, la tabla no estaba en la publicación y nada avisaba): canal con nombre
 *   propio de cada campana, relectura en silencio al llegar SUBSCRIBED (también al reconectar),
 *   lecturas cruzadas, duplicados y pérdidas entre relectura y evento, aviso por consola una vez
 *   y salida limpia al desmontar.
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
import { PREFIJO_CANAL_NOTIFICACIONES, useNotificacionesDashboard } from "@/hooks/useNotificacionesDashboard";
import { INTERVALO_SONDEO_MS, olvidarAvisosRealtime } from "@/lib/realtimeCanal";
import { crearDobleCanales, type DobleCanales } from "./dobleCanalRealtime";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeNotif = (overrides = {}) => ({
  id: "notif-1",
  tipo: "nueva_solicitud",
  titulo: "Nueva solicitud pendiente",
  mensaje: "Juan García necesita atención",
  referencia_id: "sol-1",
  referencia_tipo: "solicitud_pendiente",
  leida: false,
  created_at: "2026-03-21T10:00:00Z",
  ...overrides,
});

function mockSelectNotifs(items: unknown[], error: unknown = null) {
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (onfulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: items, error }).then(onfulfilled),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useNotificacionesDashboard", () => {
  beforeEach(() => {
    resetSupabaseMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Estado inicial ─────────────────────────────────────────────────────────

  it("comienza en loading=true con lista vacía", () => {
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: () => new Promise(() => {}),
    });

    const { result } = renderHook(() => useNotificacionesDashboard());

    expect(result.current.loading).toBe(true);
    expect(result.current.notificaciones).toEqual([]);
    expect(result.current.countNoLeidas).toBe(0);
  });

  // ── Carga ──────────────────────────────────────────────────────────────────

  it("carga notificaciones y calcula countNoLeidas correctamente", async () => {
    const items = [
      makeNotif({ id: "n-1", leida: false }),
      makeNotif({ id: "n-2", leida: true }),
      makeNotif({ id: "n-3", leida: false }),
    ];
    mockSelectNotifs(items);

    const { result } = renderHook(() => useNotificacionesDashboard());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.notificaciones).toHaveLength(3);
    expect(result.current.countNoLeidas).toBe(2);
  });

  it("countNoLeidas=0 cuando todas están leídas", async () => {
    const items = [
      makeNotif({ id: "n-1", leida: true }),
      makeNotif({ id: "n-2", leida: true }),
    ];
    mockSelectNotifs(items);

    const { result } = renderHook(() => useNotificacionesDashboard());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.countNoLeidas).toBe(0);
  });

  it("maneja error de Supabase sin romper el hook", async () => {
    mockSelectNotifs([], { message: "connection refused" });

    const { result } = renderHook(() => useNotificacionesDashboard());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notificaciones).toEqual([]);
  });

  // ── marcarLeida ────────────────────────────────────────────────────────────

  it("marcarLeida actualiza el estado local y decrementa countNoLeidas", async () => {
    const items = [
      makeNotif({ id: "n-1", leida: false }),
      makeNotif({ id: "n-2", leida: false }),
    ];

    let callCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const isUpdate = callCount > 1;
      return {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: (v: unknown) => unknown) =>
          Promise.resolve({
            data: isUpdate ? null : items,
            error: null,
          }).then(onfulfilled),
      };
    });

    const { result } = renderHook(() => useNotificacionesDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.countNoLeidas).toBe(2);

    await act(async () => {
      await result.current.marcarLeida("n-1");
    });

    expect(result.current.countNoLeidas).toBe(1);
    const n1 = result.current.notificaciones.find((n) => n.id === "n-1");
    expect(n1?.leida).toBe(true);
  });

  it("no decrementa countNoLeidas por debajo de 0", async () => {
    // Situación de edge case: se llama marcarLeida sobre una ya leída
    const items = [makeNotif({ id: "n-1", leida: true })];

    let callCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const isUpdate = callCount > 1;
      return {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: (v: unknown) => unknown) =>
          Promise.resolve({
            data: isUpdate ? null : items,
            error: null,
          }).then(onfulfilled),
      };
    });

    const { result } = renderHook(() => useNotificacionesDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.countNoLeidas).toBe(0);

    await act(async () => {
      await result.current.marcarLeida("n-1");
    });

    // Math.max(0, 0 - 1) = 0
    expect(result.current.countNoLeidas).toBe(0);
  });

  // ── marcarTodasLeidas ──────────────────────────────────────────────────────

  it("marcarTodasLeidas pone todas a leida=true y countNoLeidas=0", async () => {
    const items = [
      makeNotif({ id: "n-1", leida: false }),
      makeNotif({ id: "n-2", leida: false }),
      makeNotif({ id: "n-3", leida: false }),
    ];

    let callCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const isUpdate = callCount > 1;
      return {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: (v: unknown) => unknown) =>
          Promise.resolve({
            data: isUpdate ? null : items,
            error: null,
          }).then(onfulfilled),
      };
    });

    const { result } = renderHook(() => useNotificacionesDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.countNoLeidas).toBe(3);

    await act(async () => {
      await result.current.marcarTodasLeidas();
    });

    expect(result.current.countNoLeidas).toBe(0);
    result.current.notificaciones.forEach((n) => {
      expect(n.leida).toBe(true);
    });
  });

  // ── eliminarNotificacion ───────────────────────────────────────────────────

  it("eliminarNotificacion quita la notificación de la lista y decrementa countNoLeidas si no estaba leída", async () => {
    const items = [
      makeNotif({ id: "n-1", leida: false }),
      makeNotif({ id: "n-2", leida: true }),
    ];

    let callCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const isDelete = callCount > 1;
      return {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: (v: unknown) => unknown) =>
          Promise.resolve({
            data: isDelete ? null : items,
            error: null,
          }).then(onfulfilled),
      };
    });

    const { result } = renderHook(() => useNotificacionesDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notificaciones).toHaveLength(2);
    expect(result.current.countNoLeidas).toBe(1);

    await act(async () => {
      await result.current.eliminarNotificacion("n-1");
    });

    expect(result.current.notificaciones).toHaveLength(1);
    expect(result.current.notificaciones.find((n) => n.id === "n-1")).toBeUndefined();
    expect(result.current.countNoLeidas).toBe(0);
  });

  it("eliminar una alerta diaria de Facturas NO la borra (sus € siguen en «Puedes ahorrar»): se quita de la campana", async () => {
    const alerta = makeNotif({
      id: "a-1",
      tipo: "facturas_precio_mejor",
      referencia_tipo: "facturas_alerta",
      clave: "precio_mejor:1:kg:2:3",
      datos: { ahorro: 117, campana: true, enlace: "?tab=compras" },
    });
    const llamadas: { op: string; valor?: unknown; id?: unknown }[] = [];
    let callCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const lectura = callCount === 1;
      const b: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        delete: vi.fn(() => (llamadas.push({ op: "delete" }), b)),
        update: vi.fn((valor: unknown) => (llamadas.push({ op: "update", valor }), b)),
        eq: vi.fn((_c: string, id: unknown) => (llamadas.push({ op: "eq", id }), b)),
        then: (onfulfilled: (v: unknown) => unknown) => Promise.resolve({ data: lectura ? [alerta] : null, error: null }).then(onfulfilled),
      };
      return b;
    });

    const { result } = renderHook(() => useNotificacionesDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.eliminarNotificacion("a-1");
    });

    expect(result.current.notificaciones).toHaveLength(0);
    expect(llamadas.some((l) => l.op === "delete")).toBe(false);
    expect(llamadas).toContainEqual({ op: "update", valor: { leida: true, datos: { ahorro: 117, campana: false, enlace: "?tab=compras" } } });
    expect(llamadas).toContainEqual({ op: "eq", id: "a-1" });
  });

  it("eliminarNotificacion no cambia countNoLeidas si la notificación ya estaba leída", async () => {
    const items = [makeNotif({ id: "n-1", leida: true })];

    let callCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const isDelete = callCount > 1;
      return {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: (v: unknown) => unknown) =>
          Promise.resolve({
            data: isDelete ? null : items,
            error: null,
          }).then(onfulfilled),
      };
    });

    const { result } = renderHook(() => useNotificacionesDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.countNoLeidas).toBe(0);

    await act(async () => {
      await result.current.eliminarNotificacion("n-1");
    });

    expect(result.current.notificaciones).toHaveLength(0);
    expect(result.current.countNoLeidas).toBe(0);
  });

  it("eliminarNotificacion revierte la lista si Supabase devuelve error", async () => {
    const items = [makeNotif({ id: "n-1", leida: false })];

    let callCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const isDelete = callCount === 2;
      return {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: (v: unknown) => unknown) =>
          Promise.resolve(
            isDelete
              ? { data: null, error: { message: "delete failed" } }
              : { data: items, error: null }
          ).then(onfulfilled),
      };
    });

    const { result } = renderHook(() => useNotificacionesDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.eliminarNotificacion("n-1");
    });

    // Tras el error, fetchNotificaciones() vuelve a traer la notificación
    await waitFor(() =>
      expect(result.current.notificaciones.find((n) => n.id === "n-1")).toBeDefined()
    );
  });

  // ── Realtime ───────────────────────────────────────────────────────────────

  it("suscribe a canal realtime al montar", async () => {
    mockSelectNotifs([]);

    renderHook(() => useNotificacionesDashboard());

    // El nombre lleva un número propio de cada suscripción (ver «dos campanas» más abajo).
    await waitFor(() => {
      expect(supabase.channel).toHaveBeenCalledWith(expect.stringMatching(/^notificaciones_realtime-\d+$/));
    });
  });

  it("desuscribe del canal al desmontar", async () => {
    mockSelectNotifs([]);

    const { unmount } = renderHook(() => useNotificacionesDashboard());
    await waitFor(() => expect(supabase.channel).toHaveBeenCalled());

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  it("una inserción realtime agrega la notificación al inicio e incrementa countNoLeidas", async () => {
    const initialItems = [makeNotif({ id: "n-1", leida: false })];

    // Guardamos el callback del realtime para simularlo después
    let realtimeCallback: ((payload: unknown) => void) | null = null;

    const channelMock = {
      on: vi.fn().mockImplementation((_event, _filter, callback) => {
        realtimeCallback = callback;
        return channelMock;
      }),
      subscribe: vi.fn().mockReturnThis(),
    };

    (supabase.channel as ReturnType<typeof vi.fn>).mockReturnValue(channelMock);
    mockSelectNotifs(initialItems);

    const { result } = renderHook(() => useNotificacionesDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.countNoLeidas).toBe(1);

    // Simular inserción realtime de nueva notificación
    const nuevaNotif = makeNotif({ id: "n-99", leida: false, titulo: "Urgente!" });
    await act(async () => {
      realtimeCallback?.({ new: nuevaNotif });
    });

    expect(result.current.notificaciones[0].id).toBe("n-99");
    expect(result.current.countNoLeidas).toBe(2);
  });
});

// ─── Realtime: canal propio, relectura al suscribirse, avisos ─────────────────

/**
 * Cada `supabase.from(...)` deja una lectura EN VUELO que el test resuelve cuando quiere
 * (`resolver(i, filas)`), para poder cruzar lecturas con eventos realtime.
 */
function lecturasControladas() {
  const pendientes: Array<(filas: unknown[]) => void> = [];
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
    let resolver: (filas: unknown[]) => void = () => {};
    const respuesta = new Promise<{ data: unknown[]; error: null }>((ok) => {
      resolver = (filas) => ok({ data: filas, error: null });
    });
    pendientes.push(resolver);
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.order = () => b;
    b.limit = () => b;
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => respuesta.then(ok, ko);
    return b;
  });
  return {
    /** Cuántas lecturas se han lanzado. */
    total: () => pendientes.length,
    resolver: (i: number, filas: unknown[]) => pendientes[i](filas),
  };
}

describe("useNotificacionesDashboard · realtime", () => {
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

  it("sondeo cada minuto SOLO con la pestaña a la vista, en silencio y nunca encima de otra lectura", async () => {
    vi.useFakeTimers();
    const lecturas = lecturasControladas();
    const { result, unmount } = renderHook(() => useNotificacionesDashboard());
    await act(async () => lecturas.resolver(0, [makeNotif({ id: "n-1" })]));
    expect(vi.getTimerCount()).toBe(1); // el sondeo

    visibilidad = "hidden";
    act(() => {
      vi.advanceTimersByTime(INTERVALO_SONDEO_MS * 3);
    });
    expect(lecturas.total()).toBe(1);

    visibilidad = "visible";
    act(() => {
      vi.advanceTimersByTime(INTERVALO_SONDEO_MS);
    });
    expect(lecturas.total()).toBe(2);
    expect(result.current.loading).toBe(false);

    // Otro minuto con esa lectura aún en vuelo: se salta.
    act(() => {
      vi.advanceTimersByTime(INTERVALO_SONDEO_MS);
    });
    expect(lecturas.total()).toBe(2);

    await act(async () => lecturas.resolver(1, [makeNotif({ id: "n-2" }), makeNotif({ id: "n-1" })]));
    expect(result.current.notificaciones.map((n) => n.id)).toEqual(["n-2", "n-1"]);
    act(() => {
      vi.advanceTimersByTime(INTERVALO_SONDEO_MS);
    });
    expect(lecturas.total()).toBe(3);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(INTERVALO_SONDEO_MS * 3);
    expect(lecturas.total()).toBe(3);
  });

  it("dos campanas montadas a la vez (Dashboard en móvil) usan canales DISTINTOS", () => {
    mockSelectNotifs([]);

    renderHook(() => useNotificacionesDashboard());
    renderHook(() => useNotificacionesDashboard());

    const nombres = canales.nombres();
    expect(nombres).toHaveLength(2);
    expect(new Set(nombres).size).toBe(2);
    for (const nombre of nombres) expect(nombre.startsWith(`${PREFIJO_CANAL_NOTIFICACIONES}-`)).toBe(true);
  });

  it("al llegar SUBSCRIBED relee EN SILENCIO (sin volver a «cargando») y aplica lo nuevo", async () => {
    const lecturas = lecturasControladas();
    const { result } = renderHook(() => useNotificacionesDashboard());
    await act(async () => lecturas.resolver(0, [makeNotif({ id: "n-1" })]));
    expect(result.current.loading).toBe(false);

    act(() => canales.ultimo().estado("SUBSCRIBED"));
    expect(lecturas.total()).toBe(2);
    expect(result.current.loading).toBe(false);

    await act(async () => lecturas.resolver(1, [makeNotif({ id: "n-2" }), makeNotif({ id: "n-1" })]));
    expect(result.current.notificaciones.map((n) => n.id)).toEqual(["n-2", "n-1"]);
    expect(result.current.countNoLeidas).toBe(2);
  });

  it("si se cruzan dos lecturas manda la ÚLTIMA: la del montaje, si responde tarde, no pisa a la de SUBSCRIBED", async () => {
    const lecturas = lecturasControladas();
    const { result } = renderHook(() => useNotificacionesDashboard());

    act(() => canales.ultimo().estado("SUBSCRIBED")); // la del montaje sigue en vuelo
    expect(lecturas.total()).toBe(2);

    await act(async () => lecturas.resolver(1, [makeNotif({ id: "nueva" })]));
    await act(async () => lecturas.resolver(0, [makeNotif({ id: "vieja" })]));

    expect(result.current.notificaciones.map((n) => n.id)).toEqual(["nueva"]);
    expect(result.current.loading).toBe(false);
  });

  it("una notificación que ya trajo la relectura y TAMBIÉN llega por realtime no se pinta dos veces ni suma dos", async () => {
    const lecturas = lecturasControladas();
    const { result } = renderHook(() => useNotificacionesDashboard());
    await act(async () => lecturas.resolver(0, []));

    act(() => canales.ultimo().estado("SUBSCRIBED"));
    const n99 = makeNotif({ id: "n-99" });
    await act(async () => lecturas.resolver(1, [n99]));
    act(() => canales.ultimo().cambio({ eventType: "INSERT", new: n99 }));

    expect(result.current.notificaciones.map((n) => n.id)).toEqual(["n-99"]);
    expect(result.current.countNoLeidas).toBe(1);
  });

  it("una notificación que llega por realtime MIENTRAS se relee no se pierde al aplicar la relectura", async () => {
    const lecturas = lecturasControladas();
    const { result } = renderHook(() => useNotificacionesDashboard());
    await act(async () => lecturas.resolver(0, [makeNotif({ id: "n-1" })]));

    act(() => canales.ultimo().estado("SUBSCRIBED")); // relectura en vuelo…
    act(() => canales.ultimo().cambio({ eventType: "INSERT", new: makeNotif({ id: "n-99" }) })); // …y llega una nueva
    expect(result.current.notificaciones.map((n) => n.id)).toEqual(["n-99", "n-1"]);

    // La relectura se hizo justo antes de que se insertara: no la trae.
    await act(async () => lecturas.resolver(1, [makeNotif({ id: "n-1" })]));

    expect(result.current.notificaciones.map((n) => n.id)).toEqual(["n-99", "n-1"]);
    expect(result.current.countNoLeidas).toBe(2);
  });

  it("avisa por consola UNA vez: el `system` de error del servidor (tabla sin publicar) y luego los fallos del canal", async () => {
    mockSelectNotifs([]);
    renderHook(() => useNotificacionesDashboard());
    const canal = canales.ultimo();
    expect(canal.alEstado).toBeTypeOf("function");

    act(() => canal.estado("SUBSCRIBED"));
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

  it("al desmontar quita SU canal y el CLOSED de esa salida no avisa", () => {
    mockSelectNotifs([]);
    const { unmount } = renderHook(() => useNotificacionesDashboard());
    const canal = canales.ultimo();

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalledWith(canal);

    // Lo que hace realtime-js cuando el servidor confirma la salida.
    canal.estado("CLOSED");
    expect(warn).not.toHaveBeenCalled();
  });
});
