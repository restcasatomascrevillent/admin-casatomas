// ============================================================================
// FIRMA DEL IDENTIFICADOR DE SESION DEL CHAT (HMAC-SHA256, Web Crypto)
// ----------------------------------------------------------------------------
// Mismo patron que supabase/functions/reservas-web y
// supabase/functions/emails-reserva/tokens.ts (payload + firma HMAC-SHA256
// en base64url, `crypto.subtle.verify` para comparacion en tiempo
// constante). Reimplementado aqui, no importado de ahi: este proyecto no
// comparte codigo entre Edge Functions (ver enviar-newsletter/index.ts,
// comentario junto a hmacSign — cada funcion se despliega y versiona sola).
//
// QUE PROBLEMA CIERRA (auditoria docs/AUDITORIA-WEBS-2026-09-21.md §4,
// "Menores" — "id de sesion sin firmar"): antes, `id` en el body de
// chat-web era lo que mandara el cliente, SIN verificar. Pasar el id de
// otra persona (una cookie leida al vuelo, un log, una URL compartida por
// error...) daba acceso directo a su conversacion en
// chat_web_conversaciones/chat_web_mensajes, porque `sessionId = id +
// "_" + idioma` se usaba tal cual como clave de busqueda.
//
// DISENO ELEGIDO — firmar el identificador (la otra opcion del encargo,
// "derivar la clave de conversacion", NO cierra esto: un HMAC del `id` tal
// cual seria determinista, y quien copie el `id` ajeno obtendria la MISMA
// clave derivada que el dueno original — protege de enumerar/adivinar ids
// cortos, no de que alguien reenvie un id que ya conoce, que es el ataque
// descrito). Con firma:
//   - El `id` real (el UUID que se guarda en BD) lo elige SIEMPRE
//     chat-web/index.ts, nunca el cliente.
//   - El cliente solo guarda y reenvia el TOKEN firmado que chat-web le dio
//     la vez anterior (`"<id>.<firma>"`).
//   - Si el token que llega no verifica — falta, formato roto, firma que no
//     cuadra, o directamente el id "a pelo" de otra persona sin su firma —
//     se trata como visitante nuevo: id y token propios, memoria vacia.
//     NUNCA se reutiliza el historial de una sesion ajena solo porque
//     alguien escriba o copie su id en el body.
//
// SIN EXPIRACION (a diferencia de los tokens de confirmar/cancelar reserva,
// que caducan en 14 dias): esto no es un enlace de un solo uso sobre un
// recurso que cambia de estado, es solo continuidad de una conversacion
// anonima — forzar caducidad solo obligaria a "olvidar" el chat cada N dias
// sin cerrar ningun hueco de seguridad real.
// ============================================================================

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

/** Firma un id de sesion: `"<id>.<HMAC-SHA256(id) en base64url>"`. */
export async function firmarSessionToken(secreto: string, id: string): Promise<string> {
  const clave = await claveHmac(secreto);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(id));
  return `${id}.${base64UrlEncode(new Uint8Array(firma))}`;
}

/**
 * Verifica un token de sesion y devuelve el `id` que firma si la firma es
 * valida, o `null` ante cualquier problema (formato roto, firma que no
 * verifica, token o secreto vacios) — nunca lanza, mismo criterio "fail
 * closed y sin pistas" que emails-reserva/tokens.ts: no distingue el motivo
 * exacto del rechazo, solo trata/no trata el id como de fiar.
 */
export async function verificarSessionToken(secreto: string, token: string): Promise<string | null> {
  if (!secreto || !token) return null;

  // El id nunca lleva puntos (lo generamos nosotros con crypto.randomUUID),
  // pero se busca el ULTIMO punto por si acaso: asi el id nunca se trunca
  // aunque contuviera uno.
  const separador = token.lastIndexOf(".");
  if (separador <= 0 || separador === token.length - 1) return null;

  const id = token.slice(0, separador);
  const firmaB64 = token.slice(separador + 1);

  try {
    const clave = await claveHmac(secreto);
    const valido = await crypto.subtle.verify(
      "HMAC",
      clave,
      base64UrlDecode(firmaB64),
      new TextEncoder().encode(id),
    );
    return valido ? id : null;
  } catch {
    // Firma en base64url invalido (p.ej. no decodifica) u otro fallo de
    // Web Crypto: se trata igual que una firma que no verifica.
    return null;
  }
}
