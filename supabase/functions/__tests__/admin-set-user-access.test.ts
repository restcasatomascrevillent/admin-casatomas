import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleUserAccess,
  type UserAccessDependencies,
} from "../admin-set-user-access/handler";

const actor = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";
let deps: UserAccessDependencies;
beforeEach(() => {
  deps = {
    currentUser: vi.fn().mockResolvedValue({ id: actor }),
    isSuperAdmin: vi.fn().mockResolvedValue(true),
    targetUser: vi.fn().mockResolvedValue({ id: target, isSuperAdmin: false }),
    setBlocked: vi.fn().mockResolvedValue(undefined),
  };
});
const call = (
  body: unknown = { userId: target, blocked: true },
  method = "POST",
) =>
  handleUserAccess(
    new Request("https://example.test/access", {
      method,
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    }),
    deps,
  );

describe("bloqueo reversible de acceso", () => {
  it.each([true, false])(
    "solo cambia el bloqueo solicitado (%s)",
    async (blocked) => {
      const result = await call({ userId: target, blocked });
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({
        success: true,
        access_blocked: blocked,
      });
      expect(deps.setBlocked).toHaveBeenCalledWith(actor, target, blocked);
    },
  );
  it("rechaza sesiones inválidas y administradores normales", async () => {
    vi.mocked(deps.currentUser).mockResolvedValueOnce(null);
    expect((await call()).status).toBe(401);
    vi.mocked(deps.isSuperAdmin).mockResolvedValueOnce(false);
    expect((await call()).status).toBe(403);
    expect(deps.setBlocked).not.toHaveBeenCalled();
  });
  it("no cambia nada si falla la autorización o la consulta del objetivo", async () => {
    vi.mocked(deps.isSuperAdmin).mockRejectedValueOnce(
      new Error("database offline"),
    );
    expect((await call()).status).toBe(503);
    vi.mocked(deps.targetUser).mockRejectedValueOnce(
      new Error("database offline"),
    );
    expect((await call()).status).toBe(503);
    expect(deps.setBlocked).not.toHaveBeenCalled();
  });
  it("protege la propia cuenta y a los superadmins", async () => {
    expect((await call({ userId: actor, blocked: true })).status).toBe(400);
    vi.mocked(deps.targetUser).mockResolvedValue({
      id: target,
      isSuperAdmin: true,
    });
    expect((await call()).status).toBe(400);
    expect(deps.setBlocked).not.toHaveBeenCalled();
    expect((await call({ userId: target, blocked: false })).status).toBe(200);
  });
  it("rechaza valores ambiguos, usuarios inexistentes y métodos incorrectos", async () => {
    expect((await call({ userId: target, blocked: "false" })).status).toBe(400);
    expect((await call({ userId: "bad", blocked: true })).status).toBe(400);
    vi.mocked(deps.targetUser).mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect((await call({}, "GET")).status).toBe(405);
    expect(deps.setBlocked).not.toHaveBeenCalled();
  });
  it("no comunica éxito cuando Auth no confirmó la modificación", async () => {
    vi.mocked(deps.setBlocked).mockRejectedValueOnce(new Error("Auth offline"));
    expect((await call()).status).toBe(503);
  });
});
