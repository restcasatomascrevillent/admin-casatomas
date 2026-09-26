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
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner");

import { supabase, resetSupabaseMocks } from "@/integrations/supabase/client";
import { useNotificacionesDashboard } from "@/hooks/useNotificacionesDashboard";

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

    await waitFor(() => {
      expect(supabase.channel).toHaveBeenCalledWith("notificaciones_realtime");
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
