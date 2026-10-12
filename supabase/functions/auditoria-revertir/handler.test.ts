import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleReversion, type ReversionDependencies } from "./handler";
const event = "00000000-0000-4000-8000-000000000001";
let deps: ReversionDependencies;
const request = (body: object) =>
  new Request("https://example.test", {
    method: "POST",
    headers: { Authorization: "Bearer real-token" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  deps = {
    identify: vi.fn().mockResolvedValue({ id: "admin" }),
    isSuperAdmin: vi.fn().mockResolvedValue(true),
    beginValidation: vi.fn().mockResolvedValue(true),
    verifyPassword: vi.fn().mockResolvedValue({ id: "admin" }),
    revert: vi.fn().mockResolvedValue({ success: true }),
  };
});
describe("validación de reversión", () => {
  it("solo previsualiza sin contraseña, nunca restaura", async () => {
    expect(
      (await handleReversion(request({ evento_id: event }), deps)).status,
    ).toBe(200);
    expect(deps.revert).toHaveBeenCalledWith(event, "admin", false);
    expect(deps.verifyPassword).not.toHaveBeenCalled();
  });
  it("rechaza sesiones falsas y usuarios sin privilegio", async () => {
    vi.mocked(deps.identify).mockResolvedValue(null);
    expect(
      (
        await handleReversion(
          request({ evento_id: event, confirmar: true }),
          deps,
        )
      ).status,
    ).toBe(401);
    expect(deps.revert).not.toHaveBeenCalled();
    vi.mocked(deps.identify).mockResolvedValue({ id: "admin" });
    vi.mocked(deps.isSuperAdmin).mockResolvedValue(false);
    expect(
      (await handleReversion(request({ evento_id: event }), deps)).status,
    ).toBe(403);
  });
  it("no permite contraseña incorrecta ni validar con la cuenta de otro superadmin", async () => {
    vi.mocked(deps.verifyPassword).mockResolvedValue(null);
    expect(
      (
        await handleReversion(
          request({
            evento_id: event,
            confirmar: true,
            email: "admin@test.local",
            password: "wrong",
          }),
          deps,
        )
      ).status,
    ).toBe(403);
    expect(deps.revert).not.toHaveBeenCalled();
    vi.mocked(deps.verifyPassword).mockResolvedValue({ id: "another-admin" });
    expect(
      (
        await handleReversion(
          request({
            evento_id: event,
            confirmar: true,
            email: "other@test.local",
            password: "pass",
          }),
          deps,
        )
      ).status,
    ).toBe(403);
    expect(deps.revert).not.toHaveBeenCalled();
  });
  it("aplica el límite antes de comprobar la contraseña", async () => {
    vi.mocked(deps.beginValidation).mockResolvedValue(false);
    expect(
      (
        await handleReversion(
          request({
            evento_id: event,
            confirmar: true,
            email: "admin@test.local",
            password: "pass",
          }),
          deps,
        )
      ).status,
    ).toBe(429);
    expect(deps.verifyPassword).not.toHaveBeenCalled();
    expect(deps.revert).not.toHaveBeenCalled();
  });
  it("restaura únicamente después de validar la misma cuenta y revisar otra vez su rol", async () => {
    expect(
      (
        await handleReversion(
          request({
            evento_id: event,
            confirmar: true,
            email: "admin@test.local",
            password: "pass",
          }),
          deps,
        )
      ).status,
    ).toBe(200);
    expect(deps.revert).toHaveBeenCalledWith(event, "admin", true);
    expect(deps.isSuperAdmin).toHaveBeenCalledTimes(2);
  });
});
