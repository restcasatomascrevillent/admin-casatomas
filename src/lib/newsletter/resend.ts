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
