import { describe, expect, it, vi } from "vitest";
import { ejecutarOperacionAuthAuditada } from "../../../supabase/functions/_shared/audit-auth";
import type { SupabaseClient } from "@supabase/supabase-js";

function clientMock(error: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: error ? null : "context-1", error }),
    from: vi.fn().mockReturnValue({ delete: vi.fn().mockReturnValue({ eq }) }),
  };
  return { client: client as unknown as SupabaseClient, rpc: client.rpc, eq };
}

describe("auditoría de operaciones Auth", () => {
  it("identifica el cambio de contraseña antes de llamar a GoTrue", async () => {
    const { client, rpc } = clientMock();
    const execute = vi.fn().mockResolvedValue({ success: true });
    await ejecutarOperacionAuthAuditada(client, "admin-id", "actualizar", { userId: "target" }, execute);
    expect(rpc).toHaveBeenCalledWith("preparar_contexto_auditoria_auth", {
      p_actor_id: "admin-id", p_operacion: "actualizar", p_user_id: "target", p_email: null,
    });
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]);
  });
  it("prepara el actor verificado antes de ejecutar Auth y elimina el contexto", async () => {
    const { client, rpc, eq } = clientMock();
    const execute = vi.fn().mockResolvedValue({ success: true });
    await expect(ejecutarOperacionAuthAuditada(client, "admin-id", "crear", { email: "new@staff.local" }, execute))
      .resolves.toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("preparar_contexto_auditoria_auth", {
      p_actor_id: "admin-id", p_operacion: "crear", p_user_id: null, p_email: "new@staff.local",
    });
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]);
    expect(eq).toHaveBeenCalledWith("id", "context-1");
  });
  it("no modifica usuarios si no puede preparar su identificación", async () => {
    const { client } = clientMock({ message: "rpc unavailable" });
    const execute = vi.fn();
    await expect(ejecutarOperacionAuthAuditada(client, "admin", "eliminar", { userId: "target" }, execute))
      .rejects.toThrow("No se pudo identificar");
    expect(execute).not.toHaveBeenCalled();
  });
  it("limpia el contexto cuando Auth falla y conserva ese error", async () => {
    const { client, eq } = clientMock();
    await expect(ejecutarOperacionAuthAuditada(client, "admin", "eliminar", { userId: "target" },
      async () => { throw new Error("auth failed"); }))
      .rejects.toThrow("auth failed");
    expect(eq).toHaveBeenCalledWith("id", "context-1");
  });
});
