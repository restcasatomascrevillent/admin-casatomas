import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCambioContrasena, type CambioContrasenaDeps } from "./handler";

const ACTUAL = "Actual-secreta-123";
const NUEVA = "Nueva-secreta-456";
let deps: CambioContrasenaDeps;

const pedir = (body: unknown, token: string | null = "jwt-del-usuario") =>
  handleCambioContrasena(
    new Request("https://e.test/cambiar-mi-contrasena", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    deps,
  );
const cuerpo = async (r: Response) => ({ status: r.status, ...(await r.json()) });

beforeEach(() => {
  deps = {
    identificar: vi.fn().mockResolvedValue({ id: "yo", email: "yo@casatomas.test" }),
    iniciar: vi.fn().mockResolvedValue({ id: "intento-1", permitido: true }),
    finalizar: vi.fn().mockResolvedValue(undefined),
    verificar: vi.fn().mockResolvedValue({ resultado: "correcta", id: "yo" }),
    actualizar: vi.fn().mockResolvedValue({ error: null }),
  };
});

describe("cambiar-mi-contrasena", () => {
  it("cambia la contraseña con el JWT del usuario tras comprobar la actual y cierra el intento", async () => {
    expect(await cuerpo(await pedir({ actual: ACTUAL, nueva: NUEVA }))).toEqual({ status: 200, success: true });
    expect(deps.verificar).toHaveBeenCalledWith("yo@casatomas.test", ACTUAL);
    expect(deps.actualizar).toHaveBeenCalledWith("yo", "jwt-del-usuario", NUEVA, ACTUAL);
    expect(deps.finalizar).toHaveBeenCalledWith("intento-1", "yo", "correcto");
    // El orden importa: límite antes de comprobar, comprobar antes de cambiar.
    const orden = (f: unknown) => vi.mocked(f as () => void).mock.invocationCallOrder[0];
    expect(orden(deps.iniciar)).toBeLessThan(orden(deps.verificar));
    expect(orden(deps.verificar)).toBeLessThan(orden(deps.actualizar));
  });

  it("sin sesión o con un JWT no válido no hace nada", async () => {
    expect((await cuerpo(await pedir({ actual: ACTUAL, nueva: NUEVA }, null))).codigo).toBe("sesion_no_valida");
    vi.mocked(deps.identificar).mockResolvedValue(null);
    const r = await cuerpo(await pedir({ actual: ACTUAL, nueva: NUEVA }));
    expect([r.status, r.codigo]).toEqual([401, "sesion_no_valida"]);
    expect(deps.iniciar).not.toHaveBeenCalled();
    expect(deps.actualizar).not.toHaveBeenCalled();
  });

  it.each([
    [{ actual: "", nueva: NUEVA }, "falta_actual"],
    [{ actual: ACTUAL, nueva: "corta" }, "contrasena_corta"],
    [{ actual: ACTUAL, nueva: "x".repeat(73) }, "contrasena_larga"],
    [{ actual: ACTUAL, nueva: "ñ".repeat(37) }, "contrasena_larga"], // 74 bytes en UTF-8
    [{ actual: ACTUAL, nueva: ACTUAL }, "misma_contrasena"],
    ["no es json", "peticion_invalida"],
  ])("rechaza %j (%s) sin gastar intentos ni tocar Auth", async (body, codigo) => {
    const r = await cuerpo(await pedir(body));
    expect([r.status, r.codigo]).toEqual([400, codigo]);
    expect(r.error).toEqual(expect.any(String));
    expect(deps.iniciar).not.toHaveBeenCalled();
    expect(deps.verificar).not.toHaveBeenCalled();
  });

  it("aplica el límite antes de comprobar la contraseña", async () => {
    vi.mocked(deps.iniciar).mockResolvedValue({ id: "intento-1", permitido: false, motivo: "cuenta" });
    const r = await cuerpo(await pedir({ actual: ACTUAL, nueva: NUEVA }));
    expect([r.status, r.codigo]).toEqual([429, "demasiados_intentos"]);
    expect(r.error).toMatch(/Demasiados intentos/);
    expect(deps.verificar).not.toHaveBeenCalled();
  });

  it("si no se puede registrar el intento no comprueba nada (fail-closed)", async () => {
    vi.mocked(deps.iniciar).mockRejectedValue(new Error("db"));
    expect((await pedir({ actual: ACTUAL, nueva: NUEVA })).status).toBe(503);
    expect(deps.verificar).not.toHaveBeenCalled();
  });

  it("contraseña actual incorrecta (o de otra cuenta): no cambia nada y lo registra", async () => {
    vi.mocked(deps.verificar).mockResolvedValue({ resultado: "incorrecta" });
    let r = await cuerpo(await pedir({ actual: ACTUAL, nueva: NUEVA }));
    expect([r.status, r.codigo, r.error]).toEqual([400, "contrasena_actual_incorrecta", "La contraseña actual no es correcta."]);
    vi.mocked(deps.verificar).mockResolvedValue({ resultado: "correcta", id: "otra-cuenta" });
    r = await cuerpo(await pedir({ actual: ACTUAL, nueva: NUEVA }));
    expect(r.codigo).toBe("contrasena_actual_incorrecta");
    expect(deps.actualizar).not.toHaveBeenCalled();
    expect(deps.finalizar).toHaveBeenCalledWith("intento-1", "yo", "contrasena_actual_incorrecta");
  });

  it("Auth limitando o caído: no cambia nada", async () => {
    vi.mocked(deps.verificar).mockResolvedValue({ resultado: "limite" });
    expect((await cuerpo(await pedir({ actual: ACTUAL, nueva: NUEVA }))).codigo).toBe("demasiados_intentos");
    vi.mocked(deps.verificar).mockRejectedValue(new Error("auth"));
    expect((await pedir({ actual: ACTUAL, nueva: NUEVA })).status).toBe(503);
    expect(deps.actualizar).not.toHaveBeenCalled();
    expect(deps.finalizar).toHaveBeenLastCalledWith("intento-1", "yo", "error_servicio");
  });

  it.each([
    ["same_password", 400, "misma_contrasena", "contrasena_rechazada"],
    ["weak_password", 400, "contrasena_debil", "contrasena_rechazada"],
    ["reauthentication_needed", 400, "reautenticacion_necesaria", "contrasena_rechazada"],
    ["current_password_mismatch", 400, "contrasena_actual_incorrecta", "contrasena_actual_incorrecta"],
    [undefined, 502, "error_servicio", "error_servicio"],
  ])("Auth rechaza la nueva (%s)", async (code, status, codigo, resultado) => {
    vi.mocked(deps.actualizar).mockResolvedValue({ error: { code, status: code ? 422 : 500 } });
    const r = await cuerpo(await pedir({ actual: ACTUAL, nueva: NUEVA }));
    expect([r.status, r.codigo]).toEqual([status, codigo]);
    expect(deps.finalizar).toHaveBeenCalledWith("intento-1", "yo", resultado);
  });

  it("si el cambio se hizo pero no se pudo cerrar el intento, no dice que ha fallado", async () => {
    vi.mocked(deps.finalizar).mockRejectedValue(new Error("db"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await pedir({ actual: ACTUAL, nueva: NUEVA })).status).toBe(200);
    error.mockRestore();
  });

  it("nunca devuelve ni escribe en el log ni en el registro las contraseñas", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(deps.finalizar).mockRejectedValueOnce(new Error("db"));
    const textos: string[] = [];
    for (const variante of [
      () => vi.mocked(deps.verificar).mockResolvedValue({ resultado: "incorrecta" }),
      () => vi.mocked(deps.verificar).mockResolvedValue({ resultado: "correcta", id: "yo" }),
      () => vi.mocked(deps.actualizar).mockResolvedValue({ error: { code: "weak_password", status: 422 } }),
    ]) {
      variante();
      textos.push(await (await pedir({ actual: ACTUAL, nueva: NUEVA })).text());
    }
    const registrado = JSON.stringify([
      textos,
      vi.mocked(deps.iniciar).mock.calls,
      vi.mocked(deps.finalizar).mock.calls,
      log.mock.calls,
      error.mock.calls,
    ]);
    expect(registrado).not.toContain(ACTUAL);
    expect(registrado).not.toContain(NUEVA);
    log.mockRestore();
    error.mockRestore();
  });
});
