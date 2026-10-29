/**
 * Nombres de las fotos de carta en el bucket `vinos` (sin migración). Sin
 * imports a propósito: lo usa también scripts/fotos-vino/ desde Node.
 *
 *   - Foto procesada desde una ya subida: `<base>-carta-<ext>.webp`, p. ej.
 *     `6d6c….webp` → `6d6c…-carta-webp.webp`. El original NO se toca, y su
 *     ruta se deduce del nombre: «Deshacer» = volver a `<base>.<ext>`.
 *   - Alta nueva ya compuesta en el panel: `<id>-carta.webp` (sin original
 *     guardado: no hay nada que deshacer).
 *   Cualquier ruta con `-carta` antes de la extensión cuenta como procesada.
 */
export const RE_CARTA = /-carta(?:-([a-z0-9]+))?\.(webp|jpe?g|png)$/i;

/** true si la ruta/URL ya es una foto de carta (procesada). */
export function esFotoCarta(rutaOUrl: string | null | undefined): boolean {
  if (!rutaOUrl) return false;
  return RE_CARTA.test(rutaOUrl.split("?")[0].split("#")[0]);
}

/** Ruta de la foto de carta derivada de la original: `a/b.jpeg` → `a/b-carta-jpeg.webp`. */
export function rutaCartaDesdeOriginal(ruta: string, extSalida: "webp" | "jpg" = "webp"): string {
  const limpia = ruta.split("?")[0].split("#")[0];
  const punto = limpia.lastIndexOf(".");
  const barra = limpia.lastIndexOf("/");
  if (punto <= barra) return `${limpia}-carta-sinext.${extSalida}`;
  const base = limpia.slice(0, punto);
  const ext = limpia.slice(punto + 1).toLowerCase();
  return `${base}-carta-${ext}.${extSalida}`;
}

/**
 * Ruta/URL original a partir de la de carta (`…-carta-webp.webp` → `….webp`).
 * null si no es de carta o no guarda la extensión original (alta nueva).
 * Quita el `?t=` de la URL.
 */
export function rutaOriginalDesdeCarta(rutaOUrl: string | null | undefined): string | null {
  if (!rutaOUrl) return null;
  const limpia = rutaOUrl.split("?")[0].split("#")[0];
  const m = RE_CARTA.exec(limpia);
  if (!m || !m[1] || m[1] === "sinext") return null;
  return `${limpia.slice(0, m.index)}.${m[1]}`;
}

/** Nombre del archivo en Storage para una foto subida desde un formulario. */
export function nombreSubida(id: string, archivo: File): string {
  const ext = (archivo.name.split(".").pop() || "jpg").toLowerCase();
  return esFotoCarta(archivo.name) ? `${id}-carta.${ext}` : `${id}.${ext}`;
}
