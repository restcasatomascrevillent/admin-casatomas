// ============================================================================
// Lista de envío del newsletter — textos y cálculos del panel (lógica pura)
// ----------------------------------------------------------------------------
// Las reglas (canal, límite de contactos, aviso al 80 %) vienen del mismo
// fichero que usan las funciones: supabase/functions/_shared/resend-marketing/
// config.ts (puro, sin Deno). El estado lo da newsletter-sync-resend
// ({accion: "estado"}); ver docs/funcionalidades/newsletter-resend-marketing.md.
// ============================================================================

import { formatoNumero, plural, textoErrorCliente } from "./textos";
import {
  nivelCuota,
  type CanalNewsletter,
  type NivelCuota,
} from "../../../supabase/functions/_shared/resend-marketing/config";

export { nivelCuota };
export type { CanalNewsletter, NivelCuota };

export interface PasadaResend {
  id: string;
  origen: "panel" | "cron" | "envio";
  estado: "en_curso" | "ok" | "parcial" | "error";
  iniciada_at: string;
  terminada_at: string | null;
  segment_id: string | null;
  contactos_resend: number | null;
  contactos_segmento: number | null;
  contactos_ajenos: number | null;
  destinatarios: number | null;
  altas: number;
  actualizados: number;
  borrados: number;
  bajas_resend: number;
  errores: number;
  pendientes: number;
  mensaje_error: string | null;
}

/** Respuesta de newsletter-sync-resend con {accion: "estado"}. */
export interface EstadoResend {
  success: boolean;
  canal: CanalNewsletter;
  configurado: { api_key: boolean; segment_id: string | null; cron_secret: boolean };
  limite_contactos: number;
  contactos_resend: number | null;
  nivel_cuota: NivelCuota;
  ultima_pasada: PasadaResend | null;
  ultima_terminada: PasadaResend | null;
}

/** Respuesta de newsletter-sync-resend con {accion: "sincronizar"}. */
export interface ResultadoSincronizacion {
  success: boolean;
  estado: "ok" | "parcial" | "error";
  contactos_resend: number | null;
  limite_contactos: number;
  destinatarios: number | null;
  altas: number;
  borrados: number;
  bajas_resend: number;
  pendientes: number;
  bloquea_envio: boolean;
  total_errores: number;
  segmento_creado?: boolean;
  segment_id?: string | null;
  error?: string;
}

/** Etiqueta corta de cómo saldrá la newsletter. */
export function textoCanal(canal: CanalNewsletter | null | undefined): string {
  return canal === "broadcast" ? "Por lista de envío" : "Correo directo";
}

export function porcentajeCuota(usados: number | null | undefined, limite: number): number {
  if (!usados || !limite) return 0;
  return Math.min(100, Math.round((usados / limite) * 100));
}

export function textoCuota(usados: number | null | undefined, limite: number): string {
  const nivel = nivelCuota(usados, limite);
  const max = formatoNumero(limite);
  if (nivel === "lleno") {
    return `Has llegado al máximo de contactos del plan (${max}). No se puede enviar la newsletter hasta liberar contactos o ampliar el plan. Avisa al equipo técnico.`;
  }
  if (nivel === "aviso") {
    return `Estás usando más del 80 % de los contactos del plan (máx. ${max}). Conviene revisar la lista o ampliar el plan antes de llegar al máximo.`;
  }
  return "";
}

const ETIQUETA_PASADA: Record<PasadaResend["estado"], string> = {
  en_curso: "En curso",
  ok: "Correcta",
  parcial: "Con avisos",
  error: "Con errores",
};

const ETIQUETA_ORIGEN: Record<PasadaResend["origen"], string> = {
  panel: "desde el panel",
  cron: "automática diaria",
  envio: "antes de un envío",
};

export function etiquetaPasada(p: Pick<PasadaResend, "estado">): string {
  return ETIQUETA_PASADA[p.estado] ?? p.estado;
}

export function etiquetaOrigenPasada(p: Pick<PasadaResend, "origen">): string {
  return ETIQUETA_ORIGEN[p.origen] ?? p.origen;
}

/** Mensaje para el aviso tras pulsar «Actualizar lista de envío». */
export function mensajeSincronizacion(r: ResultadoSincronizacion): { tipo: "ok" | "aviso" | "error"; texto: string } {
  if (!r.success || r.estado === "error") {
    return {
      tipo: "error",
      texto: textoErrorCliente(r.error, "No se pudo actualizar la lista de envío. Inténtalo de nuevo y, si sigue igual, avisa al equipo técnico."),
    };
  }
  const partes: string[] = [];
  if (r.altas) partes.push(plural(r.altas, "añadido", "añadidos"));
  if (r.borrados) partes.push(plural(r.borrados, "quitado", "quitados"));
  if (r.bajas_resend) partes.push(plural(r.bajas_resend, "baja nueva", "bajas nuevas"));
  const cambios = partes.length ? partes.join(", ") : "sin cambios";
  if (r.pendientes > 0) {
    return {
      tipo: "aviso",
      texto: `La lista se ha actualizado a medias (${cambios}): quedan ${plural(r.pendientes, "cambio", "cambios")} por aplicar. Vuelve a pulsar «Actualizar lista de envío».`,
    };
  }
  if (r.total_errores > 0) {
    return { tipo: "aviso", texto: `Lista de envío actualizada con ${plural(r.total_errores, "aviso", "avisos")} (${cambios}).` };
  }
  return { tipo: "ok", texto: `Lista de envío actualizada: ${cambios}.` };
}

export interface FilaEstadistica {
  broadcast_id: string;
  tipo_evento: string;
  eventos: number;
  destinatarios: number;
}

export interface EstadisticasBroadcast {
  entregados: number;
  abiertos: number;
  clics: number;
  rebotes: number;
  quejas: number;
}

/** Agrupa newsletter_estadisticas_broadcasts por Broadcast (destinatarios distintos por tipo de evento). */
export function agruparEstadisticas(filas: FilaEstadistica[]): Map<string, EstadisticasBroadcast> {
  const out = new Map<string, EstadisticasBroadcast>();
  for (const f of filas) {
    const e = out.get(f.broadcast_id) ?? { entregados: 0, abiertos: 0, clics: 0, rebotes: 0, quejas: 0 };
    const n = Number(f.destinatarios) || 0;
    if (f.tipo_evento === "delivered") e.entregados = n;
    else if (f.tipo_evento === "opened") e.abiertos = n;
    else if (f.tipo_evento === "clicked") e.clics = n;
    else if (f.tipo_evento === "bounced") e.rebotes = n;
    else if (f.tipo_evento === "complained") e.quejas = n;
    out.set(f.broadcast_id, e);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Autoactualización al abrir la pestaña «Suscriptores»
// ----------------------------------------------------------------------------
// Mientras el cron diario no esté programado en producción, la lista de envío
// solo se actualiza al pulsar el botón o justo antes de un envío; así el
// contador «Contactos: N de 1.000» se quedaba atrás tras una alta nueva. La
// tarjeta lanza UNA sincronización en segundo plano al montarse si hace falta
// (ver SincronizacionResend). La función usa cerrojo: si ya hay otra pasada
// en curso responde 409 y no se reintenta.

/** Por qué se lanza la sincronización automática (null = no hace falta). */
export type MotivoAutoSincronizacion = "nunca" | "antigua" | "difiere" | "fallida";

/** La última sincronización correcta caduca a las 24 h. */
export const MS_CADUCIDAD_SINCRONIZACION = 24 * 60 * 60 * 1000;
/** Igual que el cerrojo de la función: una pasada «en curso» de más de 15 min está colgada y la siguiente la cierra. */
export const MS_PASADA_COLGADA = 15 * 60 * 1000;
/** Tras una pasada fallida no se reintenta sola durante 15 min (el error ya se ve en la tarjeta y el botón sigue ahí). */
export const MS_ESPERA_TRAS_ERROR = 15 * 60 * 1000;

function msDesde(fecha: string | null | undefined, ahora: number): number | null {
  if (!fecha) return null;
  const t = new Date(fecha).getTime();
  return Number.isNaN(t) ? null : ahora - t;
}

/** Suscriptores activos distintos por email (la sincronización agrupa por email normalizado). */
export function contarEmailsActivos(activos: ReadonlyArray<{ email: string | null | undefined }>): number {
  return new Set(activos.map((s) => (s.email ?? "").trim().toLowerCase()).filter(Boolean)).size;
}

/**
 * Decide si la tarjeta debe sincronizar sola al abrirse.
 *  · `activos`: suscriptores activos del panel (null si no se pudieron cargar:
 *    entonces solo cuentan la antigüedad y si hubo alguna sincronización).
 * Devuelve null si no hace falta o si no se debe (sin clave, otra pasada en
 * curso, error reciente).
 */
export function motivoAutoSincronizacion(
  estado: Pick<EstadoResend, "configurado" | "ultima_pasada" | "ultima_terminada">,
  activos: number | null,
  ahora: number = Date.now(),
): MotivoAutoSincronizacion | null {
  if (!estado.configurado?.api_key) return null;

  const ultima = estado.ultima_pasada;
  if (ultima?.estado === "en_curso") {
    const edad = msDesde(ultima.iniciada_at, ahora);
    if (edad === null || edad < MS_PASADA_COLGADA) return null;
  }

  const ref = estado.ultima_terminada ?? (ultima && ultima.estado !== "en_curso" ? ultima : null);
  if (!ref) return "nunca";

  const edad = msDesde(ref.terminada_at ?? ref.iniciada_at, ahora);
  if (ref.estado === "error") {
    return edad !== null && edad < MS_ESPERA_TRAS_ERROR ? null : "fallida";
  }
  if (edad === null || edad > MS_CADUCIDAD_SINCRONIZACION) return "antigua";

  if (activos !== null) {
    // «destinatarios» = activos con contacto dentro de la lista tras esa pasada
    // (no cuenta contactos ajenos metidos a mano en el servicio de envío).
    const enLista = ref.destinatarios ?? ref.contactos_resend;
    if (enLista === null || enLista !== activos) return "difiere";
  }
  return null;
}

/**
 * Por qué «Contactos» puede ser mayor que los que reciben el envío.
 * `contactos_resend` cuenta TODOS los contactos de la cuenta del servicio de
 * envío (es lo que cuenta para el máximo del plan). Los que no están en
 * newsletter_suscriptores salen como `contactos_ajenos` en la pasada; el más
 * habitual es la dirección del botón «Enviar prueba» (enviar-newsletter/
 * prueba.ts: NEWSLETTER_EMAIL_PRUEBA, por defecto delivered@resend.dev, que
 * vive en un Segment de pruebas aparte y nunca recibe la newsletter). El resto
 * serían contactos metidos a mano en el servicio. Sin llamar a la API no se
 * puede saber cuál es cuál, así que el texto lo dice así.
 * Devuelve "" si no hay nada que explicar.
 */
export function textoContactosAjenos(
  p: Pick<PasadaResend, "contactos_resend" | "contactos_ajenos"> | null | undefined,
): string {
  const ajenos = p?.contactos_ajenos ?? 0;
  if (!p || p.contactos_resend === null || ajenos <= 0) return "";
  if (ajenos === 1) {
    return "Incluye 1 contacto que no es suscriptor (normalmente la dirección de pruebas del botón «Enviar prueba»): no recibe la newsletter, pero cuenta para el máximo.";
  }
  return `Incluye ${formatoNumero(ajenos)} contactos que no son suscriptores (la dirección de pruebas del botón «Enviar prueba» y otros añadidos a mano en el servicio de envío): no reciben la newsletter, pero cuentan para el máximo.`;
}
