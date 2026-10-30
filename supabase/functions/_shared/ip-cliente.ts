// ============================================================================
//  IP del cliente detrás de la pasarela de Supabase (CT-REM-FN-03)
// ----------------------------------------------------------------------------
//  Las Edge Functions van detrás de Cloudflare:
//   · `cf-connecting-ip` lo pone la plataforma y sobrescribe lo que mande el
//     cliente → es la fuente preferida.
//   · `x-forwarded-for` NO es fiable en su PRIMERA posición: el cliente puede
//     mandar su propia cabecera y la plataforma CONCATENA la IP real al final
//     (https://github.com/orgs/supabase/discussions/34647). De ahí solo se usa
//     el ÚLTIMO salto.
//  Antes, `panel-auth` y el envoltorio de auditoría tomaban el primer salto, así
//  que rotar `X-Forwarded-For` esquivaba el límite de intentos por IP de
//  `iniciar_intento_panel` y falseaba la IP del registro de auditoría.
//  Misma regla que `chat-web/index.ts › ipCliente` (no se toca esa función).
// ============================================================================

const LONGITUD_MAXIMA = 128;

/** IP del cliente o "" si la petición no trae ninguna cabecera de IP. */
export function ipCliente(req: Request | Headers): string {
  const headers = req instanceof Headers ? req : req.headers;
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, LONGITUD_MAXIMA);
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const saltos = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (saltos.length) return saltos[saltos.length - 1].slice(0, LONGITUD_MAXIMA);
  }
  return "";
}
