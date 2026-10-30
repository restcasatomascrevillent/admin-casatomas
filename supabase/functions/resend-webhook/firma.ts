// ============================================================================
// VERIFICACIÓN DE FIRMA SVIX (Resend firma sus webhooks siguiendo el
// estándar Svix). Documentación consultada 2026-09-23 antes de escribir
// esto, no deducida de memoria -- es el punto más delicado del encargo (ver
// cabecera de index.ts): si esto queda mal, el webhook deja de recibir
// eventos y nadie se entera, porque simplemente dejarían de llegar.
//   - resend.com/docs/dashboard/webhooks/verify-webhooks-requests
//   - docs.svix.com/receiving/verifying-payloads/how-manual
//
// FORMATO EXACTO (verificado contra ambas):
//   - Contenido firmado: `${svix-id}.${svix-timestamp}.${cuerpo_crudo}`
//     (cuerpo CRUDO tal cual llegó por HTTP -- nunca un JSON.stringify del
//     objeto ya parseado, que no reproduce necesariamente los mismos bytes:
//     orden de claves, espacios, escapes... la doc de Resend lo dice
//     explícito: "the cryptographic signature is sensitive to even the
//     slightest change").
//   - El secreto (RESEND_WEBHOOK_SECRET) lleva el prefijo `whsec_`. Se
//     quita ese prefijo y el resto se decodifica de base64 a bytes crudos
//     -- ESA es la clave HMAC, nunca el secreto en texto plano tal cual.
//   - Algoritmo: HMAC-SHA256 sobre el contenido firmado (UTF-8) con esa
//     clave. El resultado se codifica en base64 estándar (no base64url).
//   - Cabecera `svix-signature`: una o más firmas separadas por espacio,
//     cada una "v1,<firma_base64>" (varias firmas = secreto en rotación;
//     basta con que UNA coincida).
//   - Comparación en tiempo constante -- exigido explícitamente en el
//     encargo, no "===" sobre strings (que corta en la primera diferencia
//     y filtra por temporización cuánto se pareció el intento).
//
// Módulo PURO (sin Deno.env, sin I/O) para poder testearlo con vitest sin
// arrancar el runtime de Edge Functions -- `crypto.subtle` es un global
// Web Crypto estándar, igual en Node/vitest que en Deno (mismo criterio ya
// usado en emails-reserva/tokens.ts, que se apoya en el mismo hecho).
// ============================================================================

const TOLERANCIA_TIMESTAMP_SEGUNDOS_POR_DEFECTO = 300; // 5 minutos, recomendado por Svix

export interface CabecerasSvix {
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
}

export type ResultadoVerificacion = { valido: true } | { valido: false; motivo: string };

function base64ABytes(b64: string): Uint8Array {
  const binario = atob(b64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** Quita el prefijo `whsec_` (si está) y decodifica el resto de base64 a
 * bytes crudos -- esa es la clave HMAC real (ver cabecera del fichero). */
function claveDesdeSecreto(secreto: string): Uint8Array {
  const sinPrefijo = secreto.startsWith("whsec_") ? secreto.slice("whsec_".length) : secreto;
  return base64ABytes(sinPrefijo);
}

/**
 * Tiempo constante de verdad: recorre TODOS los bytes sin cortocircuitar en
 * la primera diferencia (a diferencia de `===` sobre strings), y la propia
 * diferencia de longitud entra en el acumulador en vez de decidir el
 * resultado por su cuenta -- así ninguna rama del código depende de EN QUÉ
 * BYTE ni de SI LA LONGITUD difieren.
 */
export function compararEnTiempoConstante(a: Uint8Array, b: Uint8Array): boolean {
  const maxLen = Math.max(a.length, b.length);
  let diferencia = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    const byteA = i < a.length ? a[i] : 0;
    const byteB = i < b.length ? b[i] : 0;
    diferencia |= byteA ^ byteB;
  }
  return diferencia === 0;
}

async function firmarHmacSha256(claveBytes: Uint8Array, contenido: string): Promise<Uint8Array> {
  const clave = await crypto.subtle.importKey("raw", claveBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(contenido));
  return new Uint8Array(firma);
}

/**
 * Verifica un webhook de Resend/Svix: timestamp dentro de tolerancia +
 * firma HMAC-SHA256 válida. `cuerpo` DEBE ser el texto crudo tal cual llegó
 * (antes de cualquier JSON.parse) -- ver cabecera. No lanza nunca; el
 * motivo del rechazo es para logging (index.ts), nunca se lo devuelve al
 * llamante del webhook.
 */
export async function verificarWebhookResend(
  secreto: string,
  cabeceras: CabecerasSvix,
  cuerpo: string,
  ahoraEpochSegundos: number = Math.floor(Date.now() / 1000),
  toleranciaSegundos: number = TOLERANCIA_TIMESTAMP_SEGUNDOS_POR_DEFECTO,
): Promise<ResultadoVerificacion> {
  const { svixId, svixTimestamp, svixSignature } = cabeceras;
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { valido: false, motivo: "faltan_cabeceras_svix" };
  }

  const timestampSegundos = parseInt(svixTimestamp, 10);
  if (!Number.isFinite(timestampSegundos)) {
    return { valido: false, motivo: "timestamp_no_numerico" };
  }
  if (Math.abs(ahoraEpochSegundos - timestampSegundos) > toleranciaSegundos) {
    return { valido: false, motivo: "timestamp_fuera_de_tolerancia" };
  }

  let claveBytes: Uint8Array;
  try {
    claveBytes = claveDesdeSecreto(secreto);
  } catch {
    return { valido: false, motivo: "secreto_mal_formado" };
  }

  const contenidoFirmado = `${svixId}.${svixTimestamp}.${cuerpo}`;
  let firmaEsperada: Uint8Array;
  try {
    firmaEsperada = await firmarHmacSha256(claveBytes, contenidoFirmado);
  } catch {
    return { valido: false, motivo: "error_calculando_firma" };
  }

  // svix-signature puede traer varias firmas separadas por espacio
  // (rotación de secreto): "v1,firma1 v1,firma2 ...". Se comparan TODAS
  // (sin `break` al encontrar una válida) para que el coste temporal no
  // dependa de en qué posición estaba la firma buena -- mismo espíritu que
  // compararEnTiempoConstante.
  const partes = svixSignature.trim().split(/\s+/).filter(Boolean);
  let algunaCoincide = false;
  for (const parte of partes) {
    const idxComa = parte.indexOf(",");
    if (idxComa === -1) continue;
    const version = parte.slice(0, idxComa);
    const firmaB64 = parte.slice(idxComa + 1);
    if (version !== "v1") continue;
    let firmaRecibida: Uint8Array;
    try {
      firmaRecibida = base64ABytes(firmaB64);
    } catch {
      continue;
    }
    if (compararEnTiempoConstante(firmaEsperada, firmaRecibida)) algunaCoincide = true;
  }

  if (!algunaCoincide) return { valido: false, motivo: "firma_invalida" };
  return { valido: true };
}

/**
 * Decide si un webhook entrante se acepta (CT-REM-FN-04). FALLA CERRADO:
 * - sin RESEND_WEBHOOK_SECRET configurado -> 500 (no se procesa nada);
 * - firma ausente o inválida -> 401;
 * - firma correcta -> ok.
 */
export type AutenticacionWebhook =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string; motivo?: string };

export async function autenticarWebhookResend(
  secreto: string | undefined | null,
  cabeceras: CabecerasSvix,
  cuerpoCrudo: string,
): Promise<AutenticacionWebhook> {
  if (!secreto) return { ok: false, status: 500, error: "webhook_secret_not_configured" };
  const r = await verificarWebhookResend(secreto, cabeceras, cuerpoCrudo);
  if (!r.valido) return { ok: false, status: 401, error: "invalid_signature", motivo: r.motivo };
  return { ok: true };
}
