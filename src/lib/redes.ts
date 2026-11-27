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

/** Entrada embebida de rrss. El pase NO va en la dirección: se entrega por postMessage. */
export function urlEmbebida(origen: string): string {
  return `${origen}/embed`;
}

/** Huella SHA-256 en base64url (43 caracteres) que manda el iframe de rrss. */
export function esHuella(valor: unknown): valor is string {
  return typeof valor === "string" && /^[A-Za-z0-9_-]{43}$/.test(valor);
}

/**
 * ¿La historia del jueves de tapas la hace Redes (rrss) y no la story antigua? Sí en cuanto
 * Redes está configurada en este entorno: así nunca salen las dos (lib/redesTapas.ts).
 */
export function tapasPorRedes(valor: unknown = import.meta.env.VITE_RRSS_URL): boolean {
  return origenRrss(valor) !== null;
}
