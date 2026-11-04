/**
 * Acción «capturar»: pide a Meta las métricas de la cuenta (por día de
 * Europe/Madrid) y de las publicaciones recientes y las guarda con la clave
 * de servicio en instagram_metricas_cuenta e instagram_metricas_publicacion.
 *
 *  - Días: los DIAS_CUENTA últimos días completos (ayer, anteayer…). Meta
 *    avisa de que los datos pueden tardar hasta 48 h, así que cada captura
 *    rehace los últimos días (upsert por fecha + cuenta).
 *  - Seguidores: followers_count en el momento de la captura; se guarda solo
 *    en el día más reciente (los anteriores conservan lo que tenían).
 *  - Publicaciones: las MAX_PUBLICACIONES más recientes del feed + las
 *    historias activas (24 h). Una fila por publicación y día de captura
 *    (upsert por media_id + fecha_captura), enlazada con instagram_piezas
 *    por media_id.
 *  - Si al token le falta instagram_manage_insights, la PRIMERA llamada de
 *    la cuenta falla y se lanza el error de permiso (no se guarda nada).
 *    Los fallos de una publicación suelta no paran la captura: van a avisos.
 */
import type { ClienteGraph } from "../_shared/instagram/cliente.ts";
import { ErrorInstagram } from "../_shared/instagram/errores.ts";
import {
  errorPermisoInsights,
  esFaltaPermisoInsights,
  fechaMadrid,
  historiasActivas,
  inicioDiaMadrid,
  insightsCuenta,
  insightsMedio,
  mediosRecientes,
  seguidores,
  sumarDias,
  visitasPerfil,
  type MedioIg,
  type ValoresMedio,
} from "../_shared/instagram/insights.ts";
import { mensajeSaneado } from "../_shared/instagram/secretos.ts";
import type { Rest } from "./acceso.ts";

export const DIAS_CUENTA = 3;
export const MAX_PUBLICACIONES = 30;
/** Publicaciones cuyas métricas se piden a la vez. */
const EN_PARALELO = 5;

export interface DependenciasCaptura {
  cliente: ClienteGraph;
  igUserId: string;
  /** PostgREST con la clave de servicio. */
  servicio: Rest;
  ahora: () => number;
}

export interface ResultadoCaptura {
  fechaCaptura: string;
  dias: string[];
  publicaciones: number;
  avisos: string[];
}

function filaCuenta(fecha: string, igUserId: string, v: Awaited<ReturnType<typeof insightsCuenta>>, extra: Record<string, unknown>, ahora: number) {
  return {
    fecha,
    ig_user_id: igUserId,
    alcance: v.alcance,
    visualizaciones: v.visualizaciones,
    cuentas_interaccion: v.cuentasInteraccion,
    interacciones: v.interacciones,
    me_gusta: v.meGusta,
    comentarios: v.comentarios,
    guardados: v.guardados,
    compartidos: v.compartidos,
    toques_enlaces: v.toquesEnlaces,
    capturado_at: new Date(ahora).toISOString(),
    ...extra,
  };
}

export async function capturarMetricas(d: DependenciasCaptura): Promise<ResultadoCaptura> {
  const avisos: string[] = [];
  const hoy = fechaMadrid(d.ahora());
  const dias = Array.from({ length: DIAS_CUENTA }, (_, i) => sumarDias(hoy, -(i + 1)));

  // ── Cuenta: un día por llamada (total_value suma el rango pedido) ──
  const filas: Record<string, unknown>[] = [];
  let pedirVisitas = true;
  for (const [i, dia] of dias.entries()) {
    const desde = inicioDiaMadrid(dia);
    const hasta = inicioDiaMadrid(sumarDias(dia, 1));
    let valores;
    try {
      valores = await insightsCuenta(d.cliente, d.igUserId, desde, hasta);
    } catch (e) {
      if (esFaltaPermisoInsights(e)) throw errorPermisoInsights(e as ErrorInstagram);
      throw e;
    }
    const extra: Record<string, unknown> = {};
    if (pedirVisitas) {
      try {
        extra.visitas_perfil = await visitasPerfil(d.cliente, d.igUserId, desde, hasta);
      } catch (e) {
        if (e instanceof ErrorInstagram && (e.tipo === "token" || e.tipo === "sesion")) throw e;
        pedirVisitas = false;
        avisos.push(`Meta no da las visitas al perfil (profile_views): se dejan vacías. ${mensajeSaneado(e)}`);
      }
    }
    if (i === 0) {
      try {
        extra.seguidores = await seguidores(d.cliente, d.igUserId);
      } catch (e) {
        avisos.push(`No se pudo leer el número de seguidores: ${mensajeSaneado(e)}`);
      }
    }
    filas.push(filaCuenta(dia, d.igUserId, valores, extra, d.ahora()));
  }
  // Una petición por fila: no todas llevan las mismas columnas (seguidores y
  // visitas solo cuando se tienen) y PostgREST exige las mismas en un lote.
  for (const fila of filas) await d.servicio.guardar("instagram_metricas_cuenta", [fila], "fecha,ig_user_id");

  // ── Publicaciones ──
  const medios: MedioIg[] = await mediosRecientes(d.cliente, d.igUserId, MAX_PUBLICACIONES);
  try {
    const vistos = new Set(medios.map((m) => m.id));
    for (const h of await historiasActivas(d.cliente, d.igUserId)) if (!vistos.has(h.id)) medios.push(h);
  } catch (e) {
    avisos.push(`No se pudieron leer las historias activas: ${mensajeSaneado(e)}`);
  }

  const metricas = new Map<string, ValoresMedio | null>();
  let fallosHistoria = 0;
  for (let i = 0; i < medios.length; i += EN_PARALELO) {
    const tanda = medios.slice(i, i + EN_PARALELO);
    const res = await Promise.allSettled(tanda.map((m) => insightsMedio(d.cliente, m)));
    res.forEach((r, j) => {
      const m = tanda[j];
      if (r.status === "fulfilled") {
        metricas.set(m.id, r.value);
        return;
      }
      metricas.set(m.id, null);
      const e = r.reason;
      if (e instanceof ErrorInstagram && (e.tipo === "token" || e.tipo === "sesion")) throw e;
      // Historias con valores < 5: Meta contesta error 10. No es un problema de permisos.
      if (m.producto === "STORY") fallosHistoria++;
      else avisos.push(`Sin métricas de la publicación ${m.id}: ${mensajeSaneado(e)}`);
    });
  }
  if (fallosHistoria) avisos.push(`${fallosHistoria} historia(s) sin métricas (Meta no las da con menos de 5 interacciones).`);

  // Enlace con las piezas del panel por media_id.
  const piezas = new Map<string, string>();
  if (medios.length) {
    const ids = medios.map((m) => m.id).join(",");
    const filasPieza = await d.servicio.leer<{ id: string; media_id: string }>(
      `instagram_piezas?select=id,media_id&media_id=in.(${ids})`,
      "las piezas de Instagram",
    );
    for (const p of filasPieza) piezas.set(p.media_id, p.id);
  }

  const filasPub = medios.map((m) => {
    const v = metricas.get(m.id);
    return {
      media_id: m.id,
      ig_user_id: d.igUserId,
      fecha_captura: hoy,
      capturado_at: new Date(d.ahora()).toISOString(),
      pieza_id: piezas.get(m.id) ?? null,
      tipo_medio: m.tipoMedio,
      producto: m.producto,
      publicado_at: m.publicadoAt,
      permalink: m.permalink,
      miniatura_url: m.miniatura,
      caption: m.caption,
      alcance: v?.alcance ?? null,
      me_gusta: v?.meGusta ?? m.meGusta,
      comentarios: v?.comentarios ?? m.comentarios,
      guardados: v?.guardados ?? null,
      compartidos: v?.compartidos ?? null,
      visualizaciones: v?.visualizaciones ?? null,
      interacciones: v?.interacciones ?? null,
    };
  });
  await d.servicio.guardar("instagram_metricas_publicacion", filasPub, "media_id,fecha_captura");

  return { fechaCaptura: hoy, dias, publicaciones: filasPub.length, avisos };
}
