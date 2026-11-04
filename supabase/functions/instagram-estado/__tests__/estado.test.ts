// @vitest-environment node
/**
 * Edge Function instagram-estado (antes api/instagram-estado.ts de Vercel):
 * «Comprobar conexión» sin red y sin devolver secretos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarEstado } from "../estado.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { depsRapidas, ENV_META, ENV_SB, falso, GRAPH, JWT, peticion, resp, SECRETO_APP, TOKEN_META, type Manejador } from "../../_shared/instagram/__tests__/simulacion.ts";

beforeEach(() => olvidarSecretos());
afterEach(() => vi.restoreAllMocks());

describe("Edge Function instagram-estado", () => {
  const metaEstado: Manejador = (l) => {
    const ruta = l.url.replace(GRAPH, "");
    if (ruta.startsWith("/me/assigned_instagram_accounts")) return resp(200, { data: [{ id: ENV_META.IG_USER_ID, username: "oficiososia" }] });
    if (ruta.startsWith(`/${ENV_META.IG_USER_ID}?`)) return resp(200, { id: ENV_META.IG_USER_ID, username: "oficiososia", name: "Oficiosos IA", media_count: 3 });
    if (ruta.startsWith(`/${ENV_META.IG_USER_ID}/content_publishing_limit`)) return resp(200, { data: [{ quota_usage: 1, config: { quota_total: 100, quota_duration: 86400 } }] });
    if (ruta.startsWith("/debug_token")) {
      return resp(200, { data: { app_id: "1234567890", type: "SYSTEM_USER", is_valid: true, expires_at: 0, scopes: ["instagram_basic", "instagram_content_publish"] } });
    }
    return undefined;
  };

  it("401 sin token y 403 sin Marketing", async () => {
    expect((await manejarEstado(peticion(null, null, "GET"), { env: ENV_META, fetch: falso().f })).status).toBe(401);
    expect((await manejarEstado(peticion(null, `Bearer ${JWT}`, "GET"), { env: ENV_META, fetch: falso({ permiso: false }).f })).status).toBe(403);
  });

  it("identidad, cuota y método (debug_token con token de app) sin devolver secretos", async () => {
    const { f, llamadas } = falso({ meta: metaEstado });
    const r = await manejarEstado(peticion(null, `Bearer ${JWT}`, "GET"), { env: { ...ENV_META, META_APP_SECRET: SECRETO_APP }, fetch: f, ...depsRapidas });
    expect(r.status).toBe(200);
    const texto = await r.text();
    const j = JSON.parse(texto);
    expect(j).toMatchObject({
      ok: true,
      faltan: [],
      metodoVerificacion: "debug_token_app",
      identidad: { igUserId: ENV_META.IG_USER_ID, username: "oficiososia", coincide: true },
      cuota: { usadas: 1, total: 100, restantes: 99, ventanaHoras: 24 },
      tokenEnmascarado: "…abcd",
      entornoSupabase: "demo",
    });
    expect(texto).not.toContain(TOKEN_META);
    expect(texto).not.toContain(SECRETO_APP);
    // debug_token lleva el token en la URL (lo exige Meta), pero solo hacia graph.facebook.com.
    expect(llamadas.filter((l) => l.url.includes(TOKEN_META)).every((l) => l.url.startsWith(`${GRAPH}/debug_token`))).toBe(true);
  });

  it("sin variables: dice cuáles faltan con «cómo arreglarlo» y no llama a Meta", async () => {
    const meta = vi.fn(() => undefined);
    const { f } = falso({ meta });
    const r = await manejarEstado(peticion(null, `Bearer ${JWT}`, "GET"), { env: ENV_SB, fetch: f });
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(j.faltan).toEqual(["IG_ACCESS_TOKEN", "IG_USER_ID", "META_APP_ID"]);
    expect(j.variables.find((v: { nombre: string }) => v.nombre === "IG_ACCESS_TOKEN").comoArreglarlo).toMatch(/npx supabase secrets set IG_ACCESS_TOKEN=… --project-ref sfonaclosuafvlhutkon/);
    expect(meta).not.toHaveBeenCalled();
  });
});
