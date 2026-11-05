// @vitest-environment node
/**
 * Edge Function instagram-estado (antes api/instagram-estado.ts de Vercel):
 * «Comprobar conexión» sin red y sin devolver secretos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarEstado } from "../estado.ts";
import { mapearErrorGraph } from "../../_shared/instagram/errores.ts";
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

  it("cuentas por marca: sin secretos propios, las dos en la general; con IG_USER_ID_TOUZA, Touza en la suya (sin tokens en la respuesta)", async () => {
    const a = falso({ meta: metaEstado });
    const r1 = await (await manejarEstado(peticion(null, `Bearer ${JWT}`, "GET"), { env: { ...ENV_META, META_APP_SECRET: SECRETO_APP }, fetch: a.f, ...depsRapidas })).json();
    expect(r1.cuentasPorMarca).toEqual([
      expect.objectContaining({ marca: "casa-tomas", propia: false, igUserId: ENV_META.IG_USER_ID, username: "oficiososia", estado: "ok", variableIgUserId: "IG_USER_ID" }),
      expect.objectContaining({ marca: "touza", propia: false, igUserId: ENV_META.IG_USER_ID, username: "oficiososia", estado: "ok" }),
    ]);
    const TOUZA = "17841400000000077";
    const TOKEN_TOUZA = "EAAGtokenPropioDeTouzaParaPruebas000000000001";
    const metaTouza: Manejador = (l) => {
      if (l.url.replace(GRAPH, "").startsWith(`/${TOUZA}?`)) {
        expect(l.cabeceras.authorization).toBe(`Bearer ${TOKEN_TOUZA}`);
        return resp(200, { id: TOUZA, username: "touza_pruebas" });
      }
      return metaEstado(l);
    };
    const b = falso({ meta: metaTouza });
    const r = await manejarEstado(peticion(null, `Bearer ${JWT}`, "GET"), {
      env: { ...ENV_META, META_APP_SECRET: SECRETO_APP, IG_USER_ID_TOUZA: TOUZA, IG_ACCESS_TOKEN_TOUZA: TOKEN_TOUZA },
      fetch: b.f,
      ...depsRapidas,
    });
    const texto = await r.text();
    const j = JSON.parse(texto);
    expect(j.cuentasPorMarca[1]).toMatchObject({ marca: "touza", propia: true, igUserId: TOUZA, username: "touza_pruebas", variableIgUserId: "IG_USER_ID_TOUZA", variableToken: "IG_ACCESS_TOKEN_TOUZA", estado: "ok" });
    expect(j.cuentasPorMarca[0]).toMatchObject({ marca: "casa-tomas", propia: false, username: "oficiososia" });
    expect(j.variables.find((v: { nombre: string }) => v.nombre === "IG_USER_ID_CASA_TOMAS").detalle).toMatch(/se usa IG_USER_ID/);
    expect(texto).not.toContain(TOKEN_TOUZA);
    expect(texto).not.toContain(TOKEN_META);
  });

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

describe("Meta bloquea la app entera (OAuthException 200 «API access blocked.»)", () => {
  const ARREGLO =
    "Meta ha bloqueado el acceso de la app a la API. Revisa en developers.facebook.com las Acciones requeridas, las alertas y tu cuenta de desarrollador; si sigue, crea una app nueva y cambia META_APP_ID, META_APP_SECRET e IG_ACCESS_TOKEN";
  const bloqueo = () => resp(400, { error: { message: "API access blocked.", type: "OAuthException", code: 200, fbtrace_id: "AbC" } });

  it("el mapeo lo clasifica como «app bloqueada», no reintentable, y no como permisos", () => {
    const e = mapearErrorGraph({ estadoHttp: 400, cuerpo: { error: { message: "API access blocked.", type: "OAuthException", code: 200 } } });
    expect(e.tipo).toBe("app_bloqueada");
    expect(e.reintentable).toBe(false);
    expect(e.comoArreglarlo).toBe(ARREGLO);
    expect(e.message).toMatch(/^Meta ha bloqueado el acceso de la app a la API/);
    expect(e.message).not.toMatch(/faltan permisos/);
    // Otro error 200 sigue siendo de permisos.
    expect(mapearErrorGraph({ estadoHttp: 403, cuerpo: { error: { message: "Permissions error", code: 200 } } }).tipo).toBe("permisos");
  });

  it("«Comprobar» lo detecta y lo dice así (sin hablar de permisos que faltan)", async () => {
    const s = falso({ meta: () => bloqueo() });
    const r = await manejarEstado(peticion(null, `Bearer ${JWT}`, "GET"), { env: { ...ENV_META, META_APP_SECRET: SECRETO_APP }, fetch: s.f, ...depsRapidas });
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.ok).toBe(false);
    const app = b.comprobaciones.find((x: { nombre: string }) => x.nombre === "App de Meta bloqueada");
    expect(app).toMatchObject({ estado: "falla", comoArreglarlo: ARREGLO });
    expect(app.detalle).toMatch(/API access blocked/);
    expect(JSON.stringify(b.comprobaciones)).not.toMatch(/Al token le faltan permisos/);
  });

  it("sin el bloqueo, no aparece", async () => {
    const s = falso({ meta: (l) => (l.url.includes("/me/assigned_instagram_accounts") ? resp(200, { data: [] }) : resp(400, { error: { message: "Invalid", code: 100 } })) });
    const r = await manejarEstado(peticion(null, `Bearer ${JWT}`, "GET"), { env: ENV_META, fetch: s.f, ...depsRapidas });
    const b = await r.json();
    expect(b.comprobaciones.some((x: { nombre: string }) => x.nombre === "App de Meta bloqueada")).toBe(false);
  });
});
