/**
 * RRSS · manejador HTTP común de /api/rrss-foto y /api/rrss-video.
 *
 *   POST { accion: "analizar", archivoId }   → 200 { ok, archivo }        (síncrono: previa, medidas, hoja, audio)
 *   POST { accion: "generar", generacionId } → 202 { ok, generacionId }   (sigue en segundo plano con waitUntil;
 *                                              el panel mira rrss_generaciones) · 409 si ya la procesa otro o acabó
 *   GET                                      → diagnóstico sin sesión (motor, fuentes y logos en el bundle)
 *
 * 401 sin sesión, 403 sin «Editar» en Marketing, 400 entrada mal.
 */
import { existsSync, readdirSync } from "node:fs";
import type sharpTipo from "sharp";
import { dirFuentes, dirLogos } from "./recursos.js";
import { autorizarRrss, type SesionRrss } from "./supabase.js";
import { analizarArchivo, ErrorTrabajo, procesarGeneracion, reclamarGeneracion, type DependenciasTrabajo } from "./trabajo.js";

type Sharp = typeof sharpTipo;

export function json(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

/** waitUntil de Vercel (Fluid compute) sin dependencias: el mismo contexto que usa @vercel/functions. */
export function enSegundoPlano(tarea: Promise<unknown>): boolean {
  const g = globalThis as unknown as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined } | undefined>;
  const ctx = g[Symbol.for("@vercel/request-context")]?.get?.();
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(tarea);
    return true;
  }
  return false;
}

export interface OpcionesManejador {
  medio: "foto" | "video";
  dependencias: () => Promise<DependenciasTrabajo>;
  /** Para las pruebas. */
  autorizar?: typeof autorizarRrss;
  segundoPlano?: (t: Promise<unknown>) => boolean;
}

const ID = /^[0-9a-f-]{36}$/i;

export async function manejarPost(request: Request, o: OpcionesManejador): Promise<Response> {
  const largo = Number(request.headers.get("content-length") ?? "0");
  if (largo > 10_000) return json(413, { ok: false, error: "Petición demasiado grande" });
  const auth = await (o.autorizar ?? autorizarRrss)(request.headers.get("authorization"));
  if ("motivo" in auth) return json(auth.estado, { ok: false, error: auth.motivo });
  const s: SesionRrss = auth.sesion;
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, error: "El cuerpo no es JSON válido" });
  }
  const deps = await o.dependencias();
  try {
    if (cuerpo.accion === "analizar") {
      const id = String(cuerpo.archivoId ?? "");
      if (!ID.test(id)) return json(400, { ok: false, error: "archivoId no válido" });
      const archivo = await analizarArchivo(s, id, deps);
      return json(200, { ok: true, archivo });
    }
    if (cuerpo.accion === "generar") {
      const id = String(cuerpo.generacionId ?? "");
      if (!ID.test(id)) return json(400, { ok: false, error: "generacionId no válido" });
      const g = await reclamarGeneracion(s, id, deps, o.medio);
      if (!g) return json(409, { ok: false, error: "Esa generación ya se está procesando o ya ha terminado" });
      const tarea = procesarGeneracion(s, g, deps).then((r) => {
        console.info("[rrss]", JSON.stringify({ generacion: g.id, medio: g.medio, estado: r.estado, usuario: s.usuario }));
        return r;
      });
      if ((o.segundoPlano ?? enSegundoPlano)(tarea)) return json(202, { ok: true, generacionId: g.id, estado: "procesando" });
      const r = await tarea;
      return json(200, { ok: r.estado === "listo", generacionId: g.id, ...r });
    }
    return json(400, { ok: false, error: "Acción no válida (analizar o generar)" });
  } catch (e) {
    if (e instanceof ErrorTrabajo) return json(e.estado, { ok: false, error: e.message });
    const estado = (e as { estado?: number }).estado;
    console.error("[rrss] fallo", (e as Error)?.message ?? e);
    return json(typeof estado === "number" && estado >= 400 && estado < 600 ? estado : 500, { ok: false, error: String((e as Error)?.message ?? e).slice(0, 500) });
  }
}

/** Diagnóstico sin sesión: ¿están el motor, las fuentes y los logos? */
export async function diagnostico(medio: "foto" | "video", cargarSharp: () => Promise<Sharp>, ffmpeg?: () => Promise<string>): Promise<Response> {
  const estado: Record<string, unknown> = { medio };
  try {
    const sharp = await cargarSharp();
    estado.sharp = (sharp as unknown as { versions?: Record<string, string> }).versions?.vips ?? true;
  } catch (e) {
    estado.sharp = false;
    estado.errorSharp = String((e as Error)?.message ?? e);
  }
  try {
    estado.fuentes = existsSync(dirFuentes()) ? readdirSync(dirFuentes()).filter((f) => f.endsWith(".ttf")).length : 0;
    estado.logos = existsSync(dirLogos()) ? readdirSync(dirLogos()).filter((f) => f.endsWith(".png")).length : 0;
  } catch {
    estado.fuentes = 0;
  }
  if (ffmpeg) {
    try {
      const ruta = await ffmpeg();
      const { ejecutar } = await import("./video.js");
      const r = await ejecutar(ruta, ["-hide_banner", "-version"], { timeoutMs: 10_000 });
      estado.ffmpeg = /ffmpeg version (\S+)/.exec(r.stdout)?.[1] ?? false;
    } catch (e) {
      estado.ffmpeg = false;
      estado.errorFfmpeg = String((e as Error)?.message ?? e);
    }
  }
  const ok = !!estado.sharp && Number(estado.fuentes) >= 7 && Number(estado.logos) > 0 && (!ffmpeg || !!estado.ffmpeg);
  return json(ok ? 200 : 503, { ok, ...estado });
}
