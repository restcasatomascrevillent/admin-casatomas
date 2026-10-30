// ============================================================================
// CT-REM-FN-07 · Limitador persistente de POST /reservas-web/crear
//
// La decisión es SQL (migración 20261030150000_reservas_web_limitador.sql):
//   · reservas_web_reservar_cupo(p_ip_hash)          -> {permitido, motivo?}
//   · reservas_web_reservar_correo_rechazo(p_email)  -> boolean
// Aquí solo: IP del cliente, su HMAC (nunca se manda la IP en claro) e
// interpretar la respuesta FALLANDO EN CERRADO ante cualquier error.
// Sin dependencias de Deno (solo `_shared/ip-cliente.ts`, también sin Deno):
// lo importan index.ts y los tests de Vitest.
// ============================================================================

import { ipCliente as ipClienteCompartido } from "../_shared/ip-cliente.ts";

/** Cliente mínimo que se necesita (el de supabase-js con service role). */
export interface ClienteRpc {
  rpc(nombre: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

// IP del visitante con la regla común de `_shared/ip-cliente.ts`
// (CT-REM-FN-03): `cf-connecting-ip` y, si falta, el ÚLTIMO salto de
// `x-forwarded-for`. Aquí solo se adapta el contrato local: sin IP -> null
// (quien llama usa entonces el cubo IP_DESCONOCIDA).
export function ipCliente(req: Request): string | null {
  return ipClienteCompartido(req) || null;
}

/** Peticiones sin IP identificable comparten un único cubo (también limitado). */
export const IP_DESCONOCIDA = "desconocida";

/** HMAC-SHA256(sal, ip) en hex. Sin sal no hay hash: quien llama falla en cerrado. */
export async function hashIp(ip: string, sal: string): Promise<string | null> {
  if (!sal) return null;
  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`reservas-web-ip:${sal}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(firma)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ResultadoCupo =
  | { estado: "permitido" }
  | { estado: "denegado"; motivo: string }
  | { estado: "no_disponible" };

/** Pide cupo para una solicitud /crear. Cualquier fallo -> `no_disponible` (fail-closed). */
export async function reservarCupoCrear(cliente: ClienteRpc, req: Request, sal: string): Promise<ResultadoCupo> {
  try {
    const ipHash = await hashIp(ipCliente(req) ?? IP_DESCONOCIDA, sal);
    if (!ipHash) return { estado: "no_disponible" };
    const { data, error } = await cliente.rpc("reservas_web_reservar_cupo", { p_ip_hash: ipHash });
    if (error || !data || typeof data !== "object") return { estado: "no_disponible" };
    const r = data as { permitido?: unknown; motivo?: unknown };
    if (r.permitido === true) return { estado: "permitido" };
    if (r.permitido === false) return { estado: "denegado", motivo: typeof r.motivo === "string" ? r.motivo : "limite" };
    return { estado: "no_disponible" };
  } catch {
    return { estado: "no_disponible" };
  }
}

/**
 * ¿Se puede mandar el correo de rechazo a esta dirección? Como mucho 1 cada
 * 24 h. Ante cualquier error, NO (fail-closed: es mejor no avisar a un
 * cliente que convertir el restaurante en un emisor de correo masivo).
 */
export async function puedeEnviarCorreoRechazo(cliente: ClienteRpc, email: string): Promise<boolean> {
  try {
    const { data, error } = await cliente.rpc("reservas_web_reservar_correo_rechazo", { p_email: email });
    return !error && data === true;
  } catch {
    return false;
  }
}

export function respuestaDemasiadasSolicitudes(telefono: string) {
  return {
    status: 429,
    cuerpo: {
      ok: false,
      error: "demasiadas_solicitudes",
      motivo: "demasiadas_solicitudes",
      mensaje: `Se han recibido demasiadas solicitudes. Inténtalo más tarde o llámanos al ${telefono}.`,
    },
  };
}

export function respuestaLimitadorNoDisponible(telefono: string) {
  return {
    status: 503,
    cuerpo: {
      ok: false,
      error: "limitador_no_disponible",
      mensaje: `Ahora mismo no podemos tramitar la solicitud. Inténtalo más tarde o llámanos al ${telefono}.`,
    },
  };
}
