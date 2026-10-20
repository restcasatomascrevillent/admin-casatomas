// ============================================================================
// TOKENS DE UN SOLO USO PARA ACEPTAR/RECHAZAR LA CONTRAOFERTA
// ============================================================================
// Mismo enfoque que supabase/functions/reservas-web (HMAC-SHA256 con Web
// Crypto, sin tabla de tokens, sin dependencias) pero implementado aquí de
// forma independiente a propósito: este proyecto no comparte código entre
// Edge Functions (ver enviar-newsletter/index.ts, comentario junto a
// hmacSign — "este proyecto no usa un directorio _shared/ entre funciones"),
// y reservas-web es de otro agente en este mismo encargo: no se importa
// nada de ahí.
//
// DIFERENCIA DELIBERADA con el fingerprint de reservas-web: allí
// `fp = estado + '|' + updated_at`, apoyado en que cualquier UPDATE mueve
// `updated_at`. Hay evidencia contradictoria en este mismo repo sobre si
// ese trigger existe de verdad para `reservas` (comparar
// `docs/funcionalidades/01-reservas.md`, que SÍ lista
// `update_reservas_updated_at` entre los triggers de `reservas`, con
// `docs/REVISION-PUERTOS-N8N.md` X-3, que afirma que NO existe). En vez de
// depender de esa duda, aquí el fingerprint usa solo columnas que la propia
// acción de aceptar/rechazar cambia, o que invalidan el enlace si el
// restaurante revisa la oferta antes de que el cliente responda:
// `v2|estado|hora`. Cualquier cambio de estado u hora invalida el token — un
// efecto secundario correcto: si el restaurante propone otra hora distinta
// tras mandar el primer correo, el enlace viejo dejará de servir en vez de
// aceptar condiciones ya obsoletas.
//
// LA SALA YA NO ENTRA (reservas-sin-salas, 2026-09-29): en Casa Tomás la sala
// es una decisión interna que se toma después de mandar el correo (hasta 48 h
// antes del servicio). Si formara parte de la huella, asignar la sala mataría
// el enlace que el cliente tiene en su bandeja.
//
// Periodo de gracia: los enlaces firmados ANTES del despliegue llevan la
// huella antigua `estado|hora|espacio_id` (sin prefijo). `huellaReservaCoincide`
// los sigue aceptando comparando estado y hora e IGNORANDO la sala. La firma
// HMAC hace la carga infalsificable, así que el prefijo "v2|" distingue los
// dos formatos con seguridad (una huella antigua empieza siempre por un
// estado de reserva). El periodo se acaba solo: `verificarToken` rechaza un
// `exp` pasado y el TTL es de 14 días.
// TODO(reservas-sin-salas): quitar la rama de legado a partir de
// despliegue + 15 días.
// ============================================================================

const TOKEN_TTL_SEGUNDOS = 60 * 60 * 24 * 14; // 14 días, igual que reservas-web

// 'aceptar'/'rechazar'  -> contraoferta sobre una RESERVA (id = reservas.id).
// '*_solicitud'         -> propuesta sobre una SOLICITUD del bot (id =
//                          solicitudes_pendientes.id, ver propuesta-solicitud.ts).
// Acciones distintas a propósito: verificarToken exige la acción esperada,
// así que un token de un flujo nunca se acepta en las rutas del otro.
export type AccionToken = "aceptar" | "rechazar" | "aceptar_solicitud" | "rechazar_solicitud";

export interface CargaToken {
  id: string;
  accion: AccionToken;
  exp: number;
  fp: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const relleno = str + "=".repeat((4 - (str.length % 4)) % 4);
  const binario = atob(relleno.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function claveHmac(secreto: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Prefijo de las huellas nuevas (sin sala). */
export const PREFIJO_HUELLA_V2 = "v2|";

/** `v2|estado|HH:MM`. Pura: no lee reloj ni BD. La sala NO entra (ver cabecera). */
export function calcularHuella(estado: string, hora: string): string {
  const horaCorta = (hora || "").slice(0, 5);
  return `${PREFIJO_HUELLA_V2}${estado}|${horaCorta}`;
}

/**
 * ¿La huella de un token sigue casando con la fila actual de `reservas`?
 *  - v2 (`v2|estado|HH:MM`): igualdad estricta con `calcularHuella`.
 *  - legado (`estado|HH:MM|espacio_id`, enlaces firmados antes de
 *    reservas-sin-salas): exactamente 3 partes, mismo estado y misma hora; la
 *    sala se ignora. Ver "Periodo de gracia" en la cabecera.
 */
export function huellaReservaCoincide(fpToken: string, estado: string, hora: string): boolean {
  const fp = fpToken ?? "";
  if (fp.startsWith(PREFIJO_HUELLA_V2)) return fp === calcularHuella(estado, hora);
  const partes = fp.split("|");
  if (partes.length !== 3) return false;
  return partes[0] === estado && partes[1] === (hora || "").slice(0, 5);
}

export async function firmarToken(
  secreto: string,
  reservaId: string,
  accion: AccionToken,
  huella: string,
  ahoraEpochSegundos: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const carga: CargaToken = {
    id: reservaId,
    accion,
    exp: ahoraEpochSegundos + TOKEN_TTL_SEGUNDOS,
    fp: huella,
  };
  const cargaB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(carga)));
  const clave = await claveHmac(secreto);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(cargaB64));
  return `${cargaB64}.${base64UrlEncode(new Uint8Array(firma))}`;
}

/**
 * Verifica firma + expiración + acción. NO comprueba la huella contra la
 * fila actual de `reservas` — eso lo hace index.ts tras leer la reserva de
 * la BD (esta función es pura, no consulta nada). Devuelve `null` ante
 * cualquier problema (firma inválida, formato roto, caducado, acción que no
 * coincide) sin distinguir el motivo — mismo criterio "fail closed y sin
 * pistas" que reservas-web.
 */
export async function verificarToken(
  secreto: string,
  token: string,
  accionEsperada: AccionToken,
  ahoraEpochSegundos: number = Math.floor(Date.now() / 1000),
): Promise<CargaToken | null> {
  if (!secreto) return null;
  const partes = (token || "").split(".");
  if (partes.length !== 2) return null;
  const [cargaB64, firmaB64] = partes;
  try {
    const clave = await claveHmac(secreto);
    const valido = await crypto.subtle.verify(
      "HMAC",
      clave,
      base64UrlDecode(firmaB64),
      new TextEncoder().encode(cargaB64),
    );
    if (!valido) return null;
    const carga = JSON.parse(new TextDecoder().decode(base64UrlDecode(cargaB64))) as CargaToken;
    if (carga.accion !== accionEsperada) return null;
    if (typeof carga.exp !== "number" || carga.exp < ahoraEpochSegundos) return null;
    return carga;
  } catch {
    return null;
  }
}
