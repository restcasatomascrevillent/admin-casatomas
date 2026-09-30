// ============================================================================
// VISTA UNIFICADA DE RESERVAS — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// La pestaña "Reservas" junta lo que antes eran tres pestañas (Hoy, Lista,
// Solicitudes). Las solicitudes que el bot telefónico no pudo resolver siguen
// viviendo en su tabla (`solicitudes_pendientes`) — NO se migran a
// `reservas`: tienen otro ciclo de vida (pendiente → contactado → resuelta |
// descartada), otro trigger (campana) y muchas no llegan nunca a ser reserva.
// La fusión es solo de presentación: este módulo convierte ambas fuentes en
// filas de una misma lista y aplica los mismos filtros a las dos.
// ============================================================================

import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";
import { coincideNegocio, marcaDeReserva, marcaDeSolicitud } from "./negocios";
import { ESTADOS_RESERVA, type EstadoReserva } from "./estadosReserva";

/** Mínimo de `reservas` que necesita la lista unificada. */
export interface ReservaListable {
  id: string;
  fecha: string;
  hora: string;
  nombre: string | null;
  telefono?: string | null;
  email?: string | null;
  estado: string;
  canal?: string | null;
  numero_comensales: number;
  notas_cliente?: string | null;
  /** Negocio (`reservas.marca`): casa_tomas | touza. */
  marca?: string | null;
}

export type FilaUnificada<R extends ReservaListable = ReservaListable> =
  | { tipo: "reserva"; id: string; fecha: string | null; hora: string | null; reserva: R }
  | { tipo: "solicitud"; id: string; fecha: string | null; hora: string | null; solicitud: SolicitudPendiente };

/** Estados de solicitud que todavía requieren que alguien haga algo. */
export const ESTADOS_SOLICITUD_ABIERTA = ["pendiente", "contactado"] as const;
export const esSolicitudAbierta = (estado: string) =>
  (ESTADOS_SOLICITUD_ABIERTA as readonly string[]).includes(estado);

/**
 * Valores del filtro "Estado" de la lista. Los de reserva son los del CHECK
 * `reservas_estado_check`; los dos últimos son de solicitudes.
 */
export const FILTRO_SOLICITUDES = "solicitudes";
export const FILTRO_SOLICITUDES_CERRADAS = "solicitudes_cerradas";

/**
 * Orden de los estados en el filtro: «No vino» antes que «Cancelada» (el ciclo de
 * vida del timeline las pone al revés). El TEXTO no se escribe aquí: sale de
 * `ESTADOS_RESERVA` (`etiquetaFiltro`), la fuente única de los nombres de estado.
 */
const ORDEN_ESTADOS_EN_FILTRO: readonly EstadoReserva[] = [
  "pendiente",
  "verificada",
  "confirmada",
  "completada",
  "no_show",
  "cancelada",
];

export const OPCIONES_FILTRO_ESTADO: { value: string; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: FILTRO_SOLICITUDES, label: "Solicitudes sin resolver" },
  ...ORDEN_ESTADOS_EN_FILTRO.map((estado) => ({ value: estado, label: ESTADOS_RESERVA[estado].etiquetaFiltro })),
  { value: FILTRO_SOLICITUDES_CERRADAS, label: "Solicitudes cerradas" },
];

export interface FiltrosListaUnificada {
  busqueda?: string;
  /** "all" | estado de reserva | FILTRO_SOLICITUDES | FILTRO_SOLICITUDES_CERRADAS */
  estado?: string;
  /** "all" | telefono | web | manual */
  canal?: string;
  /** "yyyy-MM-dd" */
  fecha?: string | null;
  /** "all" | casa_tomas | touza (ver src/lib/reservas/negocios.ts). */
  negocio?: string;
  /** Negocio de una solicitud (no tiene columna marca). Por defecto:
   * marcador de El Reservado en las notas, si no Casa Tomás. */
  marcaDeSolicitud?: (s: SolicitudPendiente) => string;
}

const normalizarHora = (hora: string | null | undefined) =>
  hora ? String(hora).substring(0, 5) : null;

export function unificarReservasYSolicitudes<R extends ReservaListable>(
  reservas: R[],
  solicitudes: SolicitudPendiente[],
): FilaUnificada<R>[] {
  const filas: FilaUnificada<R>[] = [
    ...reservas.map((r) => ({
      tipo: "reserva" as const,
      id: r.id,
      fecha: r.fecha ?? null,
      hora: normalizarHora(r.hora),
      reserva: r,
    })),
    ...solicitudes.map((s) => ({
      tipo: "solicitud" as const,
      id: `solicitud-${s.id}`,
      fecha: s.fecha_solicitada ?? null,
      hora: normalizarHora(s.hora_solicitada),
      solicitud: s,
    })),
  ];
  return ordenarFilas(filas);
}

/**
 * Orden: solicitudes ABIERTAS primero (son trabajo pendiente y el bot ya le
 * dijo al cliente que le llamarían), luego por fecha descendente — igual que
 * la antigua pestaña Lista — y hora ascendente dentro del día.
 */
export function ordenarFilas<R extends ReservaListable>(filas: FilaUnificada<R>[]): FilaUnificada<R>[] {
  const peso = (f: FilaUnificada<R>) =>
    f.tipo === "solicitud" && esSolicitudAbierta(f.solicitud.estado) ? 0 : 1;
  return [...filas].sort((a, b) => {
    const p = peso(a) - peso(b);
    if (p !== 0) return p;
    const fa = a.fecha ?? "";
    const fb = b.fecha ?? "";
    if (fa !== fb) return fa < fb ? 1 : -1;
    const ha = a.hora ?? "99:99";
    const hb = b.hora ?? "99:99";
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
}

function coincideBusqueda(textos: (string | null | undefined)[], termino: string) {
  if (!termino) return true;
  return textos.some((t) => (t ?? "").toLowerCase().includes(termino));
}

export function filtrarFilasUnificadas<R extends ReservaListable>(
  filas: FilaUnificada<R>[],
  filtros: FiltrosListaUnificada,
): FilaUnificada<R>[] {
  const termino = (filtros.busqueda ?? "").trim().toLowerCase();
  const estado = filtros.estado ?? "all";
  const canal = filtros.canal ?? "all";
  const fecha = filtros.fecha ?? null;
  const negocio = filtros.negocio ?? "all";
  const marcaSolicitud = filtros.marcaDeSolicitud ?? ((s: SolicitudPendiente) => marcaDeSolicitud(s, []));

  return filas.filter((f) => {
    if (fecha && f.fecha !== fecha) return false;
    if (
      negocio !== "all" &&
      !coincideNegocio(f.tipo === "reserva" ? marcaDeReserva(f.reserva) : marcaSolicitud(f.solicitud), negocio)
    ) {
      return false;
    }

    if (f.tipo === "solicitud") {
      const s = f.solicitud;
      if (estado === FILTRO_SOLICITUDES && !esSolicitudAbierta(s.estado)) return false;
      if (estado === FILTRO_SOLICITUDES_CERRADAS && esSolicitudAbierta(s.estado)) return false;
      // "Todos" muestra solo las solicitudes abiertas: las cerradas son
      // historial y se consultan con su filtro propio.
      if (estado === "all" && !esSolicitudAbierta(s.estado)) return false;
      if (estado !== "all" && estado !== FILTRO_SOLICITUDES && estado !== FILTRO_SOLICITUDES_CERRADAS) {
        return false;
      }
      // Hoy solo el canal telefónico registra solicitudes.
      if (canal !== "all" && canal !== "telefono") return false;
      return coincideBusqueda(
        [s.nombre, s.telefono, s.email, s.notas_cliente, s.notas_internas, s.descripcion_rechazo],
        termino,
      );
    }

    const r = f.reserva;
    if (estado === FILTRO_SOLICITUDES || estado === FILTRO_SOLICITUDES_CERRADAS) return false;
    if (estado !== "all" && r.estado !== estado) return false;
    if (canal !== "all" && (r.canal || "web") !== canal) return false;
    return coincideBusqueda([r.nombre, r.telefono, r.email, r.notas_cliente], termino);
  });
}

// ----------------------------------------------------------------------------
// Deep links: /reservas?tab=...&status=...&date=today
// ----------------------------------------------------------------------------
// "asignacion": panel de salas y mesas (reservas-sin-salas, Fase B); la
// campana enlaza ahí las notificaciones `reserva_sin_asignar`.
export const TABS_RESERVAS = ["reservas", "calendario", "asignacion", "blacklist", "configuracion"] as const;
export type TabReservas = (typeof TABS_RESERVAS)[number];

export interface DestinoDeepLink {
  tab: TabReservas;
  status?: string;
  date?: "today";
}

/**
 * Traduce los parámetros de URL (incluidas las pestañas antiguas `hoy`,
 * `lista` y `solicitudes`, que siguen en marcadores, widgets y correos
 * internos) a la estructura nueva. Nunca devuelve una pestaña inexistente.
 */
export function resolverDeepLinkReservas(params: {
  tab?: string | null;
  status?: string | null;
  date?: string | null;
}): DestinoDeepLink {
  const tab = params.tab ?? null;
  const status = params.status || undefined;
  const date = params.date === "today" ? ("today" as const) : undefined;

  switch (tab) {
    case "solicitudes":
      return { tab: "reservas", status: status ?? FILTRO_SOLICITUDES, date };
    case "hoy":
    case "lista":
    case null:
      return { tab: "reservas", status, date };
    default:
      return (TABS_RESERVAS as readonly string[]).includes(tab)
        ? { tab: tab as TabReservas, status, date }
        : { tab: "reservas", status, date };
  }
}
