/**
 * Resumen de 7 y 28 días a partir de las filas diarias de la cuenta, con la
 * variación frente al periodo anterior de la misma longitud, y la serie
 * diaria para el gráfico. Funciones puras (sin red), probadas en __tests__.
 *
 * Ojo con el alcance: Meta da el alcance de CADA día (cuentas únicas de ese
 * día). Aquí se SUMAN los días, así que una cuenta que vio contenido tres
 * días cuenta tres veces: es «alcance diario acumulado», no cuentas únicas
 * del periodo. Igual con «cuentas que interactúan». Se dice en la UI.
 */
import { sumarDias } from "../_shared/instagram/insights.ts";

export interface FilaCuenta {
  fecha: string;
  seguidores: number | null;
  alcance: number | null;
  visualizaciones: number | null;
  visitas_perfil: number | null;
  cuentas_interaccion: number | null;
  interacciones: number | null;
  me_gusta?: number | null;
  comentarios?: number | null;
  guardados?: number | null;
  compartidos?: number | null;
  toques_enlaces?: number | null;
}

export const METRICAS_SUMA = [
  ["alcance", "alcance"],
  ["visualizaciones", "visualizaciones"],
  ["interacciones", "interacciones"],
  ["cuentasInteraccion", "cuentas_interaccion"],
  ["visitasPerfil", "visitas_perfil"],
  ["toquesEnlaces", "toques_enlaces"],
] as const;

export type ClaveMetrica = (typeof METRICAS_SUMA)[number][0] | "seguidores";

export interface Comparacion {
  actual: number | null;
  anterior: number | null;
  /** % frente al periodo anterior (1 decimal); null si no hay base para compararlo. */
  variacion: number | null;
}

export interface ComparacionSeguidores extends Comparacion {
  /** Seguidores ganados (o perdidos) en el periodo. */
  cambio: number | null;
}

export interface ResumenPeriodo {
  dias: number;
  desde: string;
  hasta: string;
  diasConDatos: number;
  /** Días con datos del periodo anterior (para avisar si la comparación es parcial). */
  diasConDatosAnterior: number;
  metricas: Record<(typeof METRICAS_SUMA)[number][0], Comparacion> & { seguidores: ComparacionSeguidores };
}

export interface PuntoSerie {
  fecha: string;
  alcance: number | null;
  seguidores: number | null;
  visualizaciones: number | null;
  interacciones: number | null;
}

export function variacion(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null || anterior <= 0) return null;
  return Math.round(((actual - anterior) / anterior) * 1000) / 10;
}

function enRango(f: string, desde: string, hasta: string): boolean {
  return f >= desde && f <= hasta;
}

function suma(filas: FilaCuenta[], col: keyof FilaCuenta): number | null {
  let total = 0;
  let hay = false;
  for (const f of filas) {
    const v = f[col];
    if (typeof v === "number") {
      total += v;
      hay = true;
    }
  }
  return hay ? total : null;
}

/** Último valor de seguidores con fecha ≤ `hasta` (null si no hay ninguno). */
function seguidoresHasta(filas: FilaCuenta[], hasta: string): number | null {
  let mejor: FilaCuenta | null = null;
  for (const f of filas) {
    if (f.fecha <= hasta && typeof f.seguidores === "number" && (!mejor || f.fecha > mejor.fecha)) mejor = f;
  }
  return mejor?.seguidores ?? null;
}

/** Resumen de los `dias` días que acaban en `hasta` (incluido). */
export function resumirPeriodo(filas: FilaCuenta[], hasta: string, dias: number): ResumenPeriodo {
  const desde = sumarDias(hasta, -(dias - 1));
  const hastaAnt = sumarDias(desde, -1);
  const desdeAnt = sumarDias(hastaAnt, -(dias - 1));
  const actual = filas.filter((f) => enRango(f.fecha, desde, hasta));
  const anterior = filas.filter((f) => enRango(f.fecha, desdeAnt, hastaAnt));

  const metricas = {} as ResumenPeriodo["metricas"];
  for (const [clave, col] of METRICAS_SUMA) {
    const a = suma(actual, col);
    const b = suma(anterior, col);
    metricas[clave] = { actual: a, anterior: b, variacion: variacion(a, b) };
  }
  const segFin = seguidoresHasta(filas, hasta);
  const segIni = seguidoresHasta(filas, hastaAnt);
  metricas.seguidores = {
    actual: segFin,
    anterior: segIni,
    variacion: variacion(segFin, segIni),
    cambio: segFin !== null && segIni !== null ? segFin - segIni : null,
  };
  return {
    dias,
    desde,
    hasta,
    diasConDatos: new Set(actual.map((f) => f.fecha)).size,
    diasConDatosAnterior: new Set(anterior.map((f) => f.fecha)).size,
    metricas,
  };
}

/** Serie diaria de `dias` días que acaba en `hasta`, con huecos a null. */
export function serieDiaria(filas: FilaCuenta[], hasta: string, dias: number): PuntoSerie[] {
  const porFecha = new Map(filas.map((f) => [f.fecha, f]));
  return Array.from({ length: dias }, (_, i) => {
    const fecha = sumarDias(hasta, -(dias - 1 - i));
    const f = porFecha.get(fecha);
    return {
      fecha,
      alcance: f?.alcance ?? null,
      seguidores: f?.seguidores ?? null,
      visualizaciones: f?.visualizaciones ?? null,
      interacciones: f?.interacciones ?? null,
    };
  });
}

/** Último día con datos (o null si no hay filas). */
export function ultimoDia(filas: FilaCuenta[]): string | null {
  return filas.reduce<string | null>((max, f) => (max === null || f.fecha > max ? f.fecha : max), null);
}
