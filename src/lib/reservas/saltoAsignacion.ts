// ============================================================================
// SALTO "IR A ASIGNAR MESA" — de una reserva concreta al plano de su sala
// ----------------------------------------------------------------------------
// Hasta ahora el plano de sala (`PlanoEspacio2D`) solo se abría POR SALA: desde
// la pestaña Hoy, desde Ocupación y desde el calendario. Si veías una reserva
// sin mesa en la lista, para sentarla tenías que deducir su sala, abrir esa
// sala y buscarla dentro. Esto resuelve el salto directo POR RESERVA (petición
// del dueño 2026-09-28: "que se pueda abrir desde la parte de la lista para
// asignar mesas, o desde la vista de hoy si siguen sin asignar").
//
// Aquí vive SOLO la decisión: ¿puede esta reserva abrir el plano, y si no, por
// qué no? Es un módulo puro a propósito, porque la respuesta la necesitan dos
// pantallas distintas —la lista (`ListaReservasAvanzada`) y la franja de
// pendientes de la pestaña Hoy (`VistaHoy`)— y el dueño pidió explícitamente
// que el botón nunca lleve a una pantalla vacía sin explicar por qué. Si cada
// pantalla escribiera su propio motivo, tarde o temprano dirían cosas
// distintas para el mismo caso.
//
// ----------------------------------------------------------------------------
// LOS DOS GRADOS DE ASIGNACIÓN (y por qué NINGUNO es un error)
// ----------------------------------------------------------------------------
// La asignación es progresiva y la mesa NUNCA es obligatoria:
//
//   1. SIN SALA      — la reserva ni siquiera está repartida por salas.
//   2. CON SALA, SIN MESA — repartida, pendiente de mesa concreta.
//   3. CON MESA      — sentada.
//
// El grado 2 es trabajo pendiente NORMAL, no un fallo: una reserva puede
// llegar al servicio sin mesa concreta y se le da cuando toca. Por eso nada de
// lo que sale de aquí habla en tono de aviso ni de error, y quien lo pinte
// tiene que usar estilos neutros (nunca rojo). El propio plano ya lo dice en su
// pie: "Sin mesa no es un error".
//
// El grado 1 SÍ impide el salto, y no por capricho: el plano se abre siempre
// sobre UNA sala y su panel lateral solo lista las reservas de ESA sala. Una
// reserva sin sala no aparecería en ninguna, así que abrir "la sala por
// defecto" dejaría al encargado mirando un plano donde su reserva no está —
// justo la pantalla vacía sin explicación que el dueño no quiere. Además no
// existe tal cosa como "la sala por defecto": `espacios_reserva` no tiene
// ninguna columna de orden ni de prioridad. Así que el botón se queda en su
// sitio, deshabilitado, y el `title` dice qué falta y dónde se arregla.
// ============================================================================

import { turnoDeHora, type Turno } from "@/lib/reservas/asignacionMesas";

/** Sala + día + turno + reserva: todo lo que el plano necesita para abrir señalando. */
export interface DestinoAsignacion {
  espacioId: string;
  /** Día de la reserva, `YYYY-MM-DD`. El plano abre en ESE día, no en hoy. */
  fecha: string;
  /** Reserva que queda preseleccionada, lista para sentarla. */
  reservaId: string;
  /**
   * Turno de la reserva, deducido de su hora. Viaja CON el destino, igual que
   * la fecha, y no es un adorno: el panel del plano solo lista el turno que
   * tiene puesto, y por defecto pone el del reloj. Saltar a una cena a mediodía
   * sin traer el turno deja al encargado mirando un panel donde su reserva NO
   * está — justo la pantalla vacía que no queremos.
   *
   * Por qué viaja aquí y no lo deduce el plano por su cuenta: medido en el
   * navegador (2026-09-28), deducirlo DESPUÉS de montar —esperando a que
   * carguen las reservas del día y entonces cambiar el turno— no llega a
   * aplicarse; la fecha, que sí se pasa al montar, funciona siempre. Así que el
   * turno se resuelve donde ya se conoce la hora (la lista y la franja de
   * pendientes) y entra por la misma puerta que la fecha: al montar.
   *
   * `undefined` solo si la reserva no trae hora; entonces el plano se queda con
   * el turno que tuviera.
   */
  turno?: Turno;
}

/** Lo mínimo que hace falta saber de una reserva para decidir el salto. */
export interface ReservaParaSalto {
  id: string;
  /** `YYYY-MM-DD`. */
  fecha?: string | null;
  espacio_id?: string | null;
  estado?: string | null;
  /** `HH:MM[:SS]`. De aquí sale el turno del destino. */
  hora?: string | null;
}

/** Por qué NO se puede saltar. `null` = sí se puede. */
export type MotivoSinSalto = "sin_sala" | "sin_fecha" | "cancelada" | "no_es_reserva";

export interface SaltoAsignacion {
  /** `null` si no se puede saltar: entonces `motivo` dice por qué. */
  destino: DestinoAsignacion | null;
  motivo: MotivoSinSalto | null;
  /**
   * Texto para el `title` (y el `aria-label`) del botón. SIEMPRE tiene valor,
   * también cuando el salto es posible: así el botón se explica solo tanto
   * habilitado como deshabilitado.
   */
  titulo: string;
}

/** Estado que deja una reserva fuera de juego: ya no hay nada que sentar. */
const ESTADOS_SIN_SALTO = new Set(["cancelada"]);

/**
 * ¿Puede esta reserva abrir el plano de su sala para que le den mesa?
 *
 * `yaTieneMesa` no bloquea el salto — con mesa puesta sigue siendo útil entrar
 * al plano para moverla o juntarle otra—, solo cambia el texto para que el
 * encargado sepa que ahí no queda trabajo pendiente.
 */
export function resolverSaltoAsignacion(
  reserva: ReservaParaSalto | null | undefined,
  opciones?: { yaTieneMesa?: boolean; nombreSala?: string | null },
): SaltoAsignacion {
  if (!reserva?.id) {
    return {
      destino: null,
      motivo: "no_es_reserva",
      // Las solicitudes del bot comparten tabla con las reservas en la lista y
      // caen aquí: todavía no son una reserva, así que no hay nada que sentar.
      titulo: "Todavía no es una reserva: acéptala primero y luego podrás darle mesa",
    };
  }

  if (reserva.estado && ESTADOS_SIN_SALTO.has(reserva.estado)) {
    return {
      destino: null,
      motivo: "cancelada",
      titulo: "La reserva está cancelada: no hay nada que sentar",
    };
  }

  if (!reserva.fecha) {
    return {
      destino: null,
      motivo: "sin_fecha",
      titulo: "La reserva no tiene fecha: sin día no se puede abrir el plano",
    };
  }

  if (!reserva.espacio_id) {
    return {
      destino: null,
      motivo: "sin_sala",
      // Se dice QUÉ falta y DÓNDE se arregla. La sala se pone desde "Gestionar"
      // (el diálogo de edición de la reserva), que ya está en esta misma fila:
      // no hace falta un camino nuevo sólo para esto.
      titulo: "Primero hay que darle sala: usa «Gestionar» para asignársela y luego podrás darle mesa",
    };
  }

  const sala = opciones?.nombreSala?.trim();
  const enSala = sala ? ` en ${sala}` : "";
  // Una hora vacía o con basura no puede inventar un turno: `turnoDeHora`
  // devolvería el del corte por defecto y mandaría al plano al turno
  // equivocado. Mejor no decir nada y que el plano se quede como esté.
  const hora = String(reserva.hora ?? "").trim();
  const turno = /^\d{1,2}:\d{2}/.test(hora) ? turnoDeHora(hora) : undefined;

  return {
    destino: { espacioId: reserva.espacio_id, fecha: reserva.fecha, reservaId: reserva.id, turno },
    motivo: null,
    titulo: opciones?.yaTieneMesa
      ? `Ya tiene mesa: abre el plano${enSala} para cambiársela o juntarle otra`
      : `Abrir el plano${enSala} para darle mesa`,
  };
}

/** Atajo para quien solo quiere saber si pintar el botón activo o no. */
export function puedeSaltarAAsignacion(reserva: ReservaParaSalto | null | undefined): boolean {
  return resolverSaltoAsignacion(reserva).destino !== null;
}
