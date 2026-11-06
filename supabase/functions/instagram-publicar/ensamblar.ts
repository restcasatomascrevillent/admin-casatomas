/**
 * Carrusel a partir de piezas sueltas (contrato del panel, 05/11/2026): el
 * Crear de escritorio y el móvil generan cada imagen con una llamada a
 * /api/instagram-render (una pieza «generada» por imagen) y luego publican o
 * programan con `ids: [uuid, …]` (2–10, en orden). Aquí se juntan en UNA
 * pieza carrusel (tipo_medio = formato = 'carrusel', migración 20261112000000)
 * y el resto del flujo es el del carrusel (carrusel.ts).
 *
 *  - Id del carrusel DETERMINISTA (SHA-256 de los ids en orden): repetir la
 *    misma petición (reintento, 202 «en_proceso» con contenedorId) llega al
 *    mismo carrusel y no crea otro.
 *  - Todo COMO EL USUARIO (su JWT; la RLS decide): lee las piezas, copia sus
 *    JPEG a piezas/AAAA-MM/<carrusel>-NN.jpg (Storage /object/copy), crea la
 *    fila del carrusel y, solo entonces, borra las piezas sueltas y sus JPEG
 *    (sus datos ya están en las diapositivas). Si algo falla antes de crear la
 *    fila, las piezas sueltas siguen intactas.
 *  - Cada pieza: imagen 1080×1350 (formato post), de la misma marca, sin
 *    publicar, con su JPEG en el bucket y sin programación activa.
 */
import { registro, sanear } from "../_shared/instagram/secretos.ts";
import { BUCKET, leerPiezaCompleta, type FilaDiapositiva, type FilaPieza, type Sesion } from "../_shared/instagram/supabase.ts";

const ETIQUETA = "instagram-publicar";
const MS_TIEMPO = 15_000;

export const MIN_IDS_CARRUSEL = 2;
export const MAX_IDS_CARRUSEL = 10;

function cabeceras(s: Sesion, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, ...extra };
}

async function textoError(r: Response): Promise<string> {
  const t = await r.text().catch(() => "");
  try {
    const j = JSON.parse(t) as { message?: string; error?: string };
    return sanear(j.message ?? j.error ?? t).slice(0, 300);
  } catch {
    return sanear(t).slice(0, 300);
  }
}

/** Id del carrusel de esas piezas (mismo orden → mismo id). UUID con forma v5. */
export async function idCarrusel(ids: string[]): Promise<string> {
  const datos = new TextEncoder().encode(`instagram-carrusel:${ids.map((i) => i.toLowerCase()).join(",")}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", datos)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export type ResultadoEnsamblar = { ok: true; id: string; nuevo: boolean } | { ok: false; estado: number; cuerpo: Record<string, unknown> };

const error = (estado: number, mensaje: string, extra: Record<string, unknown> = {}): ResultadoEnsamblar => ({ ok: false, estado, cuerpo: { ok: false, error: mensaje, ...extra } });

/** Junta las piezas `ids` (2–10, en orden) en un carrusel. Devuelve su id. */
export async function ensamblarCarrusel(s: Sesion, ids: string[], o: { ahora?: () => number } = {}): Promise<ResultadoEnsamblar> {
  if (new Set(ids).size !== ids.length) return error(400, "«ids» tiene piezas repetidas");
  const id = await idCarrusel(ids);

  // ¿Ya está montado (reintento)? Se usa tal cual.
  try {
    const ya = await leerPiezaCompleta(s, id);
    if (ya) {
      if (ya.tipo_medio !== "carrusel") return error(409, "Conflicto de id al montar el carrusel");
      return { ok: true, id, nuevo: false };
    }
  } catch (e) {
    return error(500, sanear((e as Error).message));
  }

  // Las piezas sueltas, como el usuario.
  const piezas: FilaPieza[] = [];
  try {
    for (const pid of ids) {
      const p = await leerPiezaCompleta(s, pid);
      if (!p) return error(404, `No existe la pieza ${pid} (o no tienes acceso)`);
      piezas.push(p);
    }
  } catch (e) {
    return error(500, sanear((e as Error).message));
  }
  const problemas: string[] = [];
  piezas.forEach((p, i) => {
    const n = `Imagen ${i + 1}`;
    if (p.media_id || p.estado === "publicada") problemas.push(`${n}: ya está publicada`);
    if ((p.tipo_medio ?? "imagen") !== "imagen" || p.formato !== "post") problemas.push(`${n}: tiene que ser una imagen de feed (1080×1350), no ${p.formato}`);
    if (!p.imagen_ruta) problemas.push(`${n}: no tiene imagen (genérala antes)`);
    if (p.imagen_borrada_at) problemas.push(`${n}: su imagen se borró por llevar días sin publicarse (vuelve a generarla)`);
    if (p.marca !== piezas[0].marca) problemas.push(`${n}: es de otra marca (${p.marca})`);
  });
  if (problemas.length) return error(422, "Esas piezas no se pueden juntar en un carrusel", { problemas });

  // Ninguna con una programación activa (se borrarían con ella).
  try {
    const r = await s.fetch(
      `${s.sb.url}/rest/v1/instagram_programaciones?pieza_id=in.(${ids.join(",")})&estado=in.(programada,publicando)&select=pieza_id`,
      { headers: cabeceras(s, { Accept: "application/json" }), signal: AbortSignal.timeout(MS_TIEMPO) },
    );
    if (r.ok) {
      const filas = (await r.json().catch(() => [])) as Array<{ pieza_id: string }>;
      if (Array.isArray(filas) && filas.length) {
        return error(409, "Alguna de esas imágenes tiene una publicación programada: cancélala antes de juntarlas en un carrusel", { tipo: "programada" });
      }
    }
  } catch {
    /* sin la tabla (no pasa en producción): se sigue */
  }

  // Copias de los JPEG con las rutas del carrusel (las exige el CHECK de la tabla).
  const mes = new Date((o.ahora ?? Date.now)()).toISOString().slice(0, 7);
  const rutas = piezas.map((_, i) => `piezas/${mes}/${id}-${String(i + 1).padStart(2, "0")}.jpg`);
  try {
    // Restos de un intento anterior a medias (sin fila): fuera.
    await s.fetch(`${s.sb.url}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: cabeceras(s, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: rutas }),
      signal: AbortSignal.timeout(MS_TIEMPO),
    }).catch(() => null);
    for (let i = 0; i < piezas.length; i++) {
      const r = await s.fetch(`${s.sb.url}/storage/v1/object/copy`, {
        method: "POST",
        headers: cabeceras(s, { "Content-Type": "application/json" }),
        body: JSON.stringify({ bucketId: BUCKET, sourceKey: piezas[i].imagen_ruta, destinationKey: rutas[i] }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) return error(502, `No se pudo copiar la imagen ${i + 1} para el carrusel (${r.status}): ${await textoError(r)}`);
    }
  } catch (e) {
    return error(502, sanear(`No se pudieron copiar las imágenes del carrusel: ${(e as Error)?.message ?? e}`));
  }

  // La fila del carrusel (como el render: «generada», con el JWT del usuario).
  const diapositivas: FilaDiapositiva[] = piezas.map((p, i) => {
    const datos = (p.datos ?? {}) as Record<string, unknown>;
    return { foto: typeof datos.foto === "string" ? datos.foto : null, plantilla: p.plantilla, datos, alt_text: p.alt_text ?? null, imagen_ruta: rutas[i] };
  });
  const portada = piezas[0];
  const fila = {
    id,
    marca: portada.marca,
    plantilla: portada.plantilla,
    formato: "carrusel",
    tipo_medio: "carrusel",
    datos: portada.datos ?? {},
    caption: portada.caption ?? null,
    estado: "generada",
    imagen_ruta: rutas[0],
    diapositivas,
  };
  try {
    const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas`, {
      method: "POST",
      headers: cabeceras(s, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify(fila),
      signal: AbortSignal.timeout(MS_TIEMPO),
    });
    if (!r.ok) {
      const t = await textoError(r);
      if (/diapositivas|tipo_medio|carrusel|PGRST204|42703|23514/.test(t)) {
        return error(503, "Falta aplicar la migración 20261112000000_instagram_carrusel (carruseles)", { detalle: t });
      }
      return error(r.status === 403 || r.status === 401 ? 403 : 500, `No se pudo guardar el carrusel (${r.status}): ${t}`);
    }
  } catch (e) {
    return error(500, sanear(`No se pudo guardar el carrusel: ${(e as Error)?.message ?? e}`));
  }

  // Las piezas sueltas sobran (sus datos están en las diapositivas). Si no se
  // pueden borrar, se quedan en el historial y la limpieza quita sus JPEG.
  try {
    await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas?id=in.(${ids.join(",")})`, {
      method: "DELETE",
      headers: cabeceras(s, { Prefer: "return=minimal" }),
      signal: AbortSignal.timeout(MS_TIEMPO),
    });
    await s.fetch(`${s.sb.url}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: cabeceras(s, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: piezas.map((p) => p.imagen_ruta) }),
      signal: AbortSignal.timeout(MS_TIEMPO),
    });
  } catch (e) {
    registro("warn", ETIQUETA, "carrusel montado, pero no se pudieron borrar las piezas sueltas", e);
  }
  registro("info", ETIQUETA, "carrusel montado", { id, imagenes: ids.length, usuario: s.usuario });
  return { ok: true, id, nuevo: true };
}
