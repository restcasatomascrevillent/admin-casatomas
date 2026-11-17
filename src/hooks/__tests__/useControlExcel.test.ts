import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: h.invoke } } }));

const { ErrorControlExcel, pedirControlExcel } = await import("../useControlExcel");
const { esErrorTecnico } = await import("@/lib/mensaje-usuario");

const errorHttp = (status: number, cuerpo: unknown) => ({ name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { status, json: async () => cuerpo } });
const fallo = async () => pedirControlExcel({ accion: "leer" }).then(() => { throw new Error("no falló"); }, (e) => e as InstanceType<typeof ErrorControlExcel>);

beforeEach(() => vi.clearAllMocks());

describe("pedirControlExcel", () => {
  it("devuelve el estado (o el «no disponible») que da la función", async () => {
    h.invoke.mockResolvedValueOnce({ data: { ok: true, disponible: false, motivo: "sin_config", mensaje: "x", cliente: "Casa Tomás" }, error: null });
    await expect(pedirControlExcel({ accion: "leer" })).resolves.toMatchObject({ disponible: false, motivo: "sin_config" });
    expect(h.invoke).toHaveBeenCalledWith("control-excel", { body: { accion: "leer" } });
  });

  it("los errores de la función llegan con su texto y su código (y se pueden enseñar tal cual)", async () => {
    h.invoke.mockResolvedValueOnce({ data: null, error: errorHttp(409, { ok: false, error: "conflicto", mensaje: "El Excel ha cambiado desde que lo cargaste." }) });
    const conflicto = await fallo();
    expect(conflicto).toBeInstanceOf(ErrorControlExcel);
    expect(conflicto).toMatchObject({ message: "El Excel ha cambiado desde que lo cargaste.", codigo: "conflicto", estado: 409, hayQueRecargar: true });
    expect(esErrorTecnico(conflicto)).toBe(false);

    h.invoke.mockResolvedValueOnce({ data: null, error: errorHttp(400, { ok: false, error: "datos_invalidos", mensaje: "Elige «Tipo de cobro»." }) });
    expect(await fallo()).toMatchObject({ codigo: "datos_invalidos", hayQueRecargar: false });
    h.invoke.mockResolvedValueOnce({ data: null, error: errorHttp(409, { ok: false, error: "fila_ajena", mensaje: "Ese movimiento ya no está en esa fila." }) });
    expect((await fallo()).hayQueRecargar).toBe(true);
  });

  it("sin cuerpo útil, un texto llano según el caso (nunca la jerga de la librería)", async () => {
    const casos: Array<[unknown, RegExp]> = [
      [{ name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" }, /¿está desplegada en este proyecto\?/],
      [errorHttp(401, { success: false, error: "Se requiere un usuario autenticado" }), /sesión ha caducado/],
      [errorHttp(403, { success: false, error: "No tienes permiso" }), /Solo un super admin/],
      [errorHttp(404, null), /no está desplegada/],
      [errorHttp(500, null), /No se pudo completar la operación/],
    ];
    for (const [error, texto] of casos) {
      h.invoke.mockResolvedValueOnce({ data: null, error });
      const e = await fallo();
      expect(e.message).toMatch(texto);
      expect(e.message).not.toMatch(/non-2xx|Edge Function returned/);
    }
    h.invoke.mockResolvedValueOnce({ data: { cualquier: "cosa" }, error: null });
    expect((await fallo()).message).toMatch(/respuesta inesperada/);
  });
});
