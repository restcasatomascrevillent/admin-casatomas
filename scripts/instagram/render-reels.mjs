// Trabajador de render de reels de Instagram (fase 6, docs/instagram-video.md).
//
// Lee la cola instagram_trabajos_render de Supabase, reclama un trabajo
// (RPC instagram_render_reclamar: FOR UPDATE SKIP LOCKED, nadie más lo coge),
// renderiza el reel fotograma a fotograma con Chromium (Playwright) sobre la
// página de captura __reel-instagram.html, lo codifica con ffmpeg (H.264
// 1080×1920 30 fps + AAC, faststart), lo comprueba con ffprobe, sube el MP4 y
// la portada al cubo «instagram-video», cierra el trabajo
// (instagram_render_terminar → la pieza pasa a «generada») y avisa por push al
// que lo encargó (Edge Function notificar-video, tipo «reel»).
//
// SEGURIDAD: NO usa service_role. Entra como un USUARIO DEL PANEL dedicado
// («render@…») con «Ver» y «Editar» SOLO en la sección «Instagram · Render»
// (instagram_render, migración 20261111000000), SIN Marketing. Con eso la base
// de datos solo le deja: leer la cola, reclamar, marcar progreso, soltar y
// cerrar SUS trabajos, leer la pista de audio de un trabajo suyo, subir el MP4
// y la portada con la ruta de su trabajo y borrar los vídeos viejos de esas
// piezas que ya no usa nadie («anteriores» de instagram_render_terminar). No
// puede publicar, programar, ver piezas, métricas ni encargos, ni usar Drive.
//
// USO (desde la raíz del repo, con las variables de entorno puestas):
//   node scripts/instagram/render-reels.mjs              en bucle (cada RENDER_INTERVALO_S)
//   node scripts/instagram/render-reels.mjs --una-vez     hace lo que haya en cola y sale
//   node scripts/instagram/render-reels.mjs --trabajo <id>  solo ese trabajo
//   node scripts/instagram/render-reels.mjs --comprobar   comprueba ffmpeg, Chromium, la página y la sesión
//
// VARIABLES (ninguna se imprime):
//   RENDER_SUPABASE_URL      (o VITE_SUPABASE_URL)   https://<ref>.supabase.co
//   RENDER_SUPABASE_ANON_KEY (o VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY)
//   RENDER_EMAIL, RENDER_PASSWORD   usuario del panel con «Editar» en Instagram · Render
//   RENDER_PAGINA     "dist" (build local, por defecto si existe dist/), "vite"
//                     (sin build) o la URL del panel publicado (https://…)
//   RENDER_DISPOSITIVO  nombre del equipo (se ve en el panel); por defecto el hostname
//   RENDER_INTERVALO_S  segundos entre consultas a la cola (30)
//   RENDER_OBJETIVO_MB  peso objetivo del MP4 (25)   RENDER_CRF  calidad x264 (20)
//   RENDER_FFMPEG, RENDER_FFPROBE, RENDER_CHROMIUM   rutas, si no están en el PATH
//   RENDER_TMP          carpeta de trabajo (por defecto, la temporal del sistema)
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buscarFfmpeg, ErrorRender, OBJETIVO_MB_POR_DEFECTO, renderizarReel, servirPagina } from "./render-reels-lib.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CUBO = "instagram-video";
/** Sección propia del trabajador (A6): solo render, sin Marketing. */
export const SECCION_RENDER = "instagram_render";
const ETIQUETA = "[render-reels]";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ETIQUETA, ...a);
const avisar = (...a) => console.warn(new Date().toISOString().slice(11, 19), ETIQUETA, ...a);

export function leerConfig(env = process.env) {
  const url = (env.RENDER_SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const clave = env.RENDER_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || "";
  const pagina = env.RENDER_PAGINA || (existsSync(path.join(RAIZ, "dist", "__reel-instagram.html")) ? "dist" : "vite");
  const faltan = [];
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) faltan.push("RENDER_SUPABASE_URL (https://<ref>.supabase.co)");
  if (!clave) faltan.push("RENDER_SUPABASE_ANON_KEY (clave pública del proyecto)");
  if (!env.RENDER_EMAIL) faltan.push("RENDER_EMAIL");
  if (!env.RENDER_PASSWORD) faltan.push("RENDER_PASSWORD");
  return {
    url,
    clave,
    email: env.RENDER_EMAIL ?? "",
    password: env.RENDER_PASSWORD ?? "",
    pagina,
    dispositivo: (env.RENDER_DISPOSITIVO || `${os.hostname()} (render-reels)`).slice(0, 200),
    intervaloMs: Math.max(5, Number(env.RENDER_INTERVALO_S) || 30) * 1000,
    objetivoMb: Math.min(45, Math.max(5, Number(env.RENDER_OBJETIVO_MB) || OBJETIVO_MB_POR_DEFECTO)),
    crf: Math.min(30, Math.max(14, Number(env.RENDER_CRF) || 20)),
    chromium: env.RENDER_CHROMIUM || undefined,
    tmp: env.RENDER_TMP || os.tmpdir(),
    faltan,
  };
}

/** Ruta del vídeo y la portada en el cubo (la RPC exige este formato). */
export function rutasSalida(trabajo, fecha = new Date()) {
  const mes = `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
  const base = `reels/${mes}/${trabajo.pieza_id}-${trabajo.id.replace(/-/g, "").slice(0, 8)}`;
  return { video: `${base}.mp4`, portada: `${base}.jpg` };
}

/** Solo URLs de copias temporales (tmp/) del cubo «instagram» de ESTE Supabase. */
export function fotosPermitidas(fotos, urlSupabase) {
  const prefijo = `${urlSupabase}/storage/v1/object/public/instagram/tmp/`;
  const buenas = {};
  const malas = [];
  for (const [id, u] of Object.entries(fotos ?? {})) {
    if (typeof u === "string" && u.startsWith(prefijo) && !u.includes("..")) buenas[id] = u;
    else malas.push(id);
  }
  return { buenas, malas, prefijo };
}

/**
 * Rutas de vídeos viejos que se pueden borrar: solo reels/AAAA-MM/<uuid>-<8 hex>.mp4|.jpg
 * (lo que devuelve instagram_render_terminar en «anteriores»; la RLS lo vuelve a comprobar).
 */
export function anterioresValidos(anteriores) {
  if (!Array.isArray(anteriores)) return [];
  return anteriores
    .filter((r) => typeof r === "string" && /^reels\/\d{4}-\d{2}\/[0-9a-f-]{36}-[0-9a-f]{8}\.(mp4|jpg)$/.test(r))
    .slice(0, 20);
}

/** Borra los MP4 y portadas de renders anteriores de la pieza (A5). Nunca lanza. */
export async function borrarAnteriores(sb, anteriores) {
  const rutas = anterioresValidos(anteriores);
  if (!rutas.length) return 0;
  try {
    const { data, error } = await sb.storage.from(CUBO).remove(rutas);
    if (error) {
      avisar("no se pudieron borrar los vídeos anteriores (los borrará la limpieza diaria):", error.message);
      return 0;
    }
    const n = Array.isArray(data) ? data.length : 0;
    if (n) log(`borrados ${n} vídeos o portadas anteriores de la pieza`);
    return n;
  } catch (e) {
    avisar("no se pudieron borrar los vídeos anteriores:", e?.message ?? e);
    return 0;
  }
}

function textoError(e) {
  if (e instanceof ErrorRender) return [e.message, ...(e.problemas ?? []).map((p) => `· ${p}`)].join("\n").slice(0, 1900);
  return String(e?.message ?? e).slice(0, 1900);
}

async function procesar(sb, cfg, herramientas, pagina, trabajo) {
  log(`trabajo ${trabajo.id.slice(0, 8)} (pieza ${trabajo.pieza_id.slice(0, 8)}, intento ${trabajo.intentos})`);
  const carpeta = await mkdtemp(path.join(cfg.tmp, "reel-"));
  try {
    const { buenas, malas, prefijo } = fotosPermitidas(trabajo.fotos, cfg.url);
    if (malas.length) throw new ErrorRender("Hay fotos con una URL que no es una copia temporal del cubo «instagram»", malas.map((id) => `Foto «${id}»`));

    let audio = null;
    if (trabajo.audio_ruta) {
      const { data, error } = await sb.storage.from(CUBO).download(trabajo.audio_ruta);
      if (error || !data) throw new ErrorRender(`No se pudo descargar la pista de audio (${error?.message ?? "vacía"})`);
      audio = path.join(carpeta, `pista${path.extname(trabajo.audio_ruta)}`);
      await writeFile(audio, Buffer.from(await data.arrayBuffer()));
    }

    const r = await renderizarReel({
      datos: { reel: trabajo.reel, fotos: buenas, portada_s: trabajo.portada_s === null ? null : Number(trabajo.portada_s) },
      urlPagina: pagina.url,
      carpeta,
      ffmpeg: herramientas.ffmpeg,
      ffprobe: herramientas.ffprobe,
      audio,
      objetivoMb: cfg.objetivoMb,
      crf: cfg.crf,
      chromiumPath: cfg.chromium,
      prefijosPermitidos: [prefijo],
      registro: (l) => log(l),
      alProgreso: async (progreso, fotogramas) => {
        const { error } = await sb.rpc("instagram_render_progreso", { p_id: trabajo.id, p_progreso: progreso, p_fotogramas: fotogramas });
        if (error) avisar("no se pudo marcar el progreso:", error.message);
      },
    });

    const rutas = rutasSalida(trabajo);
    for (const [ruta, fichero, tipo] of [[rutas.video, r.mp4, "video/mp4"], [rutas.portada, r.portada, "image/jpeg"]]) {
      const { error } = await sb.storage.from(CUBO).upload(ruta, await readFile(fichero), { contentType: tipo, upsert: true, cacheControl: "3600" });
      if (error) throw new ErrorRender(`No se pudo subir ${ruta} al cubo ${CUBO}: ${error.message}`);
    }
    const { data, error } = await sb.rpc("instagram_render_terminar", {
      p_id: trabajo.id,
      p_ok: true,
      p_video_ruta: rutas.video,
      p_portada_ruta: rutas.portada,
      p_duracion_s: r.duracion,
      p_bytes: r.bytes,
      p_avisos: r.avisos.slice(0, 30),
    });
    if (error) throw new ErrorRender(`No se pudo cerrar el trabajo: ${error.message}`);
    log(`listo: ${(r.bytes / 1048576).toFixed(1)} MB, ${r.duracion} s${data?.piezaAlDia === false ? " (el reel cambió mientras tanto: la pieza no se ha tocado)" : ""}`);
    await borrarAnteriores(sb, data?.anteriores);
  } catch (e) {
    avisar(`error en ${trabajo.id.slice(0, 8)}:`, textoError(e).split("\n")[0]);
    const { error } = await sb.rpc("instagram_render_terminar", { p_id: trabajo.id, p_ok: false, p_error: textoError(e) });
    if (error) avisar("tampoco se pudo marcar el error:", error.message);
  } finally {
    await rm(carpeta, { recursive: true, force: true }).catch(() => {});
  }
  await notificar(sb, cfg, trabajo.id);
}

async function notificar(sb, cfg, trabajoId) {
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const r = await fetch(`${cfg.url}/functions/v1/notificar-video`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: cfg.clave, "Content-Type": "application/json" },
      body: JSON.stringify({ trabajo_id: trabajoId, tipo: "reel" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok && r.status !== 503) avisar(`el aviso push respondió ${r.status}`);
  } catch {
    /* el aviso es opcional */
  }
}

async function principal() {
  const args = process.argv.slice(2);
  const unaVez = args.includes("--una-vez");
  const comprobar = args.includes("--comprobar");
  const iTrabajo = args.indexOf("--trabajo");
  const soloTrabajo = iTrabajo >= 0 ? args[iTrabajo + 1] : null;
  if (soloTrabajo && !/^[0-9a-f-]{36}$/i.test(soloTrabajo)) throw new Error("--trabajo necesita el id (UUID) del trabajo");

  const cfg = leerConfig();
  if (cfg.faltan.length) {
    console.error(`${ETIQUETA} Faltan variables de entorno: ${cfg.faltan.join(", ")}. Ver docs/instagram-video.md.`);
    process.exit(2);
  }
  const herramientas = await buscarFfmpeg();
  if (!herramientas.ffmpeg) {
    console.error(`${ETIQUETA} No se encuentra ffmpeg. Instálalo (Windows: winget install Gyan.FFmpeg) o pon RENDER_FFMPEG.`);
    process.exit(2);
  }
  log(`ffmpeg: ${herramientas.origen}; ffprobe: ${herramientas.ffprobe ? "sí" : "NO (solo se comprobará la estructura del MP4)"}; página: ${/^https?:/.test(cfg.pagina) ? "URL del panel" : cfg.pagina}`);

  const sb = createClient(cfg.url, cfg.clave, { auth: { persistSession: false, autoRefreshToken: true } });
  const { error: eLogin } = await sb.auth.signInWithPassword({ email: cfg.email, password: cfg.password });
  if (eLogin) {
    console.error(`${ETIQUETA} No se pudo entrar con RENDER_EMAIL: ${eLogin.message}`);
    process.exit(2);
  }
  const { data: puede, error: ePermiso } = await sb.rpc("can_edit_section", { _section: SECCION_RENDER });
  if (ePermiso || puede !== true) {
    console.error(`${ETIQUETA} El usuario no tiene «Editar» en Instagram · Render (${SECCION_RENDER}). Dáselo en Usuarios (y quítale Marketing si lo tenía).`);
    process.exit(2);
  }

  const pagina = await servirPagina(/^https?:\/\//.test(cfg.pagina) ? { modo: "url", url: cfg.pagina } : { modo: cfg.pagina === "vite" ? "vite" : "dist" });
  let actual = null;
  let parar = false;
  const salir = async () => {
    if (parar) process.exit(1);
    parar = true;
    log("parando…");
    if (actual) await sb.rpc("instagram_render_soltar", { p_id: actual }).catch(() => {});
    await pagina.cerrar().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", salir);
  process.on("SIGTERM", salir);

  if (comprobar) {
    const { error } = await sb.from("instagram_trabajos_render").select("id", { head: true, count: "exact" }).in("estado", ["pendiente", "renderizando"]);
    log(error ? `la cola no se puede leer: ${error.message} (¿falta la migración 20261109100000?)` : "sesión, permiso y cola: bien");
    await pagina.cerrar();
    return;
  }

  log(`esperando trabajos como «${cfg.dispositivo}»${unaVez ? " (una vez)" : ""}…`);
  for (;;) {
    const { data, error } = await sb.rpc("instagram_render_reclamar", { p_dispositivo: cfg.dispositivo, p_id: soloTrabajo });
    if (error) avisar("no se pudo consultar la cola:", error.message);
    const trabajo = Array.isArray(data) ? data[0] : null;
    if (trabajo) {
      actual = trabajo.id;
      await procesar(sb, cfg, herramientas, pagina, trabajo);
      actual = null;
      if (soloTrabajo) break;
      continue; // puede haber más
    }
    if (unaVez || soloTrabajo || parar) break;
    await new Promise((r) => setTimeout(r, cfg.intervaloMs));
  }
  await pagina.cerrar();
  await sb.auth.signOut().catch(() => {});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(`${ETIQUETA} ${e?.message ?? e}`);
    process.exit(1);
  });
}
