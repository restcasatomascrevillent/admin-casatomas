import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ in: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/audit-version", () => ({
  completeAuditEnabled: async () => true,
}));
vi.mock("@/integrations/supabase/client", () => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "order", "gte", "lt", "ilike"])
    query[method] = () => query;
  query.in = (...args: unknown[]) => {
    mocks.in(...args);
    return query;
  };
  query.eq = (...args: unknown[]) => {
    mocks.eq(...args);
    return query;
  };
  query.range = query.limit = async () => ({ data: [], count: 0, error: null });
  return {
    supabase: {
      from: () => query,
      rpc: async () => ({ data: [{ tabla: "Platos" }], error: null }),
    },
  };
});
import { useAuditLog, useAuditLogAgrupado } from "../useAuditLog";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("consulta de filtros de auditoría", () => {
  it("filtra la familia de cambios y excluye el servidor antes de paginar", async () => {
    const { result } = renderHook(() =>
      useAuditLog({ accion: "grupo_cambios", origen: "sin_servidor" }, 0),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.in).toHaveBeenCalledWith("accion", [
      "crear",
      "actualizar",
      "eliminar",
    ]);
    expect(mocks.in).toHaveBeenCalledWith("actor_origin", [
      "usuario",
      "intento",
      "historico",
    ]);
  });
  it("aplica el mismo filtro de IA y origen en las vistas por día y mes", async () => {
    const { result } = renderHook(() =>
      useAuditLogAgrupado({ accion: "grupo_ia", origen: "sin_servidor" }, 3),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.in).toHaveBeenCalledWith("tipo_evento", [
      "consulta_ia",
      "regeneracion_ia",
      "crear_chat_ia",
      "eliminar_chat_ia",
      "mensaje_ia",
    ]);
    expect(mocks.in).toHaveBeenCalledWith("actor_origin", [
      "usuario",
      "intento",
      "historico",
    ]);
  });
});
