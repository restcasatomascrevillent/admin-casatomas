/**
 * Lógica pura (sin DOM) del aviso de versión nueva del panel. Separada para
 * poder probarla sin navegador.
 */

/** Clave de sessionStorage: id del build al que ya se intentó recargar. */
export const CLAVE_RECARGA = "panel-recarga-version";

/** Hay versión nueva si el servidor publica un id distinto del embebido. */
export function hayVersionNueva(idLocal: string, idRemoto: string | null | undefined): boolean {
  return typeof idRemoto === "string" && idRemoto.length > 0 && idRemoto !== idLocal;
}

/**
 * Antibucle: si ya recargamos una vez buscando `idRemoto` y seguimos con el
 * código viejo (CDN o caché desfasados), no se vuelve a recargar sola.
 */
export function puedeRecargarSola(idRemoto: string, idYaIntentado: string | null): boolean {
  return idYaIntentado !== idRemoto;
}

/** Lee el id del build de la respuesta de /version.json. */
export function leerIdVersion(json: unknown): string | null {
  if (json && typeof json === "object" && "id" in json) {
    const id = (json as { id: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}
