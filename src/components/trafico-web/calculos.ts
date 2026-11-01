/**
 * Lógica pura de la página de Tráfico web (sin React), para poder testearla y
 * para que los ficheros de componentes solo exporten componentes (fast refresh).
 * La estadística "de verdad" vive en las RPC SQL; aquí solo se da forma.
 */
import type { EstadoSync, FilaSerie, ProyectoTrafico, Tendencia } from "@/hooks/useTraficoWeb";
import { esNulo, fmtFechaHora } from "./formato";

export const RANGOS_DIAS = [30, 90, 180, 365] as const;
export type RangoDias = (typeof RANGOS_DIAS)[number];

/** R5: aviso si el último sync correcto tiene más de 48 h o el último intento dejó error. */
export const HORAS_SYNC_OBSOLETO = 48;
/** R6: por debajo de 14 días con dato la tendencia no es fiable. */
export const DIAS_MINIMOS_TENDENCIA = 14;

// ─── Resumen de un tramo de la serie ─────────────────────────────────────────
export interface ResumenPeriodo {
  total: number | null;
  media: number | null;
  diasConDato: number;
  visitantes: number | null;
  anomalias: number;
}

/** Resume un tramo de la serie ignorando los días NULL (sin sincronizar ≠ 0 visitas). */
export function resumirSerie(filas: FilaSerie[]): ResumenPeriodo {
  let total = 0;
  let dias = 0;
  let visitantes = 0;
  let visitantesCompletos = true;
  let anomalias = 0;
  for (const f of filas) {
    if (f.es_anomalia === true) anomalias++;
    if (esNulo(f.visitas)) continue;
    total += f.visitas;
    dias++;
    if (esNulo(f.visitantes)) visitantesCompletos = false;
    else visitantes += f.visitantes;
  }
  return {
    total: dias > 0 ? total : null,
    media: dias > 0 ? total / dias : null,
    diasConDato: dias,
    // Visitantes únicos no son sumables entre días en rigor: se muestra como
    // "suma de visitantes diarios" y solo si todos los días lo traen.
    visitantes: dias > 0 && visitantesCompletos ? visitantes : null,
    anomalias,
  };
}

/** Δ% de la media diaria (no de la suma: los huecos de sync no deben leerse como caída). */
export function deltaMediaPct(actual: ResumenPeriodo, anterior: ResumenPeriodo): number | null {
  if (esNulo(actual.media) || esNulo(anterior.media) || anterior.media <= 0) return null;
  return (100 * (actual.media - anterior.media)) / anterior.media;
}

// ─── Estado del sync ─────────────────────────────────────────────────────────
export interface ProblemaSync {
  proyecto: ProyectoTrafico;
  motivo: string;
}

/**
 * La función sync-trafico-web guarda el error de Vercel cuando el proyecto no
 * tiene Web Analytics activado (código `web_analytics_not_enabled`; mensaje
 * "Web Analytics is not enabled for this project"). Pasó tras la migración a
 * la cuenta del restaurante (27-10-2026): los proyectos nuevos se crearon con
 * Web Analytics apagado y Vercel dejó de guardar visitas.
 */
const PATRON_ANALYTICS_DESACTIVADO = /web_analytics_not_enabled|web analytics is not enabled/i;

export function esErrorAnalyticsDesactivado(error: string | null | undefined): boolean {
  return !!error && PATRON_ANALYTICS_DESACTIVADO.test(error);
}

const MOTIVO_ANALYTICS_DESACTIVADO =
  "Web Analytics está desactivado en Vercel para esta web, así que Vercel no está guardando visitas. " +
  "Hay que activarlo (Vercel → proyecto de la web → Analytics → Enable) y volver a desplegar la web; " +
  "los días que pase apagado no se pueden recuperar.";

function motivoError(error: string): string {
  return esErrorAnalyticsDesactivado(error) ? MOTIVO_ANALYTICS_DESACTIVADO : `el último intento falló: ${error}`;
}

export function detectarProblemasSync(
  proyectos: readonly ProyectoTrafico[],
  estados: EstadoSync[],
  ahora: Date,
): ProblemaSync[] {
  const problemas: ProblemaSync[] = [];
  for (const p of proyectos) {
    const e = estados.find((x) => x.proyecto === p);
    if (!e || !e.ultimo_ok_en) {
      // Intento fallido sin ningún éxito previo → aviso. Si nunca se ha
      // intentado, lo cubre el estado vacío de la página.
      if (e?.ultimo_error) {
        problemas.push({
          proyecto: p,
          motivo: esErrorAnalyticsDesactivado(e.ultimo_error)
            ? MOTIVO_ANALYTICS_DESACTIVADO
            : `nunca se ha sincronizado bien. Último error: ${e.ultimo_error}`,
        });
      }
      continue;
    }
    const okMs = new Date(e.ultimo_ok_en).getTime();
    const horas = (ahora.getTime() - okMs) / 36e5;
    const errorEnUltimoIntento =
      !!e.ultimo_error && !!e.ultimo_intento_en && new Date(e.ultimo_intento_en).getTime() > okMs;
    if (errorEnUltimoIntento && e.ultimo_error) {
      problemas.push({ proyecto: p, motivo: motivoError(e.ultimo_error) });
    } else if (horas > HORAS_SYNC_OBSOLETO) {
      problemas.push({
        proyecto: p,
        motivo: `sin sincronizar desde ${fmtFechaHora(e.ultimo_ok_en)} (más de ${HORAS_SYNC_OBSOLETO} h)`,
      });
    }
  }
  return problemas;
}

// ─── Puntos del gráfico principal ────────────────────────────────────────────
export interface PuntoGrafico {
  fecha: string;
  visitas?: number | null;
  media7?: number | null;
  media30?: number | null;
  /** [media_dow − kσ, media_dow + kσ] (R2: bandas por mismo día de la semana). */
  banda1?: [number, number] | null;
  banda2?: [number, number] | null;
  mediaDow?: number | null;
  zDow?: number | null;
  desviacionPct?: number | null;
  anomalia?: boolean | null;
  proyeccion?: number | null;
}

const banda = (media: number | null, desv: number | null, k: number): [number, number] | null =>
  esNulo(media) || esNulo(desv) ? null : [Math.max(0, media - k * desv), media + k * desv];

/**
 * Combina la serie del periodo con la proyección de la regresión. La
 * proyección arranca en `hoy` con el intercepto (x = 0 en la RPC) y se engancha
 * al último dato real para que la línea discontinua se lea como continuación.
 */
export function construirPuntos(serie: FilaSerie[], tendencia: Tendencia | null | undefined, hoy: string): PuntoGrafico[] {
  const puntos: PuntoGrafico[] = serie.map((f) => ({
    fecha: f.fecha,
    visitas: f.visitas,
    media7: f.media_7,
    media30: f.media_30,
    banda1: banda(f.media_dow, f.desv_dow, 1),
    banda2: banda(f.media_dow, f.desv_dow, 2),
    mediaDow: f.media_dow,
    zDow: f.z_dow,
    desviacionPct: f.desviacion_pct,
    anomalia: f.es_anomalia,
  }));
  if (tendencia && !esNulo(tendencia.intercepto) && tendencia.proyeccion.length > 0) {
    const ultimo = puntos[puntos.length - 1];
    if (ultimo && !esNulo(ultimo.visitas)) ultimo.proyeccion = ultimo.visitas;
    puntos.push({ fecha: hoy, proyeccion: Math.max(0, tendencia.intercepto) });
    for (const p of tendencia.proyeccion) puntos.push({ fecha: p.fecha, proyeccion: p.visitas });
  }
  return puntos;
}
