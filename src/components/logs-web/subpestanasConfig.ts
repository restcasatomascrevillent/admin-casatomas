/**
 * Super Admin › Logs › Configuración: subpestañas (petición del dueño,
 * 14/11/2026: «añade subpestañas para que no haya scroll infinito»).
 * Una sola configuración (una fila) repartida en subpestañas: el borrador es
 * uno y «Guardar configuración» guarda todo, esté donde esté. Cada subpestaña
 * marca con un punto si tiene cambios sin guardar. La elegida va en la URL
 * (?tab=configuracion&config=linear) para que los enlaces lleven a ella.
 */
import { Activity, Archive, BellRing, Radar, Sparkles, Ticket } from "lucide-react";
import type { ConfigLogsWeb } from "@/hooks/useLogsWeb";

export const SUBPESTANAS_CONFIG = [
  { valor: "recogida", etiqueta: "Recogida", icono: Radar },
  { valor: "incidencias", etiqueta: "Incidencias y avisos", icono: BellRing },
  { valor: "linear", etiqueta: "Linear", icono: Ticket },
  { valor: "ia", etiqueta: "IA y costes", icono: Sparkles },
  { valor: "retencion", etiqueta: "Retención y límites", icono: Archive },
  { valor: "estado", etiqueta: "Estado y cobertura", icono: Activity },
] as const;
export type SubpestanaConfig = (typeof SUBPESTANAS_CONFIG)[number]["valor"];

/** Qué campos de la configuración se editan en cada subpestaña (para marcar los cambios sin guardar). */
export const CAMPOS_SUBPESTANA: Record<SubpestanaConfig, Array<keyof ConfigLogsWeb>> = {
  recogida: ["recoger_actividad", "recoger_errores_navegador", "recoger_peticiones", "recoger_errores_servidor", "recoger_integraciones", "recoger_hosting",
    "entornos_aceptados", "rutas_excluidas", "mensajes_ignorados"],
  incidencias: ["umbral_ocurrencias", "umbral_sesiones", "umbral_ventana_horas", "umbral_404_diario", "tickets_404", "excluir_pruebas_tickets", "reapertura",
    "entornos_ticket", "linear_tickets_externos"],
  linear: ["linear_modo", "linear_equipo_id", "linear_proyecto_id", "linear_etiquetas", "linear_estado_reabrir_id", "linear_max_tickets_dia"],
  ia: ["ia_activada", "ia_max_analisis_dia"],
  retencion: ["retencion_actividad_dias", "retencion_errores_dias", "limite_eventos_dia", "limite_eventos_sesion", "limite_eventos_ip_minuto"],
  estado: [],
};

/** La subpestaña de la URL, o la primera si no existe. */
export function subpestanaConfig(v: string | null | undefined): SubpestanaConfig {
  return SUBPESTANAS_CONFIG.some((x) => x.valor === v) ? (v as SubpestanaConfig) : "recogida";
}

/** Subpestañas con algún campo distinto de lo guardado. */
export function subpestanasConCambios(guardada: ConfigLogsWeb | null | undefined, borrador: ConfigLogsWeb | null | undefined): SubpestanaConfig[] {
  if (!guardada || !borrador) return [];
  return SUBPESTANAS_CONFIG.map((x) => x.valor).filter((sp) =>
    CAMPOS_SUBPESTANA[sp].some((k) => JSON.stringify(guardada[k] ?? null) !== JSON.stringify(borrador[k] ?? null)));
}
