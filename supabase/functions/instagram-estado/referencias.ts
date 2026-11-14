/**
 * instagram-estado, acción «referencias» (12/11/2026): SOLO LECTURA. Devuelve
 * las últimas publicaciones y las stories activas (24 h) de la cuenta de
 * Instagram de una marca, para usarlas en el panel como referencia de estilo.
 *
 *   Petición: POST { accion: "referencias", marca?: "casa-tomas" | "touza" }
 *             (por defecto casa-tomas), con la misma sesión y el mismo permiso
 *             («Ver» en Marketing) que el GET de instagram-estado.
 *   200: { ok: true, marca, cuenta: { igUserId, username }, publicaciones: Medio[],
 *          stories: Medio[], avisos: string[] }
 *        Medio = { id, tipo: "imagen"|"video"|"carrusel"|"reel"|"story", mediaUrl,
 *                  miniaturaUrl, permalink, caption, fecha }
 *   400 marca desconocida · 503 faltan secretos de la cuenta de la marca (con
 *   «comoArreglarlo») · 502 Meta respondió con error (traducido y saneado).
 *
 * Cuenta: leerConfigMetaMarca (en producción IG_USER_ID_<MARCA> e
 * IG_ACCESS_TOKEN_<MARCA>; en la demo cae en IG_USER_ID / IG_ACCESS_TOKEN).
 * Si las stories fallan (p. ej. permisos), lista vacía + aviso: no se cae todo.
 * Las URLs de Meta caducan: el panel no las guarda. El token nunca sale
 * (json() sanea la respuesta y ClienteGraph lo registra como secreto).
 */
import { ClienteGraph, type FuncionFetch } from "../_shared/instagram/cliente.ts";
import { esMarcaCuenta, leerConfigMetaMarca, type Entorno, type MarcaCuenta } from "../_shared/instagram/entorno.ts";
import { ErrorInstagram } from "../_shared/instagram/errores.ts";
import { json } from "../_shared/instagram/http.ts";
import { mensajeSaneado, registro } from "../_shared/instagram/secretos.ts";

export type TipoReferencia = "imagen" | "video" | "carrusel" | "reel" | "story";

export interface MedioReferencia {
  id: string;
  tipo: TipoReferencia;
  mediaUrl: string | null;
  miniaturaUrl: string | null;
  permalink: string | null;
  caption: string | null;
  fecha: string | null;
}

export interface DependenciasReferencias {
  env: Entorno;
  fetch?: FuncionFetch | undefined;
  dormir?: ((ms: number) => Promise<void>) | undefined;
}

/** Tiempo total máximo de la acción (ms): nada pasa de aquí. */
const LIMITE_TOTAL_MS = 15_000;

const CAMPOS_MEDIA = "id,media_type,media_product_type,media_url,thumbnail_url,permalink,caption,timestamp,username";
const CAMPOS_STORIES = "id,media_type,media_url,thumbnail_url,permalink,timestamp";

interface MedioMeta {
  id?: string | number;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  caption?: string;
  timestamp?: string;
  username?: string;
}

function tipoDe(m: MedioMeta, esStory: boolean): TipoReferencia {
  if (esStory) return "story";
  if (m.media_product_type === "REELS" || m.media_type === "VIDEO") return "reel";
  if (m.media_type === "CAROUSEL_ALBUM") return "carrusel";
  return "imagen";
}

export function mapearMedio(m: MedioMeta, esStory = false): MedioReferencia | null {
  if (m.id === undefined || m.id === null || m.id === "") return null;
  const tipo = tipoDe(m, esStory);
  const esVideo = m.media_type === "VIDEO";
  const mediaUrl = m.media_url ?? null;
  return {
    id: String(m.id),
    tipo,
    mediaUrl,
    // Vídeos: la miniatura es thumbnail_url (media_url es el .mp4).
    miniaturaUrl: m.thumbnail_url ?? (esVideo ? null : mediaUrl),
    permalink: m.permalink ?? null,
    caption: typeof m.caption === "string" ? m.caption : null,
    fecha: m.timestamp ?? null,
  };
}

function errorMeta(e: unknown): Response {
  if (e instanceof ErrorInstagram) {
    return json(502, { ok: false, error: e.message, tipo: e.tipo, comoArreglarlo: e.comoArreglarlo, detalleMeta: e.detalleMeta });
  }
  return json(500, { ok: false, error: "No se pudo leer la cuenta de Instagram", detalle: mensajeSaneado(e) });
}

export async function manejarReferencias(cuerpo: unknown, deps: DependenciasReferencias): Promise<Response> {
  const pedida = (cuerpo as { marca?: unknown } | null)?.marca;
  if (pedida !== undefined && pedida !== null && !esMarcaCuenta(pedida)) {
    return json(400, { ok: false, error: "Marca desconocida: usa «casa-tomas» o «touza»" });
  }
  const marca: MarcaCuenta = esMarcaCuenta(pedida) ? pedida : "casa-tomas";

  const leido = leerConfigMetaMarca(deps.env, marca);
  if (!leido.ok) {
    return json(503, {
      ok: false,
      marca,
      error: `Falta configurar la cuenta de Instagram de ${marca === "touza" ? "Touza" : "Casa Tomás"}`,
      faltan: leido.problemas.map((p) => p.variable),
      comoArreglarlo: leido.problemas.map((p) => `${p.variable}: ${p.problema}. ${p.comoArreglarlo}`),
    });
  }
  const { config } = leido;
  const cliente = new ClienteGraph({
    token: config.token,
    versionApi: config.versionApi,
    igUserId: config.igUserId,
    fetch: deps.fetch,
    dormir: deps.dormir,
    timeoutMs: 12_000,
    reintentos: 1,
    limite: Date.now() + LIMITE_TOTAL_MS,
  });
  const id = encodeURIComponent(config.igUserId);
  const avisos: string[] = [];

  try {
    const [media, stories] = await Promise.all([
      cliente.peticion<{ data?: MedioMeta[] }>("GET", `/${id}/media`, { consulta: { fields: CAMPOS_MEDIA, limit: "30" } }),
      cliente.peticion<{ data?: MedioMeta[] }>("GET", `/${id}/stories`, { consulta: { fields: CAMPOS_STORIES } }).catch((e: unknown) => {
        registro("warn", "instagram-estado", "referencias: stories", e);
        avisos.push(`No se pudieron leer las stories activas: ${e instanceof ErrorInstagram ? e.message : mensajeSaneado(e)}`);
        return { data: [] as MedioMeta[] };
      }),
    ]);
    const datos = media.data ?? [];
    const publicaciones = datos.map((m) => mapearMedio(m)).filter((m): m is MedioReferencia => m !== null);
    const listaStories = (stories.data ?? []).map((m) => mapearMedio(m, true)).filter((m): m is MedioReferencia => m !== null);
    const username = datos.find((m) => typeof m.username === "string")?.username ?? null;
    return json(200, { ok: true, marca, cuenta: { igUserId: config.igUserId, username }, publicaciones, stories: listaStories, avisos });
  } catch (e) {
    registro("error", "instagram-estado", "referencias", e);
    return errorMeta(e);
  }
}
