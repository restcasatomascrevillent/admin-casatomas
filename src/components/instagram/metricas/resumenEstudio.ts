/**
 * Las 3 cifras del Estudio de Instagram (últimos 28 días) leídas DIRECTAMENTE
 * de la tabla instagram_metricas_cuenta con PostgREST, como el usuario (RLS:
 * can_read_section('marketing'), la misma que aplica la Edge Function al leer
 * «como el usuario»). Así el Estudio no espera al arranque en frío de
 * instagram-metricas (1-3 s) ni a sus 5-8 consultas (publicaciones, piezas,
 * fotos, «Qué funciona»), que el Estudio no enseña. Ver
 * docs/instagram-rendimiento.md.
 *
 * El cálculo es el mismo que el de la función (supabase/functions/
 * instagram-metricas/resumen.ts: resumirPeriodo, serieDiaria y ultimoDia); una
 * prueba compara los dos con las mismas filas para que no se separen.
 *
 * Qué cuenta: la función usa el secreto IG_USER_ID(_<MARCA>), que el panel no
 * conoce. Aquí: si hay una sola cuenta en la tabla (lo normal hoy), esa; si se
 * sabe el id por la última comprobación de la conexión, ese; si hay varias y
 * no se sabe cuál, o la lectura falla (tabla sin migrar…), se pregunta a la
 * Edge Function como antes (respaldo).
 */
import { supabase } from "@/integrations/supabase/client";
import { leerMetricas } from "./api";
import type { ClaveSuma, DatosMetricas, PuntoSerie, ResumenPeriodo } from "./tipos";

export const DIAS_ESTUDIO = 28;
/** Filas por cuenta que hacen falta: 28 días + los 28 anteriores + margen (igual que la función: 28·2+7). */
export const FILAS_POR_CUENTA = DIAS_ESTUDIO * 2 + 7;
/** Sin filtrar por cuenta se leen dos cuentas como mucho; con más, respaldo. */
const FILAS_SIN_FILTRO = FILAS_POR_CUENTA * 2;
const COLUMNAS = "fecha,ig_user_id,seguidores,alcance,visualizaciones,visitas_perfil,cuentas_interaccion,interacciones,toques_enlaces";

export interface FilaCuentaEstudio {
  fecha: string;
  ig_user_id?: string;
  seguidores: number | null;
  alcance: number | null;
  visualizaciones: number | null;
  visitas_perfil: number | null;
  cuentas_interaccion: number | null;
  interacciones: number | null;
  toques_enlaces?: number | null;
}

/** Lo que el Estudio necesita de las métricas (subconjunto de DatosMetricas). */
export interface ResumenEstudio {
  resumen: { d7: ResumenPeriodo; d28: ResumenPeriodo } | null;
  serie: PuntoSerie[];
  /** De dónde salió: la tabla (rápido) o la Edge Function (respaldo). */
  origen: "tablas" | "funcion";
}

// ── Cálculo (copia fiel de supabase/functions/instagram-metricas/resumen.ts) ──

const SUMAS: ReadonlyArray<readonly [ClaveSuma, keyof FilaCuentaEstudio]> = [
  ["alcance", "alcance"],
  ["visualizaciones", "visualizaciones"],
  ["interacciones", "interacciones"],
  ["cuentasInteraccion", "cuentas_interaccion"],
  ["visitasPerfil", "visitas_perfil"],
  ["toquesEnlaces", "toques_enlaces"],
];

function sumarDias(fecha: string, n: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

function variacion(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null || anterior <= 0) return null;
  return Math.round(((actual - anterior) / anterior) * 1000) / 10;
}

function suma(filas: FilaCuentaEstudio[], col: keyof FilaCuentaEstudio): number | null {
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

function seguidoresHasta(filas: FilaCuentaEstudio[], hasta: string): number | null {
  let mejor: FilaCuentaEstudio | null = null;
  for (const f of filas) if (f.fecha <= hasta && typeof f.seguidores === "number" && (!mejor || f.fecha > mejor.fecha)) mejor = f;
  return mejor?.seguidores ?? null;
}

export function resumirPeriodoEstudio(filas: FilaCuentaEstudio[], hasta: string, dias: number): ResumenPeriodo {
  const desde = sumarDias(hasta, -(dias - 1));
  const hastaAnt = sumarDias(desde, -1);
  const desdeAnt = sumarDias(hastaAnt, -(dias - 1));
  const actual = filas.filter((f) => f.fecha >= desde && f.fecha <= hasta);
  const anterior = filas.filter((f) => f.fecha >= desdeAnt && f.fecha <= hastaAnt);
  const metricas = {} as ResumenPeriodo["metricas"];
  for (const [clave, col] of SUMAS) {
    const a = suma(actual, col);
    const b = suma(anterior, col);
    metricas[clave] = { actual: a, anterior: b, variacion: variacion(a, b) };
  }
  const segFin = seguidoresHasta(filas, hasta);
  const segIni = seguidoresHasta(filas, hastaAnt);
  metricas.seguidores = { actual: segFin, anterior: segIni, variacion: variacion(segFin, segIni), cambio: segFin !== null && segIni !== null ? segFin - segIni : null };
  return {
    dias,
    desde,
    hasta,
    diasConDatos: new Set(actual.map((f) => f.fecha)).size,
    diasConDatosAnterior: new Set(anterior.map((f) => f.fecha)).size,
    metricas,
  };
}

export function serieEstudio(filas: FilaCuentaEstudio[], hasta: string, dias: number): PuntoSerie[] {
  const porFecha = new Map(filas.map((f) => [f.fecha, f]));
  return Array.from({ length: dias }, (_, i) => {
    const fecha = sumarDias(hasta, -(dias - 1 - i));
    const f = porFecha.get(fecha);
    return { fecha, alcance: f?.alcance ?? null, seguidores: f?.seguidores ?? null, visualizaciones: f?.visualizaciones ?? null, interacciones: f?.interacciones ?? null };
  });
}

/** Resumen de 7 y 28 días y serie de 28, como la acción «leer» de la función. */
export function calcularResumenEstudio(filas: FilaCuentaEstudio[]): Omit<ResumenEstudio, "origen"> {
  const fin = filas.reduce<string | null>((max, f) => (max === null || f.fecha > max ? f.fecha : max), null);
  if (!fin) return { resumen: null, serie: [] };
  return { resumen: { d7: resumirPeriodoEstudio(filas, fin, 7), d28: resumirPeriodoEstudio(filas, fin, 28) }, serie: serieEstudio(filas, fin, DIAS_ESTUDIO) };
}

// ── Lectura ──

export interface DependenciasResumen {
  /** Filas de instagram_metricas_cuenta (más recientes primero). */
  leerFilas?: (igUserId: string | null, limite: number) => Promise<FilaCuentaEstudio[]>;
  /** Respaldo: la Edge Function (acción «leer»). */
  respaldo?: (marca: string | null) => Promise<Pick<DatosMetricas, "resumen" | "serie">>;
}

async function leerFilasTabla(igUserId: string | null, limite: number): Promise<FilaCuentaEstudio[]> {
  let q = supabase.from("instagram_metricas_cuenta").select(COLUMNAS);
  if (igUserId) q = q.eq("ig_user_id", igUserId);
  const { data, error } = await q.order("fecha", { ascending: false }).limit(limite);
  if (error) throw error;
  return (data ?? []) as FilaCuentaEstudio[];
}

/**
 * Cifras del Estudio. `igUserId`: la cuenta de la marca si se sabe (última
 * comprobación de la conexión); `marca`: la que se pasa al respaldo.
 */
export async function leerResumenEstudio(marca: string | null, igUserId: string | null, deps: DependenciasResumen = {}): Promise<ResumenEstudio> {
  const leerFilas = deps.leerFilas ?? leerFilasTabla;
  const respaldo = deps.respaldo ?? ((m: string | null) => leerMetricas(undefined, m));
  const porFuncion = async (): Promise<ResumenEstudio> => {
    const d = await respaldo(marca);
    return { resumen: d.resumen ?? null, serie: d.serie ?? [], origen: "funcion" };
  };
  const id = igUserId && /^\d+$/.test(igUserId) ? igUserId : null;
  let filas: FilaCuentaEstudio[];
  try {
    filas = await leerFilas(id, id ? FILAS_POR_CUENTA : FILAS_SIN_FILTRO);
    // Id guardado que ya no tiene filas (cuenta cambiada): se mira la tabla entera.
    if (id && filas.length === 0) filas = await leerFilas(null, FILAS_SIN_FILTRO);
  } catch {
    return porFuncion();
  }
  const cuentas = new Set(filas.map((f) => f.ig_user_id).filter(Boolean));
  if (cuentas.size > 1) {
    if (!id || !cuentas.has(id)) return porFuncion();
    filas = filas.filter((f) => f.ig_user_id === id);
  }
  return { ...calcularResumenEstudio(filas), origen: "tablas" };
}
