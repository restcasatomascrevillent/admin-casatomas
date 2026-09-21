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
// `estado + '|' + hora + '|' + espacio_id`. Cualquier cambio de cualquiera
// de las tres invalida el token — un efecto secundario correcto: si el
// restaurante propone otra hora distinta tras mandar el primer correo, el
// enlace viejo dejará de servir en vez de aceptar condiciones ya obsoletas.
// ============================================================================

const TOKEN_TTL_SEGUNDOS = 60 * 60 * 24 * 14; // 14 días, igual que reservas-web

export type AccionToken = "aceptar" | "rechazar";

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

/** `estado + '|' + hora (HH:MM) + '|' + espacio_id`. Pura: no lee reloj ni BD. */
export function calcularHuella(estado: string, hora: string, espacioId: string | null): string {
  const horaCorta = (hora || "").slice(0, 5);
  return `${estado}|${horaCorta}|${espacioId ?? ""}`;
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
