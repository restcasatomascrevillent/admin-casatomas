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
import { minutosHastaSiguienteTurnoFijo, turnoDeHora } from "../../../supabase/functions/_shared/disponibilidad";
// Los estados (constantes y predicados) viven en `estadosReserva.ts`, la fuente
// única. Aquí se reexportan solo los dos que aún se importan desde este módulo
// (`ESTADO_LLEGADA`, `ocupaEspacio`); los alias de otros nombres
// (`esperandoLlegada` = `esEstadoVivo`, `puedeMoverReserva` = `ocupaEspacio`) y
// las reexportaciones que nadie usaba se quitaron en el paso 4 del refactor.
import { ESTADO_LLEGADA, ESTADO_NO_SHOW, esEstadoVivo, ocupaEspacio } from "./estadosReserva";
import { esErrorSalaPrivadaOcupada, mensajeSalaPrivadaOcupada, salaPrivadaOcupadaPor, textoSalaPrivadaOcupada } from "./salaPrivada";

export { ESTADO_LLEGADA, ocupaEspacio };

// ============================================================================
// MODO SERVICIO (Fase 4, MVP) — estado de cada MESA en vivo durante el turno
// ----------------------------------------------------------------------------
// Todo lo de aquí abajo es PURO (sin I/O, sin `new Date()` implícito: `ahora`
// siempre llega por parámetro) para poder testear sin mocks. La escritura
// (liberar/deshacer, mover de mesa) vive en un hook nuevo que llama a
// Supabase con updates CONDICIONALES (ver diseño sdd/plano-espacios/design,
// bloque de concurrencia).
//
// "LIBERAR" no cambia `estado` (sigue en 'completada': el cliente SÍ vino).
// Solo pone `reservas.salida_at`. `asignaciones_mesa` NO se borra al liberar:
// se conserva como historial de qué mesa ocupó la reserva (decisión del
// dueño, migración 20260926150000_modo_servicio_config_y_salida.sql).
// ============================================================================

export type EstadoMesaServicio = "libre" | "reservada" | "retrasada" | "ocupada" | "por_liberar";

/** Los cinco estados, en el orden en que se explican en la leyenda del plano. */
export const ESTADOS_MESA_SERVICIO: readonly EstadoMesaServicio[] = [
  "libre",
  "reservada",
  "retrasada",
  "ocupada",
  "por_liberar",
];

export interface ReservaMesaServicio extends ReservaServicio {
  /** Solo existe si la migración 20260926150000_modo_servicio_config_y_salida.sql está aplicada. */
  salida_at?: string | null;
}

/** Fila mínima de `asignaciones_mesa` que necesita este módulo. */
export interface AsignacionMesaServicio {
  mesa_id: string;
  reserva_id: string;
}

/** Los tres umbrales configurables desde "Configuración de reservas". */
export interface ConfigServicioSala {
  estanciaComidaMinutos: number;
  estanciaCenaMinutos: number;
  retrasoGraciaMinutos: number;
  /**
   * Turnos de hora fija del día que se pinta ("HH:MM"; jueves de tapas: 20:30 y
   * 22:00, `configuracion_turnos.horas_fijas`). La reserva de un turno deja la
   * mesa a la hora del siguiente. Vacío o ausente = día normal.
   */
  horasFijas?: readonly string[];
}

/** Defaults del producto (dueño, 2026-09-26) si la config no ha cargado aún. */
export const CONFIG_SERVICIO_SALA_POR_DEFECTO: ConfigServicioSala = {
  estanciaComidaMinutos: 105,
  estanciaCenaMinutos: 120,
  retrasoGraciaMinutos: 15,
};

/**
 * Construye `ConfigServicioSala` a partir de la fila de `configuracion_reservas`
 * (los tres campos son opcionales ahí: columnas nuevas, migración quizá sin
 * aplicar). Cualquier valor ausente, nulo o no numérico cae en el default del
 * producto — nunca `NaN`, nunca `undefined` llega al resto del módulo.
 */
export function configServicioSalaDesde(config: {
  estancia_comida_minutos?: number | null;
  estancia_cena_minutos?: number | null;
  retraso_gracia_minutos?: number | null;
} | null | undefined, horasFijas?: readonly string[] | null): ConfigServicioSala {
  const num = (valor: number | null | undefined, porDefecto: number): number => {
    if (valor == null) return porDefecto;
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : porDefecto;
  };
  return {
    estanciaComidaMinutos: num(config?.estancia_comida_minutos, CONFIG_SERVICIO_SALA_POR_DEFECTO.estanciaComidaMinutos),
    estanciaCenaMinutos: num(config?.estancia_cena_minutos, CONFIG_SERVICIO_SALA_POR_DEFECTO.estanciaCenaMinutos),
    retrasoGraciaMinutos: num(config?.retraso_gracia_minutos, CONFIG_SERVICIO_SALA_POR_DEFECTO.retrasoGraciaMinutos),
    ...(horasFijas && horasFijas.length > 0 ? { horasFijas: [...horasFijas] } : {}),
  };
}

/** Minutos de estancia estimada para el turno dado. */
export function estanciaMinutosDelTurno(turno: "comida" | "cena", config: ConfigServicioSala): number {
  return turno === "comida" ? config.estanciaComidaMinutos : config.estanciaCenaMinutos;
}

/**
 * Estancia de UNA reserva: la de su turno, recortada en el turno fijo siguiente
 * si el día los tiene (jueves de tapas: la de las 20:30 tiene hasta las 22:00).
 */
export function estanciaMinutosDeReserva(hora: string, turno: "comida" | "cena", config: ConfigServicioSala): number {
  const base = estanciaMinutosDelTurno(turno, config);
  const hastaSiguiente = minutosHastaSiguienteTurnoFijo(hora, config.horasFijas);
  return hastaSiguiente === null ? base : Math.min(base, hastaSiguiente);
}

/** "HH:MM" o "HH:MM:SS" → minutos desde medianoche. Basura → 0 (medianoche). */
/** `YYYY-MM-DD` local de una fecha. */
function diaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function minutosDelDia(hora: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(typeof hora === "string" ? hora.trim() : "");
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return 0;
  return h * 60 + min;
}

/**
 * ¿Esta reserva sigue "viva" para el modo servicio? Cancelada y no_show no
 * ocupan mesa (ver `ocupaEspacio`); una completada YA LIBERADA (`salida_at`
 * puesto) tampoco: se fue, la mesa quedó libre para el siguiente turno.
 */
function ocupaMesaServicio(r: ReservaMesaServicio): boolean {
  if (r.estado === "cancelada" || r.estado === ESTADO_NO_SHOW) return false;
  if (haLlegado(r.estado) && r.salida_at) return false;
  return esEstadoVivo(r.estado) || haLlegado(r.estado);
}

/**
 * De todas las reservas asignadas a `mesaId` en ese turno, la que hay que
 * mostrar "ahora": la que está sentada (llegó y no se ha ido) tiene prioridad
 * absoluta; si no hay ninguna sentada, la próxima pendiente de llegar (la de
 * hora más temprana — normalmente solo puede haber una, por el índice único
 * de `asignaciones_mesa`, pero un dato inconsistente no debe romper la
 * pantalla).
 */
export function reservaRelevanteDeMesa(
  mesaId: string,
  asignaciones: readonly AsignacionMesaServicio[],
  reservas: readonly ReservaMesaServicio[],
  turno: "comida" | "cena",
): ReservaMesaServicio | null {
  const idsAsignados = new Set(
    (asignaciones ?? []).filter((a) => a && a.mesa_id === mesaId).map((a) => a.reserva_id),
  );
  if (idsAsignados.size === 0) return null;

  const candidatas = (reservas ?? []).filter(
    (r) => r && idsAsignados.has(r.id) && turnoDeHora(r.hora) === turno && ocupaMesaServicio(r),
  );
  if (candidatas.length === 0) return null;

  const sentada = candidatas.find((r) => haLlegado(r.estado));
  if (sentada) return sentada;

  return [...candidatas].sort((a, b) => minutosDelDia(a.hora) - minutosDelDia(b.hora))[0] ?? null;
}

export interface ResultadoEstadoMesa {
  estado: EstadoMesaServicio;
  /** La reserva que explica el estado, o `null` si está `libre`. */
  reserva: ReservaMesaServicio | null;
  /**
   * Minutos a mostrar en el chip: transcurridos desde `llegada_at` si está
   * `ocupada`/`por_liberar`, o de retraso sobre la hora de la reserva si está
   * `reservada`/`retrasada` (puede ser negativo: "quedan 10 min"). `null` si
   * está `libre` o si falta un dato para calcularlo.
   */
  minutos: number | null;
}

/**
 * Estado de UNA mesa para el modo servicio, en el instante `ahora`.
 *
 * Reglas (ver AGENTS.md / diseño): `libre` sin asignación viva; `reservada`
 * si la reserva no ha llegado y `ahora < hora + gracia`; `retrasada` si no ha
 * llegado y `ahora >= hora + gracia`; `ocupada` si llegó, no se fue
 * (`salida_at` null) y `transcurrido < estancia`; `por_liberar` si llegó,
 * no se fue y `transcurrido >= estancia`.
 */
export function estadoMesaServicio(
  mesaId: string,
  asignaciones: readonly AsignacionMesaServicio[],
  reservas: readonly ReservaMesaServicio[],
  turno: "comida" | "cena",
  ahora: Date,
  config: ConfigServicioSala = CONFIG_SERVICIO_SALA_POR_DEFECTO,
  /**
   * El día que se está mirando (`YYYY-MM-DD`). Si no es el de `ahora`, nada va «retrasada» ni lleva minutos
   * (12/11/2026, captura del dueño: el sábado 14 salía «+169 min» porque solo se comparaba la hora del reloj).
   */
  dia?: string,
): ResultadoEstadoMesa {
  const reserva = reservaRelevanteDeMesa(mesaId, asignaciones, reservas, turno);
  if (!reserva) return { estado: "libre", reserva: null, minutos: null };
  if (dia && dia !== diaLocal(ahora) && !haLlegado(reserva.estado)) return { estado: "reservada", reserva, minutos: null };

  const ahoraMinutos = ahora.getHours() * 60 + ahora.getMinutes();

  if (haLlegado(reserva.estado)) {
    const llegadaAt = reserva.llegada_at ? new Date(reserva.llegada_at) : null;
    if (!llegadaAt || Number.isNaN(llegadaAt.getTime())) {
      // Llegó (estado 'completada') pero sin hora registrada (migración de
      // llegada_at aún sin aplicar, o dato histórico): no se puede medir el
      // tiempo sentado, así que se muestra "ocupada" sin chip de minutos en
      // vez de arriesgar un falso "por_liberar".
      return { estado: "ocupada", reserva, minutos: null };
    }
    const transcurrido = Math.round((ahora.getTime() - llegadaAt.getTime()) / 60000);
    const estancia = estanciaMinutosDeReserva(reserva.hora, turno, config);
    return {
      estado: transcurrido >= estancia ? "por_liberar" : "ocupada",
      reserva,
      minutos: transcurrido,
    };
  }

  const retraso = ahoraMinutos - minutosDelDia(reserva.hora);
  return {
    estado: retraso >= config.retrasoGraciaMinutos ? "retrasada" : "reservada",
    reserva,
    minutos: retraso,
  };
}

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
  /** Lo que escribió el cliente (alergias, trona, celebración…): Hoy lo enseña en la tarjeta y en la mesa. */
  notas_cliente?: string | null;
  /** «Fijar mesa» (20261107120000): los recálculos no la mueven ni se le quita al sentar a otro. */
  mesa_fijada?: boolean | null;
  /** «Menú del día» (martes a jueves, comida). */
  menu_del_dia?: boolean | null;
  /** «Menú cerrado» (de grupo; 20261122190000). Aparte del «Menú del día». */
  menu_cerrado?: boolean | null;
  /** Precio del menú cerrado en euros (20261122190000); NULL = sin precio. */
  menu_precio?: number | string | null;
  /** «¿Dentro o fuera?» que pidió al reservar (20261122200000): 'dentro' | 'fuera' | NULL. */
  zona_preferida?: string | null;
  /** «Sentar fuera» (20261122171500): dónde se sentó fuera de las salas («Touza»…); NULL = dentro. */
  fuera_lugar?: string | null;
  /** «Sentar fuera»: mesa o nota del sitio de fuera. */
  fuera_mesa?: string | null;
  /** «Sentar fuera»: la sala que tenía antes (vuelve al deshacer). */
  fuera_espacio_previo_id?: string | null;
}

export const haLlegado = (estado: string) => estado === ESTADO_LLEGADA;

// `ocupaEspacio` (reexportado arriba): los estados que ocupan sitio FÍSICO en un
// espacio para un turno —los que ocupan aforo según el trigger (`ESTADOS_QUE_OCUPAN`:
// pendiente, verificada, confirmada) MÁS 'completada': un cliente que ya llegó
// está sentado en ese espacio, aunque el trigger de aforo global ya no lo cuente—.
// Por eso es también la regla de qué se puede MOVER: canceladas y «No vino» no
// ocupan sitio y no tiene sentido moverlas.

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
  /**
   * El destino es una sala PRIVADA (`caracteristicas.privada`, el Reservado): una reserva se la queda
   * entera, así que si ya hay otra en ese turno el movimiento se BLOQUEA (la BD lo rechazaría igual
   * con 23514 «Sala privada ocupada»). `nombre`: para escribir el aviso.
   */
  salaPrivadaDestino?: { nombre?: string | null } | null,
): EvaluacionMovimiento {
  if (!ocupaEspacio(reserva.estado)) {
    return {
      tipo: "bloqueado",
      motivo:
        reserva.estado === "cancelada"
          ? "Las reservas canceladas no se pueden mover."
          : "Una reserva marcada como «No vino» no ocupa espacio.",
    };
  }
  if ((reserva.espacio_id ?? null) === destinoId) return { tipo: "sin_cambio" };

  if (destinoId && salaPrivadaDestino) {
    const ocupante = salaPrivadaOcupadaPor(todas, destinoId, reserva.hora, reserva.id);
    if (ocupante) {
      return {
        tipo: "bloqueado",
        motivo: ocupante.nombre
          ? `${textoSalaPrivadaOcupada(salaPrivadaDestino.nombre)} Ya la tiene ${ocupante.nombre}.`
          : textoSalaPrivadaOcupada(salaPrivadaDestino.nombre),
      };
    }
  }

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
  // Sala privada (el Reservado) ya reservada en ese turno: la frase lleva el nombre de la sala.
  if (esErrorSalaPrivadaOcupada(e)) return `No se pudo ${accion}. ${mensajeSalaPrivadaOcupada(e)}`;
  if (e.code === "23514" && String(e.message ?? "").includes("Aforo")) {
    return `No se pudo ${accion}: el turno ya está completo (aforo superado).`;
  }
  return `No se pudo ${accion}${e.message ? `: ${e.message}` : "."}`;
}
