// @vitest-environment node
/**
 * Edge Function instagram-estado (antes api/instagram-estado.ts de Vercel):
 * «Comprobar conexión» sin red y sin devolver secretos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarEstado } from "../estado.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { olvidarTokenDrive } from "../../_shared/google-drive.ts";
import { olvidarCarpetasDrive } from "../../_shared/instagram/drive.ts";
import {
  depsRapidas,
  driveFalso,
  ENV_DRIVE,
  ENV_META,
  ENV_SB,
  falso,
  GRAPH,
  JWT,
  peticion,
  REFRESH_GOOGLE,
  resp,
  SECRETO_APP,
  SECRETO_GOOGLE,
  TOKEN_GOOGLE,
  TOKEN_META,
  type Manejador,
} from "../../_shared/instagram/__tests__/simulacion.ts";

beforeEach(() => {
  olvidarSecretos();
  olvidarTokenDrive();
  olvidarCarpetasDrive();
});
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

  describe("Google Drive", () => {
    const estado = async (env: Record<string, string>, drive?: Manejador) => {
      const { f, llamadas } = falso({ drive });
      const r = await manejarEstado(peticion(null, `Bearer ${JWT}`, "GET"), { env, fetch: f, ...depsRapidas });
      const texto = await r.text();
      return { r, texto, j: JSON.parse(texto), llamadas };
    };
    const nombre = (j: { drive: { comprobaciones: Array<{ nombre: string }> } }, n: string) => j.drive.comprobaciones.find((c) => c.nombre === n) as { estado: string; detalle: string; comoArreglarlo?: string };

    it("todo bien: secretos, alcance completo y carpeta visible y escribible, sin enseñar el token ni los secretos", async () => {
      const { j, texto, llamadas } = await estado({ ...ENV_SB, ...ENV_DRIVE }, driveFalso().m);
      expect(j.drive).toMatchObject({ ok: true, alcance: "completo", alcances: ["drive"], carpeta: { nombre: "marketing", escribible: true }, avisos: [] });
      expect(nombre(j, "Escribir en la carpeta").estado).toBe("ok");
      for (const s of [TOKEN_GOOGLE, REFRESH_GOOGLE, SECRETO_GOOGLE]) expect(texto).not.toContain(s);
      // No crea nada en Drive al comprobar.
      expect(llamadas.some((l) => l.metodo === "POST" && l.url.startsWith("https://www.googleapis.com/"))).toBe(false);
    });

    it("TRAMPA drive.file: la carpeta creada a mano no se ve → falla con el «cómo arreglarlo» en castellano llano", async () => {
      const { j } = await estado({ ...ENV_SB, ...ENV_DRIVE }, driveFalso({ alcance: "https://www.googleapis.com/auth/drive.file", raizVisible: false }).m);
      expect(j.drive.ok).toBe(false);
      expect(j.drive.alcances).toEqual(["drive.file"]);
      expect(nombre(j, "Permiso (alcance) del token").estado).toBe("aviso");
      const carpeta = nombre(j, "Carpeta «marketing»");
      expect(carpeta.estado).toBe("falla");
      expect(carpeta.comoArreglarlo).toMatch(/solo ve las carpetas y archivos que ha creado ella.*permiso completo.*GOOGLE_REFRESH_TOKEN.*GOOGLE_DRIVE_MARKETING_FOLDER_ID/);
      expect(j.drive.avisos.join(" ")).toMatch(/arrastres a mano/);
    });

    it("drive.file con una carpeta que sí ve: funciona, pero avisa de que no salen las fotos arrastradas a mano", async () => {
      const { j } = await estado({ ...ENV_SB, ...ENV_DRIVE }, driveFalso({ alcance: "https://www.googleapis.com/auth/drive.file" }).m);
      expect(j.drive.ok).toBe(true);
      expect(j.drive.avisos.join(" ")).toMatch(/solo ve las fotos que se suben desde aquí/);
    });

    it("carpeta de solo lectura → falla «Escribir en la carpeta»", async () => {
      const { j } = await estado({ ...ENV_SB, ...ENV_DRIVE }, driveFalso({ escribible: false }).m);
      expect(j.drive.ok).toBe(false);
      expect(nombre(j, "Escribir en la carpeta")).toMatchObject({ estado: "falla", comoArreglarlo: expect.stringMatching(/Editor/) });
    });

    it("sin el secreto de la carpeta: lo dice (sin llamar a Google) y no cambia el «ok» de Instagram", async () => {
      const d = driveFalso();
      const { j } = await estado({ ...ENV_SB, ...ENV_DRIVE, GOOGLE_DRIVE_MARKETING_FOLDER_ID: "" }, d.m);
      expect(j.drive.ok).toBe(false);
      expect(nombre(j, "Secreto GOOGLE_DRIVE_MARKETING_FOLDER_ID")).toMatchObject({ estado: "falla", comoArreglarlo: expect.stringMatching(/--project-ref sfonaclosuafvlhutkon/) });
      expect(d.peticionesToken).toHaveLength(0);
    });

    it("token rechazado por Google → falla «Token de Google» con qué revisar", async () => {
      const { j, texto } = await estado({ ...ENV_SB, ...ENV_DRIVE }, driveFalso({ tokenFalla: true }).m);
      expect(nombre(j, "Token de Google")).toMatchObject({ estado: "falla", detalle: expect.stringMatching(/invalid_client/) });
      expect(texto).not.toContain(SECRETO_GOOGLE);
    });
  });
});
