// @vitest-environment node
/**
 * Cupo de IA atómico (A8 de la evaluación): se reserva por RPC ANTES de
 * llamar a OpenAI (cuenta también los fallos), con tope por usuario y global.
 * Sin la migración 20261111000000, cuenta como antes.
 */
import { describe, expect, it, vi } from "vitest";
// registrar-uso-ia.ts importa supabase-js por URL (esm.sh), que Node no carga.
vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: vi.fn() }));

import { CUPO_DIARIO_POR_DEFECTO, CUPO_GLOBAL_POR_DEFECTO, cuposDe, reservarCupoIA, respuestaCupo } from "../ia.ts";
import type { Sesion } from "../../_shared/instagram/supabase.ts";

const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const resp = (estado: number, cuerpo: unknown, cab: Record<string, string> = {}) =>
  new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json", ...cab } });

function sesion(manejar: (url: string, init: RequestInit) => Response) {
  const f = vi.fn(async (u: string | URL | Request, init: RequestInit = {}) => manejar(String(u), init));
  const s: Sesion = { usuario: "u1", token: "jwt", sb: { url: SB, clave: "anon" }, fetch: f as unknown as typeof fetch };
  return { s, f };
}

describe("cupo de IA", () => {
  it("manda los dos topes a la RPC y respeta su respuesta", async () => {
    const { s, f } = sesion((url, init) => {
      expect(url).toBe(`${SB}/rest/v1/rpc/instagram_ia_reservar_cupo`);
      expect(JSON.parse(String(init.body))).toEqual({ p_cupo: 5, p_cupo_global: 50 });
      return resp(200, { ok: true, usadas: 3 });
    });
    expect(await reservarCupoIA(s, 5, 50, new Date())).toEqual({ ok: true, usadas: 3 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("agotado por usuario o global → 429 con el motivo", async () => {
    const usuario = await reservarCupoIA(sesion(() => resp(200, { ok: false, motivo: "usuario", cupo: 5 })).s, 5, 50, new Date());
    const global = await reservarCupoIA(sesion(() => resp(200, { ok: false, motivo: "global", cupo: 50 })).s, 5, 50, new Date());
    expect(usuario).toEqual({ ok: false, motivo: "usuario", cupo: 5 });
    expect(global).toEqual({ ok: false, motivo: "global", cupo: 50 });
    const r = respuestaCupo(global as Extract<typeof global, { ok: false }>);
    expect(r.status).toBe(429);
    expect((await r.json()).error).toMatch(/entre todos los usuarios/);
  });

  it("sin la migración, cuenta las sugerencias de hoy como antes", async () => {
    const { s } = sesion((url, init) => {
      if (url.endsWith("instagram_ia_reservar_cupo")) return resp(404, { code: "PGRST202", message: "Could not find the function" });
      expect(init.method).toBe("HEAD");
      return resp(206, null, { "content-range": "0-0/7" });
    });
    expect(await reservarCupoIA(s, 7, 50, new Date())).toEqual({ ok: false, motivo: "usuario", cupo: 7 });
    expect(await reservarCupoIA(s, 8, 50, new Date())).toEqual({ ok: true, usadas: 8 });
  });

  it("topes por defecto y por variable", () => {
    expect(cuposDe({})).toEqual({ cupo: CUPO_DIARIO_POR_DEFECTO, global: CUPO_GLOBAL_POR_DEFECTO });
    expect(cuposDe({ INSTAGRAM_IA_CUPO_DIARIO: "20", INSTAGRAM_IA_CUPO_GLOBAL: "60" })).toEqual({ cupo: 20, global: 60 });
  });
});
