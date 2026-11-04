/**
 * Métricas (insights) de Instagram con la Graph API v26.0 y el MISMO cliente
 * que publicar (`ClienteGraph.peticion`: token en `Authorization: Bearer`,
 * reintentos, saneado y errores en castellano). No cambia el cliente: solo lo
 * usa. Lo usa la Edge Function instagram-metricas.
 *
 * Fuente (consultada el 04/11/2026; la referencia ya va por v27.0 y no marca
 * cambios en estas métricas):
 *  - Cuenta: developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights
 *    GET /{ig-user-id}/insights?metric=…&period=day&metric_type=total_value&since&until
 *    Métricas «day» con total_value: reach, views, accounts_engaged,
 *    total_interactions, likes, comments, saves, shares, profile_links_taps
 *    (también replies, reposts, follows_and_unfollows).
 *    `impressions` está retirada (v22.0+ y todas las versiones desde el
 *    21/04/2025): la sustituye `views`.
 *    `profile_views` (visitas al perfil) NO figura en esa tabla: se pide en
 *    una llamada aparte y, si Meta la rechaza, queda en null con un aviso.
 *    Los datos pueden tardar hasta 48 h; sin datos Meta da una lista vacía
 *    (no 0). Seguidores: campo `followers_count` del nodo IG User.
 *  - Publicación: developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights
 *    GET /{ig-media-id}/insights?metric=… (period lifetime).
 *    FEED y REELS: reach, likes, comments, saved, shares, views,
 *    total_interactions. STORY: reach, views, shares, total_interactions
 *    (solo 24 h; valores < 5 dan error 10). Sin insights para los hijos de
 *    un carrusel. Meta guarda las métricas hasta 2 años.
 *  - Permisos (Unified login, token de usuario del sistema, graph.facebook.com):
 *    instagram_basic + instagram_manage_insights.
 */
import type { ClienteGraph } from "./cliente.ts";
import { ErrorInstagram } from "./errores.ts";
import { sanear } from "./secretos.ts";

export const PERMISO_INSIGHTS = "instagram_manage_insights";

export const METRICAS_CUENTA = [
  "reach",
  "views",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "saves",
  "shares",
  "profile_links_taps",
] as const;
export const METRICA_VISITAS_PERFIL = "profile_views";

export const METRICAS_MEDIO = ["reach", "likes", "comments", "saved", "shares", "views", "total_interactions"] as const;
/** Si Meta rechaza alguna de las «en desarrollo» (views, total_interactions) en una publicación antigua. */
export const METRICAS_MEDIO_BASICAS = ["reach", "likes", "comments", "saved", "shares"] as const;
export const METRICAS_HISTORIA = ["reach", "views", "shares", "total_interactions"] as const;

const CAMPOS_MEDIO = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";

export interface ValoresCuenta {
  alcance: number | null;
  visualizaciones: number | null;
  cuentasInteraccion: number | null;
  interacciones: number | null;
  meGusta: number | null;
  comentarios: number | null;
  guardados: number | null;
  compartidos: number | null;
  toquesEnlaces: number | null;
}

export interface MedioIg {
  id: string;
  caption: string | null;
  tipoMedio: string | null;
  producto: string | null;
  permalink: string | null;
  miniatura: string | null;
  publicadoAt: string | null;
  meGusta: number | null;
  comentarios: number | null;
}

export interface ValoresMedio {
  alcance: number | null;
  meGusta: number | null;
  comentarios: number | null;
  guardados: number | null;
  compartidos: number | null;
  visualizaciones: number | null;
  interacciones: number | null;
}

interface FilaInsight {
  name?: string;
  values?: Array<{ value?: unknown }>;
  total_value?: { value?: unknown };
}

function entero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

/** nombre → valor (total_value.value o, si no, values[0].value). Lo que no venga queda fuera. */
export function leerValores(r: { data?: FilaInsight[] } | null | undefined): Record<string, number | null> {
  const salida: Record<string, number | null> = {};
  for (const fila of r?.data ?? []) {
    if (!fila?.name) continue;
    const v = entero(fila.total_value?.value) ?? entero(fila.values?.[0]?.value);
    salida[fila.name] = v;
  }
  return salida;
}

/** ¿Es el error de Meta de que al token le falta instagram_manage_insights? */
export function esFaltaPermisoInsights(e: unknown): boolean {
  if (!(e instanceof ErrorInstagram)) return false;
  if (e.tipo === "permisos") return true;
  return /instagram_manage_insights/i.test(`${e.message} ${e.detalleMeta ?? ""}`);
}

export const COMO_ANADIR_PERMISO_INSIGHTS =
  `Al token le falta el permiso ${PERMISO_INSIGHTS}. Añádelo en Meta Business Suite → Configuración del negocio → ` +
  "Usuarios → Usuarios del sistema → (tu usuario) → «Generar token»: elige la app y marca instagram_basic, " +
  `instagram_content_publish e ${PERMISO_INSIGHTS} (caducidad «Nunca»). Si el permiso no sale en la lista, ` +
  "añádelo antes a la app en developers.facebook.com → (app) → Casos de uso / Permisos. Cambia después el secreto " +
  "IG_ACCESS_TOKEN en Supabase (`npx supabase secrets set IG_ACCESS_TOKEN=… --project-ref <ref>` o Dashboard → " +
  "Edge Functions → Secrets; no hace falta volver a desplegar) y pulsa «Actualizar ahora». Detalle en docs/instagram-metricas.md.";

/** El error de permiso con el «cómo arreglarlo» propio de las métricas. */
export function errorPermisoInsights(origen?: ErrorInstagram): ErrorInstagram {
  return new ErrorInstagram({
    tipo: "permisos",
    mensaje: `Al token de Instagram le falta el permiso ${PERMISO_INSIGHTS} para leer las métricas${origen?.detalleMeta ? ` — Meta dice: «${origen.detalleMeta}»` : ""}`,
    comoArreglarlo: COMO_ANADIR_PERMISO_INSIGHTS,
    codigo: origen?.codigo ?? null,
    subcodigo: origen?.subcodigo ?? null,
    estadoHttp: origen?.estadoHttp ?? null,
    fbtraceId: origen?.fbtraceId ?? null,
    detalleMeta: origen?.detalleMeta ?? null,
  });
}

/** Totales de la cuenta entre dos instantes (segundos Unix). */
export async function insightsCuenta(c: ClienteGraph, igUserId: string, desde: number, hasta: number): Promise<ValoresCuenta> {
  const r = await c.peticion<{ data?: FilaInsight[] }>("GET", `/${encodeURIComponent(igUserId)}/insights`, {
    consulta: {
      metric: METRICAS_CUENTA.join(","),
      period: "day",
      metric_type: "total_value",
      since: String(desde),
      until: String(hasta),
    },
    reintentos: 2,
  });
  const v = leerValores(r);
  return {
    alcance: v.reach ?? null,
    visualizaciones: v.views ?? null,
    cuentasInteraccion: v.accounts_engaged ?? null,
    interacciones: v.total_interactions ?? null,
    meGusta: v.likes ?? null,
    comentarios: v.comments ?? null,
    guardados: v.saves ?? null,
    compartidos: v.shares ?? null,
    toquesEnlaces: v.profile_links_taps ?? null,
  };
}

/** profile_views (no documentada en v26): null si Meta no la da. Lanza solo los errores de permiso/token. */
export async function visitasPerfil(c: ClienteGraph, igUserId: string, desde: number, hasta: number): Promise<number | null> {
  const r = await c.peticion<{ data?: FilaInsight[] }>("GET", `/${encodeURIComponent(igUserId)}/insights`, {
    consulta: { metric: METRICA_VISITAS_PERFIL, period: "day", metric_type: "total_value", since: String(desde), until: String(hasta) },
    reintentos: 0,
  });
  return leerValores(r)[METRICA_VISITAS_PERFIL] ?? null;
}

/** followers_count del nodo IG User. */
export async function seguidores(c: ClienteGraph, igUserId: string): Promise<number | null> {
  const r = await c.peticion<{ followers_count?: unknown }>("GET", `/${encodeURIComponent(igUserId)}`, {
    consulta: { fields: "followers_count" },
    reintentos: 1,
  });
  return entero(r.followers_count);
}

interface MedioCrudo {
  id?: string | number;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: unknown;
  comments_count?: unknown;
}

function medioDesdeCrudo(m: MedioCrudo, productoPorDefecto: string | null): MedioIg | null {
  if (m?.id === undefined || !/^\d{1,40}$/.test(String(m.id))) return null;
  const http = (u: unknown) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);
  const tipo = typeof m.media_type === "string" && ["IMAGE", "VIDEO", "CAROUSEL_ALBUM"].includes(m.media_type) ? m.media_type : null;
  const producto =
    typeof m.media_product_type === "string" && ["FEED", "REELS", "STORY", "AD"].includes(m.media_product_type)
      ? m.media_product_type
      : productoPorDefecto;
  return {
    id: String(m.id),
    caption: typeof m.caption === "string" ? sanear(m.caption).slice(0, 300) : null,
    tipoMedio: tipo,
    producto,
    permalink: http(m.permalink)?.slice(0, 500) ?? null,
    miniatura: (tipo === "VIDEO" ? http(m.thumbnail_url) ?? http(m.media_url) : http(m.media_url) ?? http(m.thumbnail_url))?.slice(0, 2000) ?? null,
    publicadoAt: typeof m.timestamp === "string" && !Number.isNaN(Date.parse(m.timestamp)) ? new Date(m.timestamp).toISOString() : null,
    meGusta: entero(m.like_count),
    comentarios: entero(m.comments_count),
  };
}

/** Las `limite` publicaciones más recientes del feed (incluye reels). */
export async function mediosRecientes(c: ClienteGraph, igUserId: string, limite: number): Promise<MedioIg[]> {
  const r = await c.peticion<{ data?: MedioCrudo[] }>("GET", `/${encodeURIComponent(igUserId)}/media`, {
    consulta: { fields: CAMPOS_MEDIO, limit: String(limite) },
    reintentos: 2,
  });
  return (r.data ?? []).map((m) => medioDesdeCrudo(m, "FEED")).filter((m): m is MedioIg => m !== null).slice(0, limite);
}

/** Historias de las últimas 24 h (son las únicas que da Meta). */
export async function historiasActivas(c: ClienteGraph, igUserId: string): Promise<MedioIg[]> {
  const r = await c.peticion<{ data?: MedioCrudo[] }>("GET", `/${encodeURIComponent(igUserId)}/stories`, {
    consulta: { fields: CAMPOS_MEDIO },
    reintentos: 1,
  });
  return (r.data ?? []).map((m) => medioDesdeCrudo(m, "STORY")).filter((m): m is MedioIg => m !== null);
}

function valoresMedio(v: Record<string, number | null>): ValoresMedio {
  return {
    alcance: v.reach ?? null,
    meGusta: v.likes ?? null,
    comentarios: v.comments ?? null,
    guardados: v.saved ?? null,
    compartidos: v.shares ?? null,
    visualizaciones: v.views ?? null,
    interacciones: v.total_interactions ?? null,
  };
}

/** Métricas (lifetime) de una publicación; con las básicas si Meta rechaza las «en desarrollo». */
export async function insightsMedio(c: ClienteGraph, medio: Pick<MedioIg, "id" | "producto">): Promise<ValoresMedio> {
  const ruta = `/${encodeURIComponent(medio.id)}/insights`;
  const metricas = medio.producto === "STORY" ? METRICAS_HISTORIA : METRICAS_MEDIO;
  try {
    const r = await c.peticion<{ data?: FilaInsight[] }>("GET", ruta, { consulta: { metric: metricas.join(",") }, reintentos: 1 });
    return valoresMedio(leerValores(r));
  } catch (e) {
    if (medio.producto === "STORY" || !(e instanceof ErrorInstagram) || e.tipo !== "peticion_invalida") throw e;
    const r = await c.peticion<{ data?: FilaInsight[] }>("GET", ruta, { consulta: { metric: METRICAS_MEDIO_BASICAS.join(",") }, reintentos: 1 });
    return valoresMedio(leerValores(r));
  }
}

// ── Días de Europe/Madrid ────────────────────────────────────────────────────

export const ZONA = "Europe/Madrid";

/** «AAAA-MM-DD» del instante `ms` en Europe/Madrid. */
export function fechaMadrid(ms: number): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

/** Minutos que Madrid va por delante de UTC en el instante `ms` (60 o 120). */
export function desfaseMadrid(ms: number): number {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONA,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((local - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** Segundos Unix de las 00:00 de `fecha` en Madrid (con el cambio de hora resuelto). */
export function inicioDiaMadrid(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  const base = Date.UTC(a, m - 1, d);
  let ms = base - desfaseMadrid(base) * 60_000;
  ms = base - desfaseMadrid(ms) * 60_000;
  return Math.floor(ms / 1000);
}

/** Suma `n` días (puede ser negativo) a «AAAA-MM-DD». */
export function sumarDias(fecha: string, n: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
