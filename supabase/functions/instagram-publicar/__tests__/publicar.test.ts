// @vitest-environment node
/**
 * Edge Function instagram-publicar (antes api/instagram-publicar.ts de Vercel)
 * sin red: fetch simulado de Supabase y de la Graph API. Autorización
 * (can_write_section('marketing') con el JWT del usuario), dry-run sin
 * media_publish, cuota, 202 «en_proceso», borrado del JPEG, saneado del token
 * y secretos que faltan → mensaje que apunta a los secretos de Supabase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarPublicar } from "../publicar.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { depsRapidas, ENV_META, ENV_SB, falso, FILA_GENERADA, ID, JWT, metaPublicacion, peticion, SB, TOKEN_META } from "../../_shared/instagram/__tests__/simulacion.ts";

beforeEach(() => olvidarSecretos());
afterEach(() => vi.restoreAllMocks());

describe("Edge Function instagram-publicar", () => {
  it("401 sin token y 403 sin Marketing (sin llamar a Meta)", async () => {
    const meta = vi.fn(() => undefined);
    const a = falso({ meta });
    expect((await manejarPublicar(peticion({ id: ID, dryRun: true }, null), { env: ENV_META, fetch: a.f })).status).toBe(401);
    const b = falso({ permiso: false, meta });
    expect((await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: b.f })).status).toBe(403);
    expect(meta).not.toHaveBeenCalled();
  });

  it("503 si faltan variables de Meta, nombrándolas sin valores", async () => {
    const { f } = falso({ fila: FILA_GENERADA });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: { ...ENV_SB, IG_ACCESS_TOKEN: TOKEN_META }, fetch: f });
    expect(r.status).toBe(503);
    const texto = await r.text();
    expect(JSON.parse(texto).faltan).toEqual(["IG_USER_ID", "META_APP_ID"]);
    expect(texto).not.toContain(TOKEN_META);
  });

  it("422 si el caption pasa de 30 hashtags (sin gastar cuota)", async () => {
    const { m, orden } = metaPublicacion();
    const { f } = falso({ fila: FILA_GENERADA, meta: m });
    const caption = Array.from({ length: 31 }, (_, i) => `#h${i}`).join(" ");
    const r = await manejarPublicar(peticion({ id: ID, caption, dryRun: true }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(422);
    expect(orden).toEqual([]);
  });

  it("422 si la URL pública no sirve un JPEG", async () => {
    const { m, orden } = metaPublicacion();
    const { f, fila } = falso({ fila: FILA_GENERADA, meta: m, head: [404, "application/json"] });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(422);
    expect(orden).toEqual([]);
    expect(fila()).toMatchObject({ estado: "error" });
  });

  it("cuota agotada → 429 y no crea contenedor", async () => {
    const { m, orden } = metaPublicacion({ usadas: 100, total: 100 });
    const { f } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ cuota: { usadas: 100, total: 100, restantes: 0 } });
    expect(orden).toEqual(["cuota"]);
  });

  it("dry-run: crea el contenedor, espera FINISHED y NUNCA llama a media_publish", async () => {
    const { m, orden } = metaPublicacion({ estados: ["IN_PROGRESS", "FINISHED"] });
    const { f, llamadas, fila } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, dryRun: true, publicado: false, estado: "prueba_ok", contenedor: { id: "1790000000000001", estado: "FINISHED" }, mediaId: null });
    expect(orden).toEqual(["cuota", "media", "estado:IN_PROGRESS", "estado:FINISHED"]);
    expect(llamadas.some((l) => l.url.includes("media_publish"))).toBe(false);
    // En prueba el JPEG se queda en el bucket: el contenedor necesita la URL.
    expect(llamadas.some((l) => l.metodo === "DELETE")).toBe(false);
    expect(fila()).toMatchObject({ estado: "prueba_ok", contenedor_id: "1790000000000001" });
    const media = llamadas.find((l) => l.url.endsWith("/media"))!;
    const cuerpo = new URLSearchParams(media.cuerpo!);
    expect(cuerpo.get("image_url")).toBe(`${SB}/storage/v1/object/public/instagram/piezas/2026-11/${ID}.jpg`);
    expect(cuerpo.get("caption")).toBe("Hola #casatomas");
    expect(media.cabeceras.authorization).toBe(`Bearer ${TOKEN_META}`);
    expect(media.url).not.toContain("access_token");
  });

  it("publicación real: media_publish solo DESPUÉS de FINISHED, con permalink y fila «publicada»", async () => {
    const { m, orden } = metaPublicacion({ estados: ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"] });
    const { f, fila } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, caption: "Nuevo texto", dryRun: false }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      publicado: true,
      estado: "publicada",
      mediaId: "1800000000000009",
      permalink: "https://www.instagram.com/p/ABC123/",
      cuota: { usadas: 4, total: 100, restantes: 96 },
    });
    expect(orden).toEqual(["cuota", "media", "estado:IN_PROGRESS", "estado:IN_PROGRESS", "estado:FINISHED", "publish", "permalink"]);
    expect(fila()).toMatchObject({ estado: "publicada", media_id: "1800000000000009", permalink: "https://www.instagram.com/p/ABC123/", caption: "Nuevo texto", error: null });
  });

  it("tras publicar de verdad borra el JPEG del bucket con el JWT del usuario (y conserva imagen_ruta)", async () => {
    const { m } = metaPublicacion();
    const { f, llamadas, fila } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(await r.json()).toMatchObject({ publicado: true, imagenEnBucket: false });
    const i = llamadas.findIndex((l) => l.metodo === "DELETE");
    expect(i).toBeGreaterThan(llamadas.findIndex((l) => l.url.endsWith("/media_publish")));
    const borrado = llamadas[i];
    expect(borrado.url).toBe(`${SB}/storage/v1/object/instagram`);
    expect(JSON.parse(borrado.cuerpo!)).toEqual({ prefixes: [`piezas/2026-11/${ID}.jpg`] });
    expect(borrado.cabeceras.authorization).toBe(`Bearer ${JWT}`);
    expect(fila()).toMatchObject({ estado: "publicada", imagen_ruta: `piezas/2026-11/${ID}.jpg`, error: null });
  });

  it("si la RLS no deja borrar el JPEG: sigue publicada, avisa y lo anota en «error»", async () => {
    const { m } = metaPublicacion();
    const { f, fila } = falso({ fila: FILA_GENERADA, meta: m, borrado: [200, []] });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: f, ...depsRapidas });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ publicado: true, imagenEnBucket: true });
    expect(j.avisos.join(" ")).toMatch(/no se pudo borrar el JPEG/);
    expect(fila()).toMatchObject({ estado: "publicada" });
    expect(String(fila()!.error)).toMatch(/^Publicada, pero el JPEG no se pudo borrar/);
  });

  it("un contenedor en ERROR no se publica", async () => {
    const { m, orden } = metaPublicacion({ estados: ["ERROR"] });
    const { f, fila } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(422);
    expect(orden).not.toContain("publish");
    expect(fila()).toMatchObject({ estado: "error" });
  });

  it("story: media_type=STORIES y sin caption", async () => {
    const { m } = metaPublicacion();
    const { f, llamadas } = falso({ fila: { ...FILA_GENERADA, formato: "story" }, meta: m });
    await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: f, ...depsRapidas });
    const cuerpo = new URLSearchParams(llamadas.find((l) => l.url.endsWith("/media"))!.cuerpo!);
    expect(cuerpo.get("media_type")).toBe("STORIES");
    expect(cuerpo.has("caption")).toBe(false);
  });

  it("sin FINISHED dentro del tiempo → 202 «en_proceso» con el contenedor; el reintento con contenedorId no crea otro", async () => {
    let t = 0;
    const ahora = () => (t += 10_000);
    const lento = metaPublicacion({ estados: ["IN_PROGRESS"] });
    const a = falso({ fila: FILA_GENERADA, meta: lento.m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: a.f, ...depsRapidas, ahora, presupuestoMs: 25_000 });
    expect(r.status).toBe(202);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, estado: "en_proceso", contenedor: { id: "1790000000000001", estado: "IN_PROGRESS" }, reintentar: { id: ID, contenedorId: "1790000000000001", dryRun: false } });
    expect(lento.orden).not.toContain("publish");
    expect(a.fila()).toMatchObject({ contenedor_id: "1790000000000001", estado: "generada" });

    const listo = metaPublicacion({ estados: ["FINISHED"] });
    const b = falso({ fila: a.fila(), meta: listo.m });
    const r2 = await manejarPublicar(peticion({ id: ID, dryRun: false, contenedorId: "1790000000000001" }), { env: ENV_META, fetch: b.f, ...depsRapidas });
    expect(r2.status).toBe(200);
    expect(listo.orden).toEqual(["cuota", "estado:FINISHED", "publish", "permalink"]);
  });

  it("error 190 (token) → 502 con «cómo arreglarlo», fila «error» y sin el token en la respuesta", async () => {
    const { m } = metaPublicacion({ error: { en: "cuota", estado: 401, cuerpo: { error: { code: 190, message: `Invalid OAuth access token ${TOKEN_META}`, fbtrace_id: "T1" } } } });
    const { f, fila } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(502);
    const texto = await r.text();
    expect(JSON.parse(texto)).toMatchObject({ ok: false, tipo: "token", codigo: 190 });
    expect(JSON.parse(texto).comoArreglarlo).toMatch(/IG_ACCESS_TOKEN/);
    expect(texto).not.toContain(TOKEN_META);
    expect(fila()).toMatchObject({ estado: "error" });
    expect(String(fila()!.error)).not.toContain(TOKEN_META);
  });

  it("2207042 (límite de publicación) → 429; 9004 (URL no descargable) → 422", async () => {
    const limite = metaPublicacion({ error: { en: "publish", cuerpo: { error: { code: 4, error_subcode: 2207042, message: "Limit" } } } });
    const a = falso({ fila: FILA_GENERADA, meta: limite.m });
    const r1 = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: a.f, ...depsRapidas });
    expect(r1.status).toBe(429);
    expect(await r1.json()).toMatchObject({ tipo: "limite_publicacion" });

    const url = metaPublicacion({ error: { en: "media", cuerpo: { error: { code: 9004, error_subcode: 2207052, message: "Only photo or video can be accepted" } } } });
    const b = falso({ fila: FILA_GENERADA, meta: url.m });
    const r2 = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: b.f, ...depsRapidas });
    expect(r2.status).toBe(422);
    expect(await r2.json()).toMatchObject({ tipo: "url_no_descargable" });
  });

  it("nunca escribe secretos en consola (ni el token de Meta ni el JWT)", async () => {
    const salida: string[] = [];
    for (const nivel of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => {
        salida.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
      });
    }
    const err = metaPublicacion({ error: { en: "media", estado: 500, cuerpo: { error: { code: 2, message: `Fallo con ${TOKEN_META} y Bearer ${JWT}` } } } });
    const a = falso({ fila: FILA_GENERADA, meta: err.m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: a.f, ...depsRapidas });
    const ok = metaPublicacion();
    const b = falso({ fila: FILA_GENERADA, meta: ok.m });
    await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: b.f, ...depsRapidas });
    const texto = salida.join("\n") + (await r.text());
    expect(salida.length).toBeGreaterThan(0);
    expect(texto).not.toContain(TOKEN_META);
    expect(texto).not.toContain(JWT);
    expect(texto).not.toContain("firmaSecretaDelUsuario");
  });

  it("preflight CORS y método: OPTIONS 204 con CORS, GET 405 (sin llamar a nada)", async () => {
    const { f } = falso();
    const r = await manejarPublicar(new Request("https://x/functions/v1/instagram-publicar", { method: "OPTIONS" }), { env: ENV_META, fetch: f });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-headers")).toMatch(/apikey/);
    expect((await manejarPublicar(peticion(null, `Bearer ${JWT}`, "GET"), { env: ENV_META, fetch: f })).status).toBe(405);
    expect(f).not.toHaveBeenCalled();
  });

  it("la autorización va COMO EL USUARIO: clave pública + su JWT, nunca service_role", async () => {
    const { m } = metaPublicacion();
    const { f, llamadas } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: { ...ENV_META, SUPABASE_SERVICE_ROLE_KEY: "service-role-secreta" }, fetch: f, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const aSupabase = llamadas.filter((l) => l.url.startsWith(SB) && !l.url.includes("/object/public/"));
    expect(aSupabase.length).toBeGreaterThan(0);
    for (const l of aSupabase) {
      expect(l.cabeceras.apikey).toBe("clave-publica");
      expect(l.cabeceras.authorization).toBe(`Bearer ${JWT}`);
    }
    const permiso = llamadas.find((l) => l.url.endsWith("/rpc/can_write_section"))!;
    expect(JSON.parse(permiso.cuerpo!)).toEqual({ _section: "marketing" });
    expect(JSON.stringify(llamadas)).not.toContain("service-role-secreta");
  });

  it("503 sin secretos: el «cómo arreglarlo» apunta a los secretos de Supabase de ESTE proyecto", async () => {
    const { f } = falso({ fila: FILA_GENERADA });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_SB, fetch: f });
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.error).toMatch(/secretos de Supabase/);
    expect(j.error).not.toMatch(/Vercel/);
    expect(j.faltan).toEqual(["IG_ACCESS_TOKEN", "IG_USER_ID", "META_APP_ID"]);
    expect(j.comoArreglarlo).toMatch(/npx supabase secrets set IG_ACCESS_TOKEN=… --project-ref sfonaclosuafvlhutkon/);
    expect(j.comoArreglarlo).toMatch(/Edge Functions → Secrets/);
  });
});
