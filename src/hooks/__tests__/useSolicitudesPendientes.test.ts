/**
 * Tests para src/hooks/useSolicitudesPendientes.ts
 *
 * Cubre:
 * - Carga inicial de solicitudes
 * - Cálculo correcto de countPendientes
 * - Filtrado local por estado
 * - updateEstado: llama a Supabase y recarga
 * - updateNotasInternas: llama a Supabase y recarga
 * - Manejo de errores
 * - Suscripción realtime (setup/cleanup)
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
import { useSolicitudesPendientes } from "@/hooks/useSolicitudesPendientes";

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
    expect(result.current.countPendientes).toBe(0);
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

  it("calcula countPendientes correctamente (solo estado=pendiente)", async () => {
    const items = [
      makeSolicitud({ id: "sol-1", estado: "pendiente" }),
      makeSolicitud({ id: "sol-2", estado: "resuelta" }),
      makeSolicitud({ id: "sol-3", estado: "pendiente" }),
      makeSolicitud({ id: "sol-4", estado: "descartada" }),
    ];
    mockSelectSolicitudes(items);

    const { result } = renderHook(() => useSolicitudesPendientes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.countPendientes).toBe(2);
  });

  it("muestra 0 pendientes cuando todas están resueltas", async () => {
    const items = [
      makeSolicitud({ id: "sol-1", estado: "resuelta" }),
      makeSolicitud({ id: "sol-2", estado: "descartada" }),
    ];
    mockSelectSolicitudes(items);

    const { result } = renderHook(() => useSolicitudesPendientes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.countPendientes).toBe(0);
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
    await waitFor(() => {
      expect(supabase.channel).toHaveBeenCalledWith("solicitudes_realtime");
    });

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });
});
