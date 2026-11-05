/**
 * Limpieza diaria del bucket «instagram» (acción «limpiar» de
 * instagram-programador; la llama el cron «instagram-limpieza-bucket» de la
 * migración 20261107010000_instagram_limpieza_bucket con el mismo secreto).
 *
 *  1. JPEG de piezas que llevan DIAS_JPEG_SIN_PUBLICAR días sin publicarse:
 *     la RPC instagram_piezas_reclamar_jpeg_caducados los marca
 *     (imagen_borrada_at) y devuelve sus rutas; luego se borran por la API de
 *     Storage (borrar filas de storage.objects dejaría el fichero huérfano).
 *     La RPC NUNCA devuelve una pieza con una programación activa
 *     (programada o publicando): una programación puede ir a 75 días vista y
 *     publica justo ese JPEG. Tampoco una publicada ni una que se está
 *     publicando (cerrojo). Al volver a generar la pieza, imagen_borrada_at
 *     vuelve a null.
 *  2. Copias tmp/ de fotos de Drive y de la carta de más de 24 h (las mismas
 *     que ya borra instagram-drive al preparar otra). Ninguna programación
 *     depende de tmp/: el JPEG de la pieza ya lleva la foto dentro.
 *
 * Con la clave de servicio (sin usuario). Nunca lanza por un fichero suelto:
 * lo cuenta en `avisos`.
 */
import { limpiarTmp } from "../instagram-drive/drive.ts";
import { borrarObjetos, type Sesion } from "../_shared/instagram/supabase.ts";
import { sanear } from "../_shared/instagram/secretos.ts";

/** Días sin publicar tras los que se borra el JPEG de una pieza (sin programación activa). */
export const DIAS_JPEG_SIN_PUBLICAR = 7;
/** Piezas por pasada (la siguiente noche sigue con el resto). */
export const MAX_JPEG_POR_PASADA = 100;

export interface ResultadoLimpieza {
  jpegMarcados: number;
  jpegBorrados: number;
  tmpBorrados: number;
  avisos: string[];
}

export async function limpiarBucket(s: Sesion, ahora: () => number = Date.now): Promise<ResultadoLimpieza> {
  const avisos: string[] = [];
  let filas: Array<{ id: string; imagen_ruta: string }> = [];
  const r = await s.fetch(`${s.sb.url}/rest/v1/rpc/instagram_piezas_reclamar_jpeg_caducados`, {
    method: "POST",
    headers: { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ p_dias: DIAS_JPEG_SIN_PUBLICAR, p_limite: MAX_JPEG_POR_PASADA }),
    signal: AbortSignal.timeout(15_000),
  });
  const texto = await r.text().catch(() => "");
  if (r.ok) {
    const v = texto ? (JSON.parse(texto) as unknown) : [];
    filas = Array.isArray(v) ? (v as Array<{ id: string; imagen_ruta: string }>).filter((f) => typeof f?.imagen_ruta === "string") : [];
  } else {
    avisos.push(sanear(`No se pudieron buscar los JPEG caducados (${r.status}): ${texto.slice(0, 200)}`));
  }
  // Solo rutas de piezas/ (nunca fotos/ ni tmp/ por esta vía).
  const rutas = filas.map((f) => f.imagen_ruta).filter((ruta) => /^piezas\//.test(ruta));
  let jpegBorrados = 0;
  for (let i = 0; i < rutas.length; i += 50) jpegBorrados += await borrarObjetos(s, rutas.slice(i, i + 50));
  if (jpegBorrados < rutas.length) avisos.push(`${rutas.length - jpegBorrados} JPEG marcados como borrados no estaban en el bucket (o no se pudieron borrar).`);
  const tmpBorrados = await limpiarTmp(s, ahora);
  return { jpegMarcados: filas.length, jpegBorrados, tmpBorrados, avisos };
}
