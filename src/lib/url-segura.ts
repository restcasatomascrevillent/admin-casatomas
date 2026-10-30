/**
 * Enlaces externos seguros (CT-REM-FE-06).
 *
 * Las URLs que vienen de BD o de funciones de búsqueda web (driveUrl,
 * fuentesTienda...) no son de confianza: `javascript:` o `data:` en un `href`
 * ejecutaría código al pulsar. Solo se enlaza lo que parsea como URL absoluta
 * con un esquema de la lista blanca; lo demás devuelve `null` y NO se pinta
 * el enlace.
 */
export type EsquemaPermitido = "http:" | "https:" | "mailto:" | "tel:";

const WEB: readonly EsquemaPermitido[] = ["http:", "https:"];

export function urlSegura(
  url: string | null | undefined,
  esquemas: readonly EsquemaPermitido[] = WEB,
): string | null {
  if (typeof url !== "string") return null;
  const limpia = url.trim();
  if (!limpia) return null;
  try {
    const parsed = new URL(limpia);
    return esquemas.includes(parsed.protocol as EsquemaPermitido) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** true si la URL es http(s) absoluta. */
export function esUrlHttp(url: string | null | undefined): boolean {
  return urlSegura(url) !== null;
}
