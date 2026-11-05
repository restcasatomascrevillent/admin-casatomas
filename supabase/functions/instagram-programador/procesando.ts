/**
 * Reels «procesando» (fase 6, docs/instagram-video.md): cuando el panel
 * prueba o publica un reel y Meta no termina de procesar el vídeo dentro del
 * tiempo de instagram-publicar, la pieza queda en estado «procesando» con
 * procesando_accion = prueba | publicar y su contenedor. Cada pasada del
 * programador (pg_cron cada 5 min; el cron también llama si hay alguna, ver
 * 20261109100000) las cierra aquí repitiendo la MISMA petición con ese
 * contenedor: FINISHED → prueba_ok o publicada; ERROR → error; aún
 * IN_PROGRESS → sigue «procesando» para la siguiente pasada. A las 24 h el
 * contenedor caduca y la pieza pasa a error. Las de una programación
 * (procesando_accion = programador) las cierra su programación.
 */
import { registro, sanear } from "../_shared/instagram/secretos.ts";
import type { Sesion } from "../_shared/instagram/supabase.ts";
import { publicarConSesion, type DependenciasPublicar } from "../instagram-publicar/publicar.ts";

export const MAX_PROCESANDO_POR_PASADA = 5;
/** A las 24 h el contenedor de Meta caduca: un «procesando» más viejo pasa a error. */
export const CADUCIDAD_PROCESANDO_MS = 24 * 60 * 60_000;

export interface ResultadoProcesando {
  piezaId: string;
  accion: string;
  estado: number | null;
  resultado: string;
  mensaje: string | null;
}

export interface DependenciasProcesando {
  etiqueta: string;
  publicar?: (s: Sesion, request: Request, deps: DependenciasPublicar) => Promise<Response>;
  fetch?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  ahora?: () => number;
  presupuestoSondeoMs?: number;
  intervaloMs?: number;
}

interface FilaProcesando {
  id: string;
  contenedor_id: string | null;
  procesando_accion: string | null;
  procesando_desde: string | null;
}

function cabeceras(s: Sesion): Record<string, string> {
  return { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, "Content-Type": "application/json", Accept: "application/json" };
}

/** Nunca lanza: lo que no se pueda cerrar se queda para la siguiente pasada. */
export async function cerrarProcesando(s: Sesion, env: Record<string, string | undefined>, deps: DependenciasProcesando): Promise<ResultadoProcesando[]> {
  const ahora = deps.ahora ?? Date.now;
  let filas: FilaProcesando[];
  try {
    const r = await s.fetch(
      `${s.sb.url}/rest/v1/instagram_piezas?estado=eq.procesando&procesando_accion=in.(prueba,publicar)` +
        `&select=id,contenedor_id,procesando_accion,procesando_desde&order=procesando_desde.asc&limit=${MAX_PROCESANDO_POR_PASADA}`,
      { headers: cabeceras(s), signal: AbortSignal.timeout(15_000) },
    );
    if (!r.ok) {
      // 400 = columna inexistente (migración 20261109100000 sin aplicar): nada que cerrar.
      if (r.status !== 400) registro("warn", deps.etiqueta, "no se pudieron leer los reels «procesando»", { estado: r.status });
      return [];
    }
    const datos = await r.json().catch(() => []);
    filas = Array.isArray(datos) ? (datos as FilaProcesando[]) : [];
  } catch (e) {
    registro("warn", deps.etiqueta, "no se pudieron leer los reels «procesando»", { error: (e as Error)?.message });
    return [];
  }

  const publicar = deps.publicar ?? publicarConSesion;
  const salida: ResultadoProcesando[] = [];
  for (const f of filas) {
    const accion = f.procesando_accion === "publicar" ? "publicar" : "prueba";
    const desde = f.procesando_desde ? Date.parse(f.procesando_desde) : NaN;
    try {
      if (!f.contenedor_id || (Number.isFinite(desde) && ahora() - desde > CADUCIDAD_PROCESANDO_MS)) {
        const mensaje = !f.contenedor_id
          ? "Quedó «procesando» sin contenedor de Instagram: vuelve a probarlo."
          : "Instagram no terminó de procesar el vídeo en 24 h y el contenedor caducó: vuelve a probarlo.";
        await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas?id=eq.${encodeURIComponent(f.id)}&estado=eq.procesando`, {
          method: "PATCH",
          headers: { ...cabeceras(s), Prefer: "return=minimal" },
          body: JSON.stringify({ estado: "error", error: mensaje }),
          signal: AbortSignal.timeout(15_000),
        });
        salida.push({ piezaId: f.id, accion, estado: null, resultado: "error", mensaje });
        continue;
      }
      const peticion = new Request(`${s.sb.url}/functions/v1/${deps.etiqueta}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: f.id, dryRun: accion !== "publicar", contenedorId: f.contenedor_id }),
      });
      const r = await publicar(s, peticion, {
        env,
        fetch: deps.fetch,
        dormir: deps.dormir,
        ahora: deps.ahora,
        presupuestoMs: deps.presupuestoSondeoMs,
        intervaloMs: deps.intervaloMs,
      });
      const c = ((await r.json().catch(() => ({}))) ?? {}) as { estado?: string; mensaje?: string; error?: string };
      const resultado = r.status === 202 ? "sigue_procesando" : r.ok ? String(c.estado ?? "ok") : "error";
      salida.push({ piezaId: f.id, accion, estado: r.status, resultado, mensaje: r.ok ? (c.mensaje ?? null) : sanear(c.error ?? `La publicación respondió ${r.status}`) });
    } catch (e) {
      registro("warn", deps.etiqueta, "no se pudo cerrar un reel «procesando»", { id: f.id, error: (e as Error)?.message });
      salida.push({ piezaId: f.id, accion, estado: null, resultado: "error", mensaje: sanear((e as Error)?.message ?? String(e)) });
    }
  }
  if (salida.length) registro("info", deps.etiqueta, "reels «procesando» revisados", { total: salida.length });
  return salida;
}
