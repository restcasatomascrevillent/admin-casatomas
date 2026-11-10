// ============================================================================
// «SENTAR FUERA» — reglas puras (10/11/2026)
// ----------------------------------------------------------------------------
// Petición del dueño: «Añade un botón en hoy de reservas azul chillón que sea sentar fuera y sean mesas que
// no cuenten en los espacios predefinidos pero sí que se guarde esa info, por lo general se sientan en Touza
// o Terraza Touza».
//
// Sentar fuera ES sentar: la reserva pasa a «Llegó» (`completada`, con `llegada_at`) y se guarda DÓNDE
// (`fuera_lugar`: «Touza», «Terraza Touza» u otro texto) y, si se quiere, la mesa o una nota (`fuera_mesa`).
// Mientras está fuera NO está en ninguna sala: `espacio_id` es NULL y no tiene mesas (lo hace el trigger
// `trg_reservas_sentada_fuera`, migración 20261122171500, que además guarda la sala de antes en
// `fuera_espacio_previo_id` y se la devuelve al deshacer). Por eso no cuenta en Hoy, plano, rejilla de salas,
// Asignación ni modo servicio, y la web (que solo cuenta pendiente/verificada/confirmada) tampoco la ve.
// ============================================================================

import { ESTADO_LLEGADA, esEstadoVivo } from "./estadosReserva";
import type { CambiosReserva } from "./escribirReserva";

/** Los sitios de fuera habituales: botones rápidos del diálogo, por este orden. */
export const LUGARES_FUERA_RAPIDOS = ["Touza", "Terraza Touza"] as const;

/** Largo máximo (el mismo que los CHECK de la migración). */
export const MAX_LUGAR_FUERA = 60;
export const MAX_MESA_FUERA = 120;

/** Lo que una reserva tiene de «fuera» (columnas opcionales: sin la migración no vienen). */
export interface ReservaConFuera {
  estado: string;
  fuera_lugar?: string | null;
  fuera_mesa?: string | null;
}

/** Lo que se elige en el diálogo. */
export interface DatosFuera {
  lugar: string;
  mesa?: string | null;
}

/** ¿Está sentada fuera ahora? (fuera solo cuenta con «Llegó», como en la BD.) */
export function estaSentadaFuera(r: ReservaConFuera | null | undefined): boolean {
  return !!r && r.estado === ESTADO_LLEGADA && !!(r.fuera_lugar ?? "").trim();
}

/** Texto limpio: sin espacios de más y recortado al máximo. */
export function limpiarTextoFuera(texto: string | null | undefined, max: number): string {
  return (texto ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** «Mesa 4» si es un número; si no, la nota tal cual. */
export function textoMesaFuera(mesa: string | null | undefined): string {
  const m = limpiarTextoFuera(mesa, MAX_MESA_FUERA);
  if (!m) return "";
  return /^\d+[a-zA-Z]?$/.test(m) ? `Mesa ${m}` : m;
}

/** La etiqueta de la tarjeta: «Fuera · Touza» o «Fuera · Touza · Mesa 4». Vacío si no está fuera. */
export function etiquetaFuera(r: ReservaConFuera | null | undefined, { conMesa = true }: { conMesa?: boolean } = {}): string {
  if (!estaSentadaFuera(r)) return "";
  const mesa = conMesa ? textoMesaFuera(r!.fuera_mesa) : "";
  return ["Fuera", limpiarTextoFuera(r!.fuera_lugar, MAX_LUGAR_FUERA), mesa].filter(Boolean).join(" · ");
}

/** ¿Desde qué estado se puede sentar fuera? Las que aún no han llegado y las ya sentadas (dentro o fuera). */
export function puedeSentarseFuera(r: { estado: string; salida_at?: string | null }): boolean {
  return esEstadoVivo(r.estado) || (r.estado === ESTADO_LLEGADA && !r.salida_at);
}

/** Por qué no vale lo elegido (`null`: vale). */
export function problemaDatosFuera(datos: DatosFuera): string | null {
  if (!limpiarTextoFuera(datos.lugar, MAX_LUGAR_FUERA)) return "Elige dónde se sientan (Touza, Terraza Touza u otro).";
  return null;
}

/**
 * Las columnas que escribe «Sentar fuera» (también para cambiar el sitio de una que ya está fuera).
 * `espacio_id: null` va explícito para que el trigger de la BD que borra las mesas al cambiar de sala
 * (`trg_reservas_sincronizar_asignaciones`) también salte; el de «fuera» lo haría igual.
 */
export function cambiosSentarFuera(
  reserva: { estado: string; espacio_id?: string | null; llegada_at?: string | null; fuera_lugar?: string | null },
  datos: DatosFuera,
  ahora: Date,
): CambiosReserva {
  const yaSentada = reserva.estado === ESTADO_LLEGADA;
  const cambios: CambiosReserva = {
    estado: ESTADO_LLEGADA,
    espacio_id: null,
    fuera_lugar: limpiarTextoFuera(datos.lugar, MAX_LUGAR_FUERA),
    fuera_mesa: limpiarTextoFuera(datos.mesa, MAX_MESA_FUERA) || null,
  };
  // La hora de llegada es la de verdad: si ya estaba sentada (dentro o fuera), no se toca.
  if (!yaSentada || !reserva.llegada_at) cambios.llegada_at = ahora.toISOString();
  // La sala de antes, para volver al deshacer (el trigger también la guarda; aquí, para el parche optimista).
  if (!estaSentadaFuera(reserva as ReservaConFuera) && reserva.espacio_id) cambios.fuera_espacio_previo_id = reserva.espacio_id;
  return cambios;
}

/**
 * «Sentar dentro»: deja de estar fuera y sigue «Llegó» (sin mesa: se le da desde la ficha). La sala vuelve
 * sola (el trigger pone la de antes). Para el parche optimista se pone aquí también.
 */
export function cambiosQuitarFuera(reserva: { fuera_espacio_previo_id?: string | null }): CambiosReserva {
  return {
    fuera_lugar: null,
    fuera_mesa: null,
    fuera_espacio_previo_id: null,
    ...(reserva.fuera_espacio_previo_id ? { espacio_id: reserva.fuera_espacio_previo_id } : {}),
  };
}

/** Columnas de «fuera» que lee Hoy (se añaden a `COLUMNAS_RESERVAS_HOY`). */
export const COLUMNAS_FUERA = "fuera_lugar, fuera_mesa, fuera_espacio_previo_id";

/** ¿El error es porque aún no existen las columnas de fuera (migración 20261122171500 sin aplicar)? */
export function esErrorColumnasFueraInexistentes(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  const texto = `${e?.message ?? ""}`;
  return (e?.code === "42703" || e?.code === "PGRST204" || /column|columna/i.test(texto)) && /fuera_|menu_cerrado|menu_precio|zona_preferida/.test(texto);
}

/** Mensaje si se intenta sentar fuera sin la migración aplicada. */
export const MENSAJE_FUERA_SIN_MIGRACION =
  "Falta preparar la base de datos para «Sentar fuera» (migración 20261122171500). Avisa al administrador.";
