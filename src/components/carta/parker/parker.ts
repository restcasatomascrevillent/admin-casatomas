import { supabase } from "@/integrations/supabase/client";
import { mensajeErrorFuncion } from "@/hooks/useEnviarNewsletter";

/**
 * Puntuación Robert Parker / The Wine Advocate en el panel (08/11/2026).
 *
 * Cada vino puede tener una fila por añada en `vinos_puntuacion_parker`
 * (migración 20261118105000) con su estado y su fuente. La web solo enseña la
 * VERIFICADA, definitiva, de la añada que se sirve ("Vinos".anada) o la NV si
 * el vino es sin añada: lo calcula la base de datos. Aquí van los tipos, los
 * textos de cada estado y la llamada a la función `buscar-puntuacion-parker`.
 */

export type EstadoParker = "verificada" | "revision" | "no_localizada" | "pendiente" | "fallida";
export type MotivoParker =
  | "anada_desconocida"
  | "referencia_ambigua"
  | "fuente_inaccesible"
  | "no_localizada"
  | "fuentes_contradictorias"
  | "busqueda_fallida";

export interface DiscrepanciaParker {
  fuente_nombre: string;
  fuente_url: string | null;
  puntos_texto: string | null;
  nota: string | null;
}

/** Resultado de una búsqueda (o una fila guardada sin sus ids). */
export interface ResultadoParker {
  estado: EstadoParker;
  motivo: MotivoParker | null;
  anada: number | null;
  sin_anada: boolean;
  puntos_texto: string | null;
  puntos_min: number | null;
  puntos_max: number | null;
  provisional: boolean;
  vino_evaluado: string | null;
  entidad: string;
  critico: string | null;
  fecha_valoracion: string | null;
  fuente_nombre: string | null;
  fuente_url: string | null;
  fuente_tipo: "original" | "secundaria" | "manual" | null;
  cita: string | null;
  fecha_consulta: string | null;
  discrepancias: DiscrepanciaParker[];
  notas: string | null;
  comprobado_en_pagina?: boolean;
}

/** Fila de vinos_puntuacion_parker. */
export interface FilaParker extends ResultadoParker {
  id: string;
  vino_id: string;
  origen: "revision" | "foto" | "busqueda" | "manual";
  updated_at: string;
}

export type OrigenParker = FilaParker["origen"];

/** Puntuación impresa en la etiqueta (extraer-vino-foto). */
export interface PuntuacionEtiqueta {
  texto: string;
  puntos: number | null;
  entidad: string | null;
  entidad_tipo: "parker" | "otra" | "desconocida";
  anada: number | null;
}

export const ENTIDAD_PARKER = "Robert Parker Wine Advocate";

export const TEXTO_ESTADO: Record<EstadoParker, string> = {
  verificada: "Verificada",
  revision: "Pendiente de revisión",
  no_localizada: "No localizada",
  pendiente: "Búsqueda pendiente",
  fallida: "Búsqueda fallida",
};

export const TEXTO_MOTIVO: Record<MotivoParker, string> = {
  anada_desconocida: "Añada desconocida",
  referencia_ambigua: "Referencia ambigua",
  fuente_inaccesible: "Fuente inaccesible",
  no_localizada: "Puntuación no localizada",
  fuentes_contradictorias: "Fuentes contradictorias",
  busqueda_fallida: "La búsqueda falló",
};

/** Tono de la etiqueta de estado (colores del panel). */
export function tonoEstado(estado: EstadoParker): "ok" | "aviso" | "neutro" | "error" {
  if (estado === "verificada") return "ok";
  if (estado === "revision") return "aviso";
  if (estado === "fallida") return "error";
  return "neutro";
}

/** Año de cuatro cifras en el nombre de la carta («Aalto 2021» → 2021), o null. */
export function anadaDeNombre(nombre: string | null | undefined): number | null {
  const anos = [...String(nombre ?? "").matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => Number(m[1]));
  return anos.length ? anos[anos.length - 1] : null;
}

/** La fila de la añada que se sirve (o la NV), si existe. */
export function filaDeAnada<T extends Pick<FilaParker, "anada" | "sin_anada">>(
  filas: readonly T[],
  anada: number | null | undefined,
  sinAnada: boolean | null | undefined,
): T | null {
  if (sinAnada) return filas.find((f) => f.sin_anada && f.anada === null) ?? null;
  if (typeof anada !== "number") return null;
  return filas.find((f) => f.anada === anada) ?? null;
}

/** «94», «94+», «93–95» y «(provisional)» si lo es. */
export function textoPuntos(r: Pick<ResultadoParker, "puntos_texto" | "puntos_min" | "puntos_max" | "provisional">): string | null {
  if (r.puntos_min === null) return null;
  const base = r.puntos_texto?.trim() || (r.puntos_max !== null && r.puntos_max > r.puntos_min ? `${r.puntos_min}–${r.puntos_max}` : String(r.puntos_min));
  return r.provisional ? `${base} (provisional)` : base;
}

/** «2021» o «sin añada». */
export function textoAnada(r: Pick<ResultadoParker, "anada" | "sin_anada">): string {
  if (r.sin_anada) return "sin añada (NV)";
  return r.anada !== null ? String(r.anada) : "añada desconocida";
}

/** «08/11/2026» desde «2026-11-08». */
export function fechaCorta(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso ?? null;
}

export interface ResumenParker {
  tipo: "publicada" | "revision" | "falta_anada" | "anada_desconocida" | "no_localizada" | "pendiente" | "fallida" | "sin_datos";
  texto: string;
  detalle: string;
}

/**
 * Resumen de un vino para la lista del panel: si la web enseña la puntuación,
 * si hay algo que revisar o qué falta. Usa la fila de la añada que se sirve.
 */
export function resumenParker(
  vino: { anada?: number | null; sin_anada?: boolean | null; puntuacion_parker_texto?: string | null; puntuacion_parker?: number | null; puntuacion_parker_anada?: number | null },
  filas: readonly FilaParker[],
): ResumenParker {
  const publicado = vino.puntuacion_parker_texto || (typeof vino.puntuacion_parker === "number" ? String(vino.puntuacion_parker) : null);
  if (publicado) {
    return {
      tipo: "publicada",
      texto: `${publicado} RP`,
      detalle: `Puntuación Parker verificada${vino.puntuacion_parker_anada ? ` (añada ${vino.puntuacion_parker_anada})` : " (sin añada)"}: sale en la web`,
    };
  }
  const servida = typeof vino.anada === "number" || vino.sin_anada === true;
  if (!servida) {
    const verificadas = filas.filter((f) => f.estado === "verificada");
    if (verificadas.length) {
      return {
        tipo: "falta_anada",
        texto: "Parker: ¿añada?",
        detalle: `Hay puntuación verificada de ${verificadas.map((f) => textoAnada(f)).join(", ")}, pero no se sabe qué añada se sirve: confírmala para publicarla`,
      };
    }
    if (filas.some((f) => f.estado === "revision")) {
      return { tipo: "revision", texto: "Parker: revisar", detalle: "Hay una puntuación pendiente de revisión y falta la añada que se sirve" };
    }
    if (filas.some((f) => f.estado === "pendiente" || f.estado === "fallida")) {
      return { tipo: "pendiente", texto: "Parker: sin buscar", detalle: "Búsqueda pendiente: pon la añada que se sirve y busca la puntuación" };
    }
    return filas.length
      ? { tipo: "anada_desconocida", texto: "Parker: ¿añada?", detalle: "Añada desconocida: confirma la que se sirve para buscar la puntuación" }
      : { tipo: "sin_datos", texto: "", detalle: "" };
  }
  const fila = filaDeAnada(filas, vino.anada, vino.sin_anada);
  if (!fila) return { tipo: "pendiente", texto: "Parker: sin buscar", detalle: `Búsqueda pendiente para la añada ${vino.sin_anada ? "NV" : vino.anada}` };
  if (fila.estado === "verificada") {
    return { tipo: "revision", texto: "Parker: provisional", detalle: "La puntuación verificada es provisional (barrica): no se publica" };
  }
  if (fila.estado === "revision") {
    return { tipo: "revision", texto: "Parker: revisar", detalle: `Pendiente de revisión${fila.motivo ? ` · ${TEXTO_MOTIVO[fila.motivo]}` : ""}` };
  }
  if (fila.estado === "no_localizada") {
    return { tipo: "no_localizada", texto: "Parker: no localizada", detalle: fila.motivo ? TEXTO_MOTIVO[fila.motivo] : "No localizada" };
  }
  if (fila.estado === "fallida") return { tipo: "fallida", texto: "Parker: falló", detalle: "La última búsqueda falló: repítela" };
  return { tipo: "pendiente", texto: "Parker: sin buscar", detalle: "Búsqueda pendiente" };
}

/** ¿Se puede marcar como verificada? (los mismos requisitos que el CHECK de la BD). */
export function faltaParaVerificar(r: Pick<ResultadoParker, "puntos_min" | "fuente_url" | "fuente_nombre" | "anada" | "sin_anada">): string[] {
  const faltan: string[] = [];
  if (r.puntos_min === null) faltan.push("los puntos");
  if (!r.fuente_url) faltan.push("la URL de la fuente");
  if (!r.fuente_nombre) faltan.push("el nombre de la fuente");
  if (r.anada === null && !r.sin_anada) faltan.push("la añada");
  return faltan;
}

/** Fila lista para insertar/actualizar (upsert por vino y añada). */
export function filaParaGuardar(vinoId: string, r: ResultadoParker, origen: OrigenParker) {
  return {
    vino_id: vinoId,
    anada: r.sin_anada ? null : r.anada,
    sin_anada: r.sin_anada,
    estado: r.estado,
    motivo: r.motivo,
    puntos_texto: r.puntos_texto,
    puntos_min: r.puntos_min,
    puntos_max: r.puntos_max,
    provisional: r.provisional,
    vino_evaluado: r.vino_evaluado,
    entidad: r.entidad || ENTIDAD_PARKER,
    critico: r.critico,
    fecha_valoracion: r.fecha_valoracion,
    fuente_nombre: r.fuente_nombre,
    fuente_url: r.fuente_url,
    fuente_tipo: r.fuente_tipo,
    cita: r.cita,
    fecha_consulta: r.fecha_consulta,
    discrepancias: r.discrepancias ?? [],
    notas: r.notas,
    origen,
  };
}

/** Hoy en Madrid, AAAA-MM-DD. */
export function hoyMadrid(ahora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

/**
 * Puntuación escrita a mano por el dueño (con su fuente). «verificada» solo si
 * marca que la ha comprobado y tiene todo lo que exige la base de datos.
 */
export function resultadoManual(datos: {
  puntos: string;
  anada: number | null;
  sin_anada: boolean;
  fuente_nombre: string;
  fuente_url: string;
  critico?: string;
  fecha_valoracion?: string;
  comprobada: boolean;
}): { resultado: ResultadoParker | null; error: string | null } {
  const t = datos.puntos.trim().replace(/\s+/g, "").replace(/[–—]/g, "-");
  const m = /^(\()?(\d{2,3})(\+)?(?:-(\d{2,3})(\+)?)?(\))?$/.exec(t);
  if (!m) return { resultado: null, error: "Escribe la puntuación como la publica la fuente: 94, 94+ o 93-95" };
  const min = Number(m[2]);
  const max = m[4] ? Number(m[4]) : min;
  if (min < 50 || max > 100 || max < min) return { resultado: null, error: "La puntuación Parker va de 50 a 100" };
  const url = datos.fuente_url.trim();
  if (url && !/^https?:\/\/\S+$/i.test(url)) return { resultado: null, error: "La URL de la fuente tiene que empezar por https://" };
  const r: ResultadoParker = {
    estado: "revision",
    motivo: null,
    anada: datos.sin_anada ? null : datos.anada,
    sin_anada: datos.sin_anada,
    puntos_texto: t,
    puntos_min: min,
    puntos_max: max,
    provisional: Boolean(m[1] && m[6]),
    vino_evaluado: null,
    entidad: ENTIDAD_PARKER,
    critico: datos.critico?.trim() || null,
    fecha_valoracion: datos.fecha_valoracion?.trim() || null,
    fuente_nombre: datos.fuente_nombre.trim() || null,
    fuente_url: url || null,
    fuente_tipo: "manual",
    cita: null,
    fecha_consulta: hoyMadrid(),
    discrepancias: [],
    notas: "Añadida a mano desde el panel.",
  };
  if (datos.comprobada) {
    const faltan = faltaParaVerificar(r);
    if (faltan.length) return { resultado: null, error: `Para marcarla como verificada falta ${faltan.join(", ")}` };
    r.estado = "verificada";
  }
  return { resultado: r, error: null };
}

export interface PeticionParker {
  vino_id?: string | null;
  nombre: string;
  bodega?: string | null;
  cuvee?: string | null;
  denominacion_origen?: string | null;
  anada: number | null;
  sin_anada: boolean;
  forzar?: boolean;
  puntuacion_etiqueta?: { puntos: number | null; entidad: string | null; anada: number | null } | null;
}

export class ErrorBusquedaParker extends Error {
  resultado: ResultadoParker | null;
  constructor(mensaje: string, resultado: ResultadoParker | null) {
    super(mensaje);
    this.resultado = resultado;
  }
}

/** Llama a `buscar-puntuacion-parker`. Lanza ErrorBusquedaParker (con resultado «fallida») si falla. */
export async function buscarPuntuacionParker(p: PeticionParker): Promise<{ resultado: ResultadoParker; desdeCache: boolean }> {
  const { data, error } = await supabase.functions.invoke("buscar-puntuacion-parker", { body: p });
  if (error) {
    throw new ErrorBusquedaParker(await mensajeErrorFuncion(error, "No se pudo buscar la puntuación"), null);
  }
  if (!data?.ok || !data?.resultado) {
    throw new ErrorBusquedaParker(String(data?.error ?? "No se pudo buscar la puntuación"), (data?.resultado as ResultadoParker) ?? null);
  }
  return { resultado: data.resultado as ResultadoParker, desdeCache: data.desde_cache === true };
}
