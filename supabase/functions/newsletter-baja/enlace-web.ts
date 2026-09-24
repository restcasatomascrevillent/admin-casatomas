// ============================================================================
// Enlace de baja del newsletter -> página de la web de Casa Tomás (lógica pura)
// ----------------------------------------------------------------------------
// Supabase fuerza `Content-Type: text/plain` en las respuestas del dominio
// `*.supabase.co/functions/v1/...`: la página HTML de baja le llegaba al
// suscriptor como código fuente. La página la sirve ahora la web
// (https://restaurantecasatomascrevillente.es/newsletter/baja?sid&via&sig)
// y habla con esta función en JSON (`?formato=json`):
//   GET  ?sid&via&sig&formato=json -> estado (NO muta)
//   POST ?sid&via&sig&formato=json -> baja real
// Sin `formato=json`:
//   GET  -> 302 a la web con los mismos parámetros (enlaces ya enviados)
//   POST -> baja "one-click" de Gmail/Outlook (RFC 8058), sin cambios
// Importable desde vitest (sin sintaxis Deno).
// ============================================================================

export const URL_BAJA_WEB_POR_DEFECTO = "https://restaurantecasatomascrevillente.es/newsletter/baja";

/** Base de la página de baja: env `NEWSLETTER_BAJA_WEB_URL` si es una URL http(s) válida. */
export function baseBajaWeb(env: string | null | undefined): string {
  const v = (env ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+/i.test(v) ? v : URL_BAJA_WEB_POR_DEFECTO;
}

export function urlBajaWeb(base: string, sid: string, via: string, sig: string): string {
  const qs = new URLSearchParams({ sid, via, sig });
  return `${base}?${qs.toString()}`;
}

/** La llamada viene de la web (JSON) y no de un navegador o del one-click. */
export function quiereJson(url: URL): boolean {
  return url.searchParams.get("formato") === "json";
}

/** Contrato JSON que consume la web (casa-tomas-story/src/lib/newsletter-baja.ts). */
export type EstadoBaja = "confirmar" | "baja_hecha" | "ya_estaba" | "invalido" | "error";

export interface RespuestaBaja {
  ok: boolean;
  estado: EstadoBaja;
  email: string | null;
  fecha_baja: string | null;
}

export function respuestaBaja(estado: EstadoBaja, email: string | null = null, fechaBaja: string | null = null): RespuestaBaja {
  return {
    ok: estado === "confirmar" || estado === "baja_hecha" || estado === "ya_estaba",
    estado,
    email: estado === "invalido" || estado === "error" ? null : email,
    fecha_baja: fechaBaja,
  };
}
