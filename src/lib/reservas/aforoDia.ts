// ============================================================================
// Cómo está el día de una reserva al aceptarla o verificarla (10/11/2026,
// petición del dueño: «se abre el pop-up para ver el día, lo que hay ese día y
// ver si se puede»). Puro, sin I/O: lo pinta `ElDiaDeLaReserva`.
//
// Por servicio (comida/cena): personas que ocupan frente al aforo (suma de las
// salas no privadas, `capacidadDeAforo`, como el formulario y «Reservas del
// día»), si está cerrado (calendario de cierres) o bloqueado («No coger más»).
// Las reservas de una sala privada (el Reservado) quedan fuera del aforo, como
// en el trigger. La reserva propia cuenta una vez: si ya está entre las del día
// (pendiente, verificada…) no se suma otra vez.
// ============================================================================
import { capacidadDeAforo, esSalaPrivada } from "./salaPrivada";
import { ocupaEspacio } from "./estadosReserva";

export type ServicioDia = "comida" | "cena";

export interface ReservaDelAforo {
  id?: string;
  hora: string;
  numero_comensales: number;
  estado: string;
  espacio_id: string | null;
}

export interface EspacioDelAforo {
  id: string;
  nombre?: string;
  capacidad_maxima?: number | null;
  caracteristicas?: unknown;
  privada?: boolean;
}

export interface ServicioResumen {
  servicio: ServicioDia;
  pax: number;
  /** 0 = sin dato de aforo (no se avisa de pasarse). */
  aforo: number;
  cerrado: boolean;
  bloqueado: boolean;
}

export interface ResumenAforoDia {
  servicios: ServicioResumen[];
  /** Servicio de la reserva propia. */
  servicioPropio: ServicioDia;
  /** Con la reserva propia, el servicio pasa del aforo. */
  pasaAforo: boolean;
}

export const servicioDeHora = (hora: string): ServicioDia => (String(hora || "").slice(0, 5) < "17:00" ? "comida" : "cena");

export function resumenAforoDia(args: {
  espacios: readonly EspacioDelAforo[];
  reservas: readonly ReservaDelAforo[];
  propia: ReservaDelAforo;
  cerrados?: readonly ServicioDia[];
  bloqueados?: readonly ServicioDia[];
}): ResumenAforoDia {
  const { espacios, reservas, propia } = args;
  const privadas = new Set(espacios.filter((e) => e.privada || esSalaPrivada(e)).map((e) => e.id));
  const aforo = capacidadDeAforo(espacios as Parameters<typeof capacidadDeAforo>[0]);
  const todas = [...reservas.filter((r) => !propia.id || r.id !== propia.id), propia];
  const cuenta = (s: ServicioDia) =>
    todas
      .filter((r) => ocupaEspacio(r.estado) && servicioDeHora(r.hora) === s && !(r.espacio_id && privadas.has(r.espacio_id)))
      .reduce((n, r) => n + Math.max(0, Number(r.numero_comensales) || 0), 0);
  const servicios = (["comida", "cena"] as const).map((servicio) => ({
    servicio,
    pax: cuenta(servicio),
    aforo,
    cerrado: !!args.cerrados?.includes(servicio),
    bloqueado: !!args.bloqueados?.includes(servicio),
  }));
  const servicioPropio = servicioDeHora(propia.hora);
  const delPropio = servicios.find((s) => s.servicio === servicioPropio)!;
  const enPrivada = !!propia.espacio_id && privadas.has(propia.espacio_id);
  return { servicios, servicioPropio, pasaAforo: !enPrivada && delPropio.aforo > 0 && delPropio.pax > delPropio.aforo };
}
