// ============================================================================
//  registrar-actividad-web / ingesta.ts — lógica pura (sin imports remotos)
// ----------------------------------------------------------------------------
//  index.ts solo construye el cliente de Supabase y llama a procesarIngesta.
//
//  Contrato (lo usa web-casatomas/src/lib/actividad/envio.ts):
//    POST /functions/v1/registrar-actividad-web
//      Content-Type: text/plain (sendBeacon / fetch keepalive: sin preflight CORS)
//      cuerpo: { v: 1, contexto: { consentimiento, version, despliegue, interno, prueba, tactil },
//                eventos: [{ id, t, tipo, accion?, sesion?, visitante?, seq?, ruta?, objetivo?, valor?, props?, error? }] }
//    202 { aceptados, duplicados, descartados, rechazados }   — guardado (o duplicado, o descartado por límites)
//    400 cuerpo ilegible · 403 origen no permitido · 405 método · 413 demasiado grande
//    503 no se pudo guardar: el navegador REINTENTA el mismo lote (mismos id → sin duplicados)
//
//  Sin autenticación de usuario a propósito (la llama cualquier visitante),
//  como chat-web: la protegen el origen permitido, el tamaño máximo, el
//  límite por IP (HMAC con sal diaria, nunca la IP) y el cupo diario de la RPC.
// ============================================================================

import { dispositivoDe, entornoDeOrigen, esBot, navegadorDe, soDe, type Entorno } from "../_shared/logs-web/clasificacion.ts";
import { MAX_BYTES_LOTE, normalizarLote, type EventoNormalizado } from "../_shared/logs-web/eventos.ts";
import { hmacHex } from "../_shared/logs-web/huella.ts";

export interface ResultadoRpc {
  aceptados?: number;
  duplicados?: number;
  descartados?: number;
  rechazados?: number;
  motivo?: string;
}

export interface DependenciasIngesta {
  ingerir: (eventos: EventoNormalizado[], ctx: { entorno: Entorno; ip_hash: string | null }) => Promise<ResultadoRpc>;
  /** Clave del HMAC de la IP (la service role: nunca sale de la función). */
  claveIp: string;
  ip: string;
  origenesExtra?: string;
  ahora?: () => Date;
}

export function cabecerasCors(origen: string | null, permitido: boolean): Record<string, string> {
  return {
    ...(permitido && origen ? { "Access-Control-Allow-Origin": origen, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  };
}

const json = (cuerpo: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Lee el cuerpo con tope de bytes (una petición gigante no se carga entera en memoria). */
async function leerConTope(req: Request, tope: number): Promise<string | null> {
  const declarado = Number(req.headers.get("content-length") ?? "0");
  if (declarado > tope) return null;
  if (!req.body) return "";
  const lector = req.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > tope) {
      await lector.cancel().catch(() => {});
      return null;
    }
    trozos.push(value);
  }
  const unido = new Uint8Array(total);
  let pos = 0;
  for (const t of trozos) {
    unido.set(t, pos);
    pos += t.byteLength;
  }
  return new TextDecoder().decode(unido);
}

export async function procesarIngesta(req: Request, deps: DependenciasIngesta): Promise<Response> {
  const origen = req.headers.get("origin");
  const entorno = entornoDeOrigen(origen, deps.origenesExtra ?? "");
  const cors = cabecerasCors(origen, entorno !== null);

  if (req.method === "OPTIONS") return new Response(null, { status: entorno ? 204 : 403, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "metodo_no_permitido" }, 405, cors);
  if (!entorno) return json({ ok: false, error: "origen_no_permitido" }, 403, cors);

  const texto = await leerConTope(req, MAX_BYTES_LOTE);
  if (texto === null) return json({ ok: false, error: "demasiado_grande" }, 413, cors);
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return json({ ok: false, error: "cuerpo_no_valido" }, 400, cors);
  }

  const ahora = deps.ahora?.() ?? new Date();
  const ua = req.headers.get("user-agent");
  const contexto = (cuerpo as { contexto?: { tactil?: unknown } } | null)?.contexto;
  const lote = await normalizarLote(cuerpo, {
    entorno,
    proyecto: "casa-tomas-story",
    esBot: esBot(ua),
    dispositivo: dispositivoDe(ua, contexto?.tactil === true),
    navegador: navegadorDe(ua),
    so: soDe(ua),
    ahora,
  });

  if (lote.eventos.length === 0) {
    return json({ aceptados: 0, duplicados: 0, descartados: lote.sinConsentimiento, rechazados: lote.rechazados }, 202, cors);
  }

  // Sal diaria: el mismo visitante no es enlazable de un día a otro ni aquí.
  const ipHash = deps.ip ? (await hmacHex(`${deps.claveIp}:${ahora.toISOString().slice(0, 10)}`, deps.ip)).slice(0, 32) : null;
  try {
    const r = await deps.ingerir(lote.eventos, { entorno, ip_hash: ipHash });
    return json({
      aceptados: r.aceptados ?? 0,
      duplicados: r.duplicados ?? 0,
      descartados: (r.descartados ?? 0) + lote.sinConsentimiento,
      rechazados: (r.rechazados ?? 0) + lote.rechazados,
      ...(r.motivo ? { motivo: r.motivo } : {}),
    }, 202, cors);
  } catch (e) {
    console.error("[registrar-actividad-web] no se pudo guardar el lote:", (e as Error)?.message ?? e);
    return json({ ok: false, error: "no_guardado" }, 503, cors);
  }
}
