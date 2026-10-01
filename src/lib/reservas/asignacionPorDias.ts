// ============================================================================
// ASIGNACIÓN POR DÍAS — lógica pura de las pestañas del panel «Asignación de salas y mesas»
// (la pestaña «Próximas reservas» de Reservas)
// ----------------------------------------------------------------------------
// La pantalla se organiza en PESTAÑAS POR DÍA (petición del dueño, 2026-10-01: «en
// asignación de mesas ponlo por pestañas por días»): una pestaña por cada día del rango
// de «Mostrar» y, dentro de cada una, el resumen del día y sus turnos. Sustituye a la
// separación anterior «Próximas 48 horas» / «Más adelante»; la ventana de
// `asignacion_ventana_horas` sigue existiendo, pero ahora solo MARCA los días que toca
// repartir primero (nunca bloquea: cualquier reserva futura se puede asignar).
//
// QUÉ CUENTA CADA COSA (esto es lo que ve el dueño; si cambia, cambia aquí y en los tests):
//   · Reserva «viva»: pendiente, verificada o confirmada (`esReservaActiva`) que NO ha
//     empezado ya. Lo de hoy anterior a la hora actual no sale, igual que antes (esas se
//     atienden en la pestaña «Hoy»).
//   · SIN MESA = grado `sin_sala` + `sin_mesa` (la reserva aún no tiene mesa concreta).
//     Es lo que cuenta la INSIGNIA de cada pestaña. No cambia con «Ocultar las que ya
//     tienen mesa»: ese interruptor solo esconde las que tienen mesa, que de todas formas
//     no entran en esta cuenta. Sí cambian con él los totales de «reservas» y «comensales»
//     del resumen del día, para que cuadren con lo que se está viendo.
//   · Insignia 0 con reservas = «todo asignado». Día sin reservas = sin insignia.
//   · Negocio: solo Casa Tomás (Touza ya no admite reservas). Estas funciones no filtran por
//     negocio: el panel descarta antes las reservas de otra marca, así que ni se muestran ni
//     se cuentan.
//   · Día «en ventana»: el día en el que cae algún momento de [ahora, ahora + N horas],
//     contado en hora de Madrid. Con 48 h son siempre tres días naturales (hoy, mañana y
//     pasado, aunque pasado solo hasta la misma hora de ahora). Es una propiedad del
//     calendario, no de los datos: no parpadea según haya o no reservas.
//
// Todo es puro (sin React ni Supabase) y el reloj entra siempre por parámetro (`ahora`).
// ============================================================================

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { turnoDeHora, type Turno } from "@/lib/reservas/asignacionMesas";
import {
  agruparPorTurnoYGrado,
  esReservaActiva,
  fechaMadrid,
  instanteReserva,
  sumarDias,
  type GrupoTurno,
  type ReservaVentana,
} from "@/lib/reservas/ventanaAsignacion";

const MS_HORA = 3_600_000;
/** Tope de seguridad: ningún selector pide más de un año de pestañas. */
const MAX_DIAS_RANGO = 366;
const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const HORA_VALIDA = /^\d{1,2}:\d{2}/;

const aMs = (ahora: number | Date) => (typeof ahora === "number" ? ahora : ahora.getTime());
const conMayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

// ----------------------------------------------------------------------------
// Días del rango y etiquetas
// ----------------------------------------------------------------------------

/**
 * Fechas `YYYY-MM-DD` de todas las pestañas: de `desde` a `hasta`, ambas incluidas (son
 * los mismos días que pide la consulta, así que ninguna reserva que llegue queda sin
 * pestaña). Vacío si el rango está al revés o no se puede leer.
 */
export function diasDelRango(desde: string, hasta: string): string[] {
  if (!FECHA_VALIDA.test(desde) || !FECHA_VALIDA.test(hasta) || desde > hasta) return [];
  const dias: string[] = [];
  for (let dia = desde; dia <= hasta && dias.length < MAX_DIAS_RANGO; dia = sumarDias(dia, 1)) dias.push(dia);
  return dias;
}

export interface EtiquetasDia {
  /** Texto de la pestaña: «Hoy», «Mañana», «Sáb 3» (con mes el día 1: «Dom 1 nov»). */
  corta: string;
  /** Título del día en su panel: «Hoy · jueves 1 de octubre», «Sábado 3 de octubre». */
  titulo: string;
  esHoy: boolean;
  esManana: boolean;
}

export function etiquetasDia(fecha: string, hoy: string): EtiquetasDia {
  const esHoy = fecha === hoy;
  const esManana = fecha === sumarDias(hoy, 1);
  const dia = parseISO(fecha);
  const larga = format(dia, "EEEE d 'de' MMMM", { locale: es });
  const abreviada = conMayuscula(format(dia, "EEE d", { locale: es }));
  // El día 1 lleva el mes: en una tira de 30 días «Dom 1» a secas se confunde con el de este mes.
  const conMes = dia.getDate() === 1 ? `${abreviada} ${format(dia, "MMM", { locale: es })}` : abreviada;
  return {
    corta: esHoy ? "Hoy" : esManana ? "Mañana" : conMes,
    titulo: esHoy ? `Hoy · ${larga}` : esManana ? `Mañana · ${larga}` : conMayuscula(larga),
    esHoy,
    esManana,
  };
}

// ----------------------------------------------------------------------------
// Ventana de asignación
// ----------------------------------------------------------------------------

function limitesVentana(ventanaHoras: number, ahora: number | Date) {
  const t = aMs(ahora);
  return { hoy: fechaMadrid(t), fin: fechaMadrid(t + ventanaHoras * MS_HORA) };
}

/**
 * ¿Cae el día dentro de la ventana de asignación (de ahora a ahora + `ventanaHoras`)?
 * Cuenta el día en el que termina la ventana, aunque solo entre su primera parte.
 */
export function diaEnVentana(fecha: string, ventanaHoras: number, ahora: number | Date): boolean {
  const { hoy, fin } = limitesVentana(ventanaHoras, ahora);
  return fecha >= hoy && fecha <= fin;
}

// ----------------------------------------------------------------------------
// Qué reservas se enseñan
// ----------------------------------------------------------------------------

/**
 * Las reservas que siguen por venir: vivas (`esReservaActiva`) y que aún no han empezado.
 * Es lo mismo que dejaba `ordenarVentanaPrimero` (ventana + «más adelante»), pero sin
 * calcular el instante de TODAS: solo las de hoy necesitan compararse con la hora de
 * Madrid; una fecha posterior siempre está por venir. Con 3.000 reservas (30 días de 100)
 * baja de ~60 ms a ~1 ms cada vez que cambia un filtro. No ordena: conserva el orden.
 */
export function reservasPorVenir<T extends ReservaVentana>(filas: readonly T[], ahora: number | Date): T[] {
  const t = aMs(ahora);
  const hoy = fechaMadrid(t);
  const salida: T[] = [];
  for (const r of filas) {
    if (!esReservaActiva(r.estado)) continue;
    // Lo que no se puede leer queda fuera (igual que `instanteReserva` → null).
    if (!FECHA_VALIDA.test(String(r.fecha ?? "")) || !HORA_VALIDA.test(String(r.hora ?? ""))) continue;
    if (r.fecha < hoy) continue;
    if (r.fecha === hoy) {
      const instante = instanteReserva(r.fecha, r.hora);
      if (instante == null || instante < t) continue;
    }
    salida.push(r);
  }
  return salida;
}

/** Reparte las reservas por día (`fecha`) conservando el orden de entrada. */
export function agruparPorFecha<T extends { fecha: string }>(filas: readonly T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const r of filas) {
    const lista = mapa.get(r.fecha);
    if (lista) lista.push(r);
    else mapa.set(r.fecha, [r]);
  }
  return mapa;
}

// ----------------------------------------------------------------------------
// Pestañas
// ----------------------------------------------------------------------------

export interface ResumenPestana {
  fecha: string;
  /** El día cae dentro de la ventana de asignación (se marca en su pestaña). */
  enVentana: boolean;
  /** Reservas vivas del día (con o sin mesa). 0 = día sin reservas. */
  reservas: number;
  /** Reservas SIN mesa (sin sala + con sala sin mesa): lo que cuenta la insignia. */
  sinMesa: number;
}

/**
 * Una entrada por pestaña, en orden, también para los días sin reservas. Recibe las filas ya
 * filtradas por negocio y reducidas a las que siguen por venir (`reservasPorVenir`); NO
 * depende de «Ocultar las que ya tienen mesa» (ver la cabecera del fichero).
 */
export function resumirPestanas<T extends ReservaVentana>(
  filas: readonly T[],
  opciones: { dias: readonly string[]; ventanaHoras: number; ahora: number | Date },
): ResumenPestana[] {
  const cuentas = new Map<string, { reservas: number; sinMesa: number }>();
  for (const fecha of opciones.dias) cuentas.set(fecha, { reservas: 0, sinMesa: 0 });
  for (const r of filas) {
    const c = cuentas.get(r.fecha);
    if (!c) continue;
    c.reservas += 1;
    if (r.grado !== "con_mesa") c.sinMesa += 1;
  }
  const { hoy, fin } = limitesVentana(opciones.ventanaHoras, opciones.ahora);
  return opciones.dias.map((fecha) => ({
    fecha,
    enVentana: fecha >= hoy && fecha <= fin,
    ...cuentas.get(fecha)!,
  }));
}

/** Día que se abre solo: el primero con reservas sin mesa; si no hay ninguna, hoy. */
export function diaPorDefecto(resumenes: readonly ResumenPestana[], hoy: string): string {
  return resumenes.find((d) => d.sinMesa > 0)?.fecha ?? hoy;
}

/**
 * Pestaña activa: la que eligió la persona mientras siga existiendo (cambiar de negocio o de
 * rango no la mueve); si ya no está entre los días, la de por defecto.
 */
export function resolverDiaActivo(args: {
  dias: readonly string[];
  elegido: string | null | undefined;
  porDefecto: string;
}): string {
  const { dias, elegido, porDefecto } = args;
  return elegido && dias.includes(elegido) ? elegido : porDefecto;
}

// ----------------------------------------------------------------------------
// Contenido de un día
// ----------------------------------------------------------------------------

export interface ResumenTurnoDia {
  reservas: number;
  comensales: number;
  sinMesa: number;
  /** Con mesa y escondidas por «Ocultar las que ya tienen mesa» (0 con el interruptor apagado). */
  ocultas: number;
}

export interface DatosDia<T> {
  fecha: string;
  /** Reservas que se enseñan (sin las con mesa si «Ocultar las que ya tienen mesa» está activo). */
  reservas: number;
  comensales: number;
  sinMesa: number;
  /** Reservas con mesa que el interruptor ha escondido (0 con el interruptor apagado). */
  ocultas: number;
  /** ¿Tenía reservas el día antes de ocultar? Distingue «todo asignado» de «sin reservas». */
  hayReservas: boolean;
  porTurno: Record<Turno, ResumenTurnoDia>;
  /** Turnos con reservas, en orden (comida, cena), cada uno con sus subgrupos por grado. */
  turnos: GrupoTurno<T>[];
}

const turnoVacio = (): ResumenTurnoDia => ({ reservas: 0, comensales: 0, sinMesa: 0, ocultas: 0 });

/**
 * Lo que lleva el panel de un día: resumen (día, comida y cena) y turnos con sus subgrupos.
 * Con `soloPendientes` las reservas con mesa salen de las listas y de los totales.
 */
export function construirDia<T extends ReservaVentana>(
  filasDelDia: readonly T[],
  opciones: { fecha: string; soloPendientes: boolean },
): DatosDia<T> {
  const visibles = opciones.soloPendientes ? filasDelDia.filter((r) => r.grado !== "con_mesa") : filasDelDia;
  const porTurno: Record<Turno, ResumenTurnoDia> = { comida: turnoVacio(), cena: turnoVacio() };
  let comensales = 0;
  let sinMesa = 0;
  for (const r of filasDelDia) {
    const resumen = porTurno[r.turno ?? turnoDeHora(r.hora)];
    if (opciones.soloPendientes && r.grado === "con_mesa") {
      resumen.ocultas += 1;
      continue;
    }
    const personas = Number(r.numero_comensales) || 0;
    const pendiente = r.grado !== "con_mesa" ? 1 : 0;
    resumen.reservas += 1;
    resumen.comensales += personas;
    resumen.sinMesa += pendiente;
    comensales += personas;
    sinMesa += pendiente;
  }
  return {
    fecha: opciones.fecha,
    reservas: visibles.length,
    comensales,
    sinMesa,
    ocultas: filasDelDia.length - visibles.length,
    hayReservas: filasDelDia.length > 0,
    porTurno,
    turnos: agruparPorTurnoYGrado(visibles),
  };
}
