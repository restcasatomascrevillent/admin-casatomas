/**
 * Redes (rrss embebido, 23/11/2026): dónde está rrss y cómo se abre.
 * `VITE_RRSS_URL` es la dirección de rrss (p. ej. https://rrss-omega.vercel.app). Tiene que estar
 * también en `frame-src` de la CSP del panel (vercel.json) y, en rrss, este panel en sus orígenes
 * permitidos (EMBED_FRAME_ANCESTORS y la integración). Ver docs/redes-rrss.md.
 */

/** Origen de rrss (https), o null si no está configurado o no es válido. */
export function origenRrss(valor: unknown = import.meta.env.VITE_RRSS_URL): string | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  try {
    const url = new URL(valor.trim());
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Entrada embebida de rrss con el pase en el fragmento (no se envía al servidor ni sale en el Referer). */
export function urlEmbebida(origen: string, pase: string): string {
  return `${origen}/embed#pass=${encodeURIComponent(pase)}`;
}
