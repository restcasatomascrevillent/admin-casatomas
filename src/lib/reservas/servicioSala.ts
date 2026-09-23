// ============================================================================
// SERVICIO EN SALA — reglas puras (sin I/O) del Gestor de reservas (Kanban)
// y de la confirmación de llegada.
// ----------------------------------------------------------------------------
// Aquí solo viven decisiones ("¿se puede mover esto?", "¿cabe en ese
// espacio?", "¿qué estado queda al marcar la llegada?"). La escritura en
// Supabase está en `src/hooks/useAccionesServicioReserva.ts`.
//
// LLEGADA = estado 'completada' (+ `llegada_at` si la migración está aplicada)
// ----------------------------------------------------------------------------
// El CHECK `reservas_estado_check` ya admite 'completada' y 'no_show', y el
// resto del sistema YA interpreta 'completada' como "el cliente vino":
//   · emails-reserva/ausencias.ts: una reserva 'confirmada' cuya hora pasó
//     +3 h sin que nadie la marcase 'completada' se convierte en 'no_show' y
//     genera una SUGERENCIA de lista negra. Si la llegada se guardase solo en
//     una columna nueva dejando el estado en 'confirmada', ese cron marcaría
//     como ausente (y propondría vetar) a un cliente que sí vino.
//   · El historial que ve quien aprueba una sugerencia cuenta 'completada'
//     como asistencia.
//   · tipoEmailParaEstado(): 'completada' y 'no_show' NO disparan correo.
// Por eso "Ha llegado" pasa el estado a 'completada' y, además, guarda la
// hora en `llegada_at` cuando la columna existe (migración
// 20260923_reservas_llegada.sql, pendiente de aplicar). Sin la columna todo
// funciona igual, solo que la tarjeta muestra "Llegó" sin hora.
// NINGUNA acción de este módulo invoca `notify-reservation-change`.
// ============================================================================

// Import directo del motor compartido (el mismo que reexporta
// useDisponibilidad.ts) para no arrastrar el cliente de Supabase a un módulo
// puro — así se testea sin mocks.
import { ESTADOS_QUE_OCUPAN, turnoDeHora } from "../../../supabase/functions/_shared/disponibilidad";

export const ESTADO_LLEGADA = "completada" as const;
export const ESTADO_NO_SHOW = "no_show" as const;
/** Estado al que vuelve una reserva al deshacer "llegó" / "no se presentó". */
export const ESTADO_TRAS_DESHACER = "confirmada" as const;

/** Estados desde los que tiene sentido registrar que el cliente ha llegado. */
const ESTADOS_ESPERANDO_LLEGADA = ["pendiente", "verificada", "confirmada"] as const;

export interface ReservaServicio {
  id: string;
  nombre: string | null;
  hora: string;
  numero_comensales: number;
  estado: string;
  espacio_id: string | null;
  importante?: boolean | null;
  email?: string | null;
  telefono?: string | null;
  /** Solo existe si la migración 20260923_reservas_llegada.sql está aplicada. */
  llegada_at?: string | null;
}

export const esperandoLlegada = (estado: string) =>
  (ESTADOS_ESPERANDO_LLEGADA as readonly string[]).includes(estado);

export const haLlegado = (estado: string) => estado === ESTADO_LLEGADA;

/** Canceladas y no presentadas no ocupan sitio: no tiene sentido moverlas. */
export const puedeMoverReserva = (estado: string) =>
  estado !== "cancelada" && estado !== ESTADO_NO_SHOW;

/**
 * Estados que ocupan sitio FÍSICO en un espacio para un turno: los que ocupan
 * aforo según el trigger (`ESTADOS_QUE_OCUPAN`: pendiente, verificada,
 * confirmada) MÁS 'completada' — un cliente que ya llegó está sentado en ese
 * espacio, aunque el trigger de aforo global ya no lo cuente (ver informe).
 */
export const ocupaEspacio = (estado: string) =>
  (ESTADOS_QUE_OCUPAN as readonly string[]).includes(estado) || estado === ESTADO_LLEGADA;

/** Comensales que ocupan `espacioId` (null = sin asignar) en un turno. */
export function comensalesEnEspacioTurno(
  reservas: ReservaServicio[],
  espacioId: string | null,
  turno: "comida" | "cena",
  excluirId?: string,
): number {
  return reservas
    .filter(
      (r) =>
        r.id !== excluirId &&
        (r.espacio_id ?? null) === espacioId &&
        ocupaEspacio(r.estado) &&
        turnoDeHora(r.hora) === turno,
    )
    .reduce((acc, r) => acc + (Number(r.numero_comensales) || 0), 0);
}

export type EvaluacionMovimiento =
  | { tipo: "sin_cambio" }
  | { tipo: "bloqueado"; motivo: string }
  | {
      tipo: "ok" | "excede_capacidad";
      turno: "comida" | "cena";
      ocupacionTras: number;
      capacidad: number | null;
    };

/**
 * Decide si una reserva puede ir a `destinoId` (null = "Sin asignar").
 * La capacidad se compara POR TURNO (corte 17:00, `turnoDeHora`), igual que
 * el trigger `trg_validar_capacidad`: mezclar comida y cena en la misma
 * cuenta hacía que cualquier espacio pareciera lleno a mediodía.
 * Exceder la capacidad del espacio no se bloquea (el aforo real del turno
 * lo vigila el trigger en BD); se devuelve 'excede_capacidad' para pedir
 * confirmación explícita.
 */
export function evaluarMovimiento(
  reserva: ReservaServicio,
  destinoId: string | null,
  todas: ReservaServicio[],
  capacidadDestino: number | null | undefined,
): EvaluacionMovimiento {
  if (!puedeMoverReserva(reserva.estado)) {
    return {
      tipo: "bloqueado",
      motivo:
        reserva.estado === "cancelada"
          ? "Las reservas canceladas no se pueden mover."
          : "Una reserva marcada como «no se presentó» no ocupa espacio.",
    };
  }
  if ((reserva.espacio_id ?? null) === destinoId) return { tipo: "sin_cambio" };

  const turno = turnoDeHora(reserva.hora);
  const capacidad = destinoId && capacidadDestino ? Number(capacidadDestino) : null;
  const ocupacionTras =
    comensalesEnEspacioTurno(todas, destinoId, turno, reserva.id) +
    (Number(reserva.numero_comensales) || 0);

  return {
    tipo: capacidad != null && ocupacionTras > capacidad ? "excede_capacidad" : "ok",
    turno,
    ocupacionTras,
    capacidad,
  };
}

/** Devuelve una copia de la lista con el cambio aplicado (update optimista). */
export function aplicarCambioReserva<T extends { id: string }>(
  lista: T[] | undefined,
  id: string,
  cambios: Partial<T>,
): T[] | undefined {
  if (!lista) return lista;
  return lista.map((r) => (r.id === id ? { ...r, ...cambios } : r));
}

/**
 * ¿El error de PostgREST/Postgres se debe a que la columna `llegada_at` no
 * existe (migración aún sin aplicar)? 42703 = undefined_column (Postgres);
 * PGRST204 = columna desconocida en el cuerpo del UPDATE (PostgREST).
 */
export function esErrorColumnaLlegadaInexistente(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: string; message?: string };
  const texto = String(message ?? "");
  if (!texto.includes("llegada_at")) return false;
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /does not exist|could not find|schema cache/i.test(texto)
  );
}

/** "21:05" a partir del timestamp de llegada (hora local del navegador). */
export function formatearHoraLlegada(llegadaAt: string | null | undefined): string | null {
  if (!llegadaAt) return null;
  const d = new Date(llegadaAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

/** Mensaje legible para un fallo del trigger de aforo (23514) al deshacer. */
export function mensajeErrorServicio(error: unknown, accion: string): string {
  const e = (error ?? {}) as { code?: string; message?: string };
  if (e.code === "23514" && String(e.message ?? "").includes("Aforo")) {
    return `No se pudo ${accion}: el turno ya está completo (aforo superado).`;
  }
  return `No se pudo ${accion}${e.message ? `: ${e.message}` : "."}`;
}
