// @vitest-environment node
/**
 * Edge Function instagram-publicar (antes api/instagram-publicar.ts de Vercel)
 * sin red: fetch simulado de Supabase y de la Graph API. Autorización
 * (can_edit_section('marketing') con el JWT del usuario), dry-run sin
 * media_publish, cuota, 202 «en_proceso», archivo en Google Drive y borrado
 * del JPEG solo si Drive lo tiene, saneado del token y secretos que faltan →
 * mensaje que apunta a los secretos de Supabase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarPublicar } from "../publicar.ts";
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
  FILA_GENERADA,
  ID,
  JWT,
  metaPublicacion,
  peticion,
  REFRESH_GOOGLE,
  SB,
  SECRETO_GOOGLE,
  TOKEN_GOOGLE,
  TOKEN_META,
} from "../../_shared/instagram/__tests__/simulacion.ts";

const ENV_CON_DRIVE = { ...ENV_META, ...ENV_DRIVE };
const TMP = "tmp/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg";
/** 5 de noviembre de 2026 a mediodía (UTC). */
const ahoraFija = () => Date.UTC(2026, 10, 5, 12, 0, 0);

beforeEach(() => {
  olvidarSecretos();
  olvidarTokenDrive();
  olvidarCarpetasDrive();
});
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
    const { f, fila } = falso({ fila: FILA_GENERADA, meta: m, drive: driveFalso().m });
    const r = await manejarPublicar(peticion({ id: ID, caption: "Nuevo texto", dryRun: false }), { env: ENV_CON_DRIVE, fetch: f, ...depsRapidas });
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

  it("tras publicar de verdad guarda el JPEG en Drive (publicadas/AAAA-MM), anota drive_id y SOLO entonces borra el JPEG y la copia tmp/", async () => {
    const { m } = metaPublicacion();
    const drive = driveFalso();
    const { f, llamadas, fila } = falso({ fila: FILA_GENERADA, meta: m, drive: drive.m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false, fotoTmp: TMP }), { env: ENV_CON_DRIVE, fetch: f, ...depsRapidas, ahora: ahoraFija });
    const j = await r.json();
    expect(j).toMatchObject({ publicado: true, imagenEnBucket: false });
    expect(j.driveId).toMatch(/^1Drive/);
    // Carpetas creadas: marketing/instagram/publicadas/2026-11, y el JPEG dentro.
    const nombres = (id: string | undefined): string[] => {
      const f2 = id ? drive.ficheros.get(id) : undefined;
      return f2 ? [...nombres(f2.parents?.[0]), f2.name] : [];
    };
    expect(nombres(j.driveId)).toEqual(["marketing", "instagram", "publicadas", "2026-11", `2026-11-05_casa-tomas_post_${ID.slice(0, 8)}.jpg`]);
    expect(drive.subidas[0].meta.parents).toHaveLength(1);
    // Orden: media_publish → subida a Drive → DELETE del JPEG → DELETE de la copia tmp.
    const iPublish = llamadas.findIndex((l) => l.url.endsWith("/media_publish"));
    const iDrive = llamadas.findIndex((l) => l.url.startsWith("https://www.googleapis.com/upload/"));
    const borrados = llamadas.map((l, i) => [l, i] as const).filter(([l]) => l.metodo === "DELETE");
    expect(iDrive).toBeGreaterThan(iPublish);
    expect(borrados.map(([, i]) => i).every((i) => i > iDrive)).toBe(true);
    expect(borrados.map(([l]) => JSON.parse(l.cuerpo!))).toEqual([{ prefixes: [`piezas/2026-11/${ID}.jpg`] }, { prefixes: [TMP] }]);
    for (const [l] of borrados) {
      expect(l.url).toBe(`${SB}/storage/v1/object/instagram`);
      expect(l.cabeceras.authorization).toBe(`Bearer ${JWT}`);
    }
    expect(fila()).toMatchObject({ estado: "publicada", imagen_ruta: `piezas/2026-11/${ID}.jpg`, error: null, drive_id: j.driveId });
    // Los secretos de Google: limpiados (trim) al pedir el token y nunca en la respuesta.
    const token = new URLSearchParams(String(drive.peticionesToken[0].bruto));
    expect(token.get("client_id")).toBe("123-abc.apps.googleusercontent.com");
    expect(token.get("refresh_token")).toBe(REFRESH_GOOGLE);
    const texto = JSON.stringify(j);
    for (const secreto of [TOKEN_GOOGLE, REFRESH_GOOGLE, SECRETO_GOOGLE]) expect(texto).not.toContain(secreto);
  });

  it("sin Drive configurado: publica, NO borra el JPEG del bucket y lo avisa claro", async () => {
    const { m } = metaPublicacion();
    const { f, llamadas, fila } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false, fotoTmp: TMP }), { env: ENV_META, fetch: f, ...depsRapidas });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ publicado: true, imagenEnBucket: true, driveId: null });
    expect(llamadas.some((l) => l.metodo === "DELETE")).toBe(false);
    expect(j.avisos.join(" ")).toMatch(/no se pudo guardar en Google Drive.*GOOGLE_DRIVE_MARKETING_FOLDER_ID.*se queda en el bucket/);
    expect(fila()).toMatchObject({ estado: "publicada" });
    expect(String(fila()!.error)).toMatch(/^Publicada, pero no se pudo guardar en Google Drive/);
  });

  it("si la subida a Drive falla: publica igual, NO borra nada del bucket y lo anota", async () => {
    const { m } = metaPublicacion();
    const drive = driveFalso({ subidaFalla: true });
    const { f, llamadas, fila } = falso({ fila: FILA_GENERADA, meta: m, drive: drive.m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false, fotoTmp: TMP }), { env: ENV_CON_DRIVE, fetch: f, ...depsRapidas });
    const j = await r.json();
    expect(j).toMatchObject({ publicado: true, imagenEnBucket: true, driveId: null });
    expect(llamadas.some((l) => l.metodo === "DELETE")).toBe(false);
    expect(j.avisos.join(" ")).toMatch(/Google Drive respondió 500/);
    expect(String(fila()!.error)).toMatch(/^Publicada, pero no se pudo guardar en Google Drive/);
  });

  it("en prueba (dryRun) no toca Drive ni borra nada", async () => {
    const { m } = metaPublicacion();
    const drive = driveFalso();
    const { f, llamadas } = falso({ fila: FILA_GENERADA, meta: m, drive: drive.m });
    await manejarPublicar(peticion({ id: ID, dryRun: true, fotoTmp: TMP }), { env: ENV_CON_DRIVE, fetch: f, ...depsRapidas });
    expect(llamadas.some((l) => l.url.includes("googleapis.com"))).toBe(false);
    expect(llamadas.some((l) => l.metodo === "DELETE")).toBe(false);
  });

  it("«fotoTmp» solo admite tmp/<uuid>.jpg (no deja borrar otra cosa del bucket)", async () => {
    const { f } = falso({ fila: FILA_GENERADA });
    for (const fotoTmp of ["piezas/2026-11/x.jpg", "tmp/../piezas/x.jpg", "tmp/no-uuid.jpg", ["tmp/x.jpg"]]) {
      const r = await manejarPublicar(peticion({ id: ID, dryRun: false, fotoTmp }), { env: ENV_META, fetch: f });
      expect(r.status).toBe(400);
    }
  });

  it("si la RLS no deja borrar el JPEG: sigue publicada, avisa y lo anota en «error»", async () => {
    const { m } = metaPublicacion();
    const drive = driveFalso();
    const { f, fila } = falso({ fila: FILA_GENERADA, meta: m, borrado: [200, []], drive: drive.m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_CON_DRIVE, fetch: f, ...depsRapidas });
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

  it("autoriza y lee COMO EL USUARIO; el estado de publicación y el cerrojo, solo con service_role (auditado)", async () => {
    const { m } = metaPublicacion();
    const { f, llamadas } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: { ...ENV_META, SUPABASE_SERVICE_ROLE_KEY: "service-role-secreta" }, fetch: f, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const aSupabase = llamadas.filter((l) => l.url.startsWith(SB) && !l.url.includes("/object/public/"));
    const escrituras = aSupabase.filter((l) => (l.url.includes("/rest/v1/instagram_piezas") && l.metodo === "PATCH") || l.url.includes("/rpc/instagram_pieza_"));
    const resto = aSupabase.filter((l) => !escrituras.includes(l));
    expect(escrituras.length).toBeGreaterThanOrEqual(3); // reservar, contenedor, prueba_ok, liberar
    expect(resto.length).toBeGreaterThan(0);
    for (const l of resto) {
      expect(l.cabeceras.apikey).toBe("clave-publica");
      expect(l.cabeceras.authorization).toBe(`Bearer ${JWT}`);
    }
    for (const l of escrituras) {
      expect(l.cabeceras.authorization).toBe("Bearer service-role-secreta");
      expect(l.cabeceras["x-audit-source"]).toBe("instagram-publicar");
    }
    const permiso = llamadas.find((l) => l.url.endsWith("/rpc/can_edit_section"))!;
    expect(JSON.parse(permiso.cuerpo!)).toEqual({ _section: "marketing" });
    expect(await r.text()).not.toContain("service-role-secreta");
  });

  it("cerrojo: 409 si se está publicando; publicar a mano una pieza programada → 409 «programada»; la prueba no mira la programación", async () => {
    const { m, orden } = metaPublicacion();
    const enCurso = falso({ fila: FILA_GENERADA, meta: m, reserva: [200, { ok: false, motivo: "en_curso" }] });
    const r1 = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: enCurso.f, ...depsRapidas });
    expect(r1.status).toBe(409);
    expect(await r1.json()).toMatchObject({ tipo: "publicacion_en_curso" });
    const programada = falso({ fila: FILA_GENERADA, meta: m, reserva: [200, { ok: false, motivo: "programada", programadaPara: "2026-11-20T12:00:00Z" }] });
    const r2 = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: programada.f, ...depsRapidas });
    expect(r2.status).toBe(409);
    expect(await r2.json()).toMatchObject({ tipo: "programada", programadaPara: "2026-11-20T12:00:00Z" });
    expect(orden).toEqual([]); // no se ha llamado a Meta
    const reservas = programada.llamadas.filter((l) => l.url.endsWith("/rpc/instagram_pieza_reservar_publicacion"));
    expect(JSON.parse(reservas[0].cuerpo!)).toMatchObject({ p_pieza_id: ID, p_comprobar_programacion: true });
    const prueba = falso({ fila: FILA_GENERADA, meta: m });
    await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: prueba.f, ...depsRapidas });
    const rp = prueba.llamadas.find((l) => l.url.endsWith("/rpc/instagram_pieza_reservar_publicacion"))!;
    expect(JSON.parse(rp.cuerpo!)).toMatchObject({ p_comprobar_programacion: false });
    // Siempre se suelta el cerrojo.
    expect(prueba.llamadas.some((l) => l.url.endsWith("/rpc/instagram_pieza_liberar_publicacion"))).toBe(true);
  });

  it("sin la migración del cerrojo (RPC 404) publica igual", async () => {
    const { m } = metaPublicacion();
    const { f } = falso({ fila: FILA_GENERADA, meta: m, reserva: [404, { code: "PGRST202", message: "Could not find the function" }] });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(200);
  });

  it("texto alternativo: va a Meta en los posts, se guarda en la pieza y se valida (≤ 1000)", async () => {
    const { m } = metaPublicacion();
    const { f, llamadas, fila } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true, altText: "Chuleta de vaca a la brasa en plato oscuro" }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(200);
    const media = llamadas.find((l) => l.url.endsWith("/media"))!;
    expect(new URLSearchParams(media.cuerpo!).get("alt_text")).toBe("Chuleta de vaca a la brasa en plato oscuro");
    expect(fila()).toMatchObject({ alt_text: "Chuleta de vaca a la brasa en plato oscuro" });
    // El guardado se reutiliza si no llega (programador).
    const otra = falso({ fila: { ...FILA_GENERADA, alt_text: "Guardado" }, meta: metaPublicacion().m });
    await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: otra.f, ...depsRapidas });
    expect(new URLSearchParams(otra.llamadas.find((l) => l.url.endsWith("/media"))!.cuerpo!).get("alt_text")).toBe("Guardado");
    // Story: no se manda.
    const story = falso({ fila: { ...FILA_GENERADA, formato: "story" }, meta: metaPublicacion().m });
    await manejarPublicar(peticion({ id: ID, dryRun: true, altText: "x" }), { env: ENV_META, fetch: story.f, ...depsRapidas });
    expect(new URLSearchParams(story.llamadas.find((l) => l.url.endsWith("/media"))!.cuerpo!).get("alt_text")).toBeNull();
    const largo = falso({ fila: FILA_GENERADA, meta: metaPublicacion().m });
    const r4 = await manejarPublicar(peticion({ id: ID, dryRun: true, altText: "a".repeat(1001) }), { env: ENV_META, fetch: largo.f, ...depsRapidas });
    expect(r4.status).toBe(422);
  });

  it("cuenta por marca: Touza con IG_USER_ID_TOUZA publica en su cuenta; sin él, en la general", async () => {
    const TOUZA = "17841400000000077";
    const llamadasMeta: string[] = [];
    const meta = (l: { url: string; metodo: string }) => {
      llamadasMeta.push(l.url);
      const ruta = l.url.replace(/^https:\/\/graph\.facebook\.com\/v26\.0/, "");
      if (ruta.startsWith(`/${TOUZA}/content_publishing_limit`)) return new Response(JSON.stringify({ data: [{ quota_usage: 0, config: { quota_total: 100, quota_duration: 86400 } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (ruta === `/${TOUZA}/media`) return new Response(JSON.stringify({ id: "1790000000000001" }), { status: 200, headers: { "Content-Type": "application/json" } });
      return metaPublicacion().m(l as never);
    };
    const filaTouza = { ...FILA_GENERADA, marca: "touza" };
    const a = falso({ fila: filaTouza, meta: meta as never });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: { ...ENV_META, IG_USER_ID_TOUZA: TOUZA }, fetch: a.f, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ cuenta: { marca: "touza", igUserId: TOUZA, propia: true } });
    expect(llamadasMeta.some((u) => u.includes(`/${TOUZA}/media`))).toBe(true);
    expect(llamadasMeta.some((u) => u.includes(`/${ENV_META.IG_USER_ID}/media`))).toBe(false);
    // Casa Tomás, con el mismo entorno, sigue en la general.
    const b = falso({ fila: FILA_GENERADA, meta: metaPublicacion().m });
    const r2 = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: { ...ENV_META, IG_USER_ID_TOUZA: TOUZA }, fetch: b.f, ...depsRapidas });
    expect(await r2.json()).toMatchObject({ cuenta: { marca: "casa-tomas", igUserId: ENV_META.IG_USER_ID, propia: false } });
    // Con token propio, Touza usa su token.
    const c = falso({ fila: filaTouza, meta: meta as never });
    const tokenTouza = "EAAGtokenPropioDeTouzaParaPruebas000000000001";
    await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: { ...ENV_META, IG_USER_ID_TOUZA: TOUZA, IG_ACCESS_TOKEN_TOUZA: tokenTouza }, fetch: c.f, ...depsRapidas });
    expect(c.llamadas.find((l) => l.url.endsWith(`/${TOUZA}/media`))!.cabeceras.authorization).toBe(`Bearer ${tokenTouza}`);
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
