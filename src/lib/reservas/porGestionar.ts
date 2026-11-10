// ============================================================================
// «POR GESTIONAR» DE LA CAMPANA — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// Pedido del dueño (10/11/2026): «una campanita para que salgan las reservas que
// tienen que gestionar». Junta dos cosas que esperan al personal:
//   · reservas `pendiente` o `verificada` (aún sin confirmar) de hoy en adelante;
//   · solicitudes del bot sin resolver (`pendiente` o `contactado`).
// Solo Casa Tomás (`admiteReservas`), igual que la Lista.
// ============================================================================

import { admiteReservas } from "./negocios";
import { esSolicitudAbierta } from "./vistaUnificada";
import { ESTADO_PENDIENTE, ESTADO_VERIFICADA } from "./estadosReserva";

/** Estados de reserva que la campana considera «por gestionar». */
export const ESTADOS_RESERVA_POR_GESTIONAR = [ESTADO_PENDIENTE, ESTADO_VERIFICADA] as const;

export interface ReservaPorGestionarFila {
  id: string;
  nombre: string | null;
  fecha: string;
  hora: string | null;
  numero_comensales: number | null;
  estado: string;
  marca?: string | null;
}

export interface SolicitudPorGestionarFila {
  id: string;
  nombre: string | null;
  fecha_solicitada: string | null;
  hora_solicitada: string | null;
  numero_comensales: number | null;
  motivo_rechazo: string | null;
  estado: string;
  marca?: string | null;
}

export interface ItemPorGestionar {
  clave: string;
  tipo: "reserva" | "solicitud";
  id: string;
  fecha: string | null;
  /** «HH:mm» */
  hora: string | null;
  nombre: string;
  personas: number | null;
  /** Estado de la reserva o motivo de la solicitud, ya en español. */
  detalle: string;
  /** Adónde lleva al tocarla. */
  ruta: string;
}

const MOTIVOS_SOLICITUD: Record<string, string> = {
  grupo_grande: "Grupo grande",
  sin_disponibilidad: "Sin disponibilidad",
  reserva_hoy: "Para hoy",
  corte_horario: "Fuera de horario",
  max_reservas_telefono: "Límite por teléfono",
  max_reservas_email: "Límite por email",
};

export const motivoSolicitud = (motivo: string | null | undefined): string =>
  (motivo && MOTIVOS_SOLICITUD[motivo]) || "Solicitud del asistente";

const hhmm = (hora: string | null | undefined) => (hora ? String(hora).substring(0, 5) : null);

export const RUTA_SOLICITUDES = "/reservas?tab=reservas&status=solicitudes";
export const rutaReservaPorGestionar = (estado: string) => `/reservas?tab=reservas&status=${encodeURIComponent(estado)}`;

/**
 * Lista única ordenada por fecha y hora (lo más próximo primero; sin fecha, al final).
 * `hoy` («yyyy-MM-dd») descarta reservas pasadas por si la consulta trae alguna.
 */
export function construirItemsPorGestionar(
  reservas: readonly ReservaPorGestionarFila[],
  solicitudes: readonly SolicitudPorGestionarFila[],
  hoy: string,
): ItemPorGestionar[] {
  const deReservas: ItemPorGestionar[] = reservas
    .filter(
      (r) =>
        (ESTADOS_RESERVA_POR_GESTIONAR as readonly string[]).includes(r.estado) && r.fecha >= hoy && admiteReservas(r.marca),
    )
    .map((r) => ({
      clave: `reserva-${r.id}`,
      tipo: "reserva",
      id: r.id,
      fecha: r.fecha,
      hora: hhmm(r.hora),
      nombre: r.nombre?.trim() || "Sin nombre",
      personas: r.numero_comensales,
      detalle: r.estado === ESTADO_VERIFICADA ? "Verificada · falta confirmar" : "Pendiente de confirmar",
      ruta: rutaReservaPorGestionar(r.estado),
    }));
  const deSolicitudes: ItemPorGestionar[] = solicitudes
    .filter((s) => esSolicitudAbierta(s.estado) && admiteReservas(s.marca))
    .map((s) => ({
      clave: `solicitud-${s.id}`,
      tipo: "solicitud",
      id: s.id,
      fecha: s.fecha_solicitada,
      hora: hhmm(s.hora_solicitada),
      nombre: s.nombre?.trim() || "Sin nombre",
      personas: s.numero_comensales,
      detalle: motivoSolicitud(s.motivo_rechazo),
      ruta: RUTA_SOLICITUDES,
    }));
  const sinFecha = "9999-99-99";
  return [...deReservas, ...deSolicitudes].sort(
    (a, b) =>
      (a.fecha ?? sinFecha).localeCompare(b.fecha ?? sinFecha) ||
      (a.hora ?? "99:99").localeCompare(b.hora ?? "99:99") ||
      a.clave.localeCompare(b.clave),
  );
}

/**
 * Avisos sin leer que la campana cuenta, sin repetir las solicitudes: el trigger crea un aviso por
 * cada solicitud y ya salen en «Por gestionar». `descontarSolicitudes`: solo si «Por gestionar» se ve.
 */
export function contarAvisosSinLeer(
  avisos: readonly { leida: boolean; tipo: string; referencia_tipo: string | null }[],
  descontarSolicitudes: boolean,
): number {
  return avisos.filter(
    (n) => !n.leida && !(descontarSolicitudes && (n.referencia_tipo === "solicitud" || n.tipo === "solicitud_pendiente")),
  ).length;
}
