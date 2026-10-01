// ============================================================================
// CIFRAS POR ESTADO DE «CÓMO AVANZA UNA RESERVA» — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// El timeline (`TimelineEstadosReserva`) enseña una cifra por cada uno de los seis
// estados. Sale en dos pestañas y cada una cuenta cosas distintas:
//
//   · HOY (2026-09-30): las reservas de hoy. `VistaHoy` ya las tiene cargadas
//     —sin las canceladas, cuya cifra viene aparte, del resumen de ocupación— y
//     el timeline las cuenta con `contarPorEstado`.
//   · LISTA (2026-10-01, petición del dueño: «este timeline ponlo en la lista
//     también»): lo que se ve en la lista. Las cuenta `cifrasDeLaLista`.
//
// QUÉ CUENTA `cifrasDeLaLista`, EXACTAMENTE
// ----------------------------------------------------------------------------
//   Cuenta las RESERVAS de la lista que pasan los filtros vigentes —búsqueda,
//   fecha y canal— y NO el filtro de «Estado». Por tres motivos:
//     1. Al filtrar por un estado, los otros cinco siguen dando su cifra: el
//        timeline sirve de referencia («hay 12 pendientes y 38 confirmadas») y
//        de atajo para cambiar de filtro. Si contara con el filtro de estado
//        puesto, al elegir «Pendiente» todos los demás pasarían a 0.
//     2. La cifra de un estado es JUSTO el número de filas de reserva que la
//        lista enseña al filtrar por él (lo comprueba el test contra
//        `filtrarFilasUnificadas`, el filtro de la propia lista).
//     3. Con el filtro de estado en «Todos» las seis cifras suman lo que dice el
//        contador «N reservas» de los filtros.
//   · Incluye las CANCELADAS (la lista las enseña, a diferencia de la pestaña
//     Hoy, cuya consulta las excluye).
//   · NO cuenta las solicitudes del bot (`solicitudes_pendientes`): no son
//     reservas ni tienen estado de reserva, y el contador de la lista las pone
//     aparte («· 2 solicitudes»). Sí se ven en la lista, no en el timeline.
//   · Un estado que no es uno de los seis (no debería existir por el CHECK
//     `reservas_estado_check`) no cuenta en ninguno.
//   · SOLO CASA TOMÁS (decisión del dueño, 2026-10-01: Touza no admite reservas).
//     Las reservas de otro negocio (`marca = 'touza'`; en los datos de demo hay 5)
//     no cuentan con ningún filtro, igual que no salen en la lista: las descarta
//     `unificarReservasYSolicitudes` con `admiteReservas`, la regla común. Aquí no
//     se repite ninguna comprobación de negocio. Una reserva sin marca es de Casa
//     Tomás y sí cuenta.
//   · Sin consulta propia: recibe las reservas que la lista YA tiene cargadas.
//
// El filtro es el MISMO que el de la lista: se llama a `unificarReservasYSolicitudes`
// y `filtrarFilasUnificadas` (`vistaUnificada.ts`) con los mismos filtros y
// `estado: "all"`. Nada de repetir aquí la lógica de búsqueda o canal: si cambia
// allí, cambia aquí.
// ============================================================================

import { format, isSameDay } from "date-fns";
import { es } from "date-fns/locale";
import { ORDEN_ESTADOS, type EstadoReserva } from "./estadosReserva";
import {
  filtrarFilasUnificadas,
  unificarReservasYSolicitudes,
  type FiltrosListaUnificada,
  type ReservaListable,
} from "./vistaUnificada";

/** Una cifra por cada uno de los seis estados. */
export type CifrasPorEstado = Record<EstadoReserva, number>;

const ESTADOS_CONOCIDOS: ReadonlySet<string> = new Set(ORDEN_ESTADOS);

const seisCeros = (): CifrasPorEstado => ({
  pendiente: 0,
  verificada: 0,
  confirmada: 0,
  completada: 0,
  cancelada: 0,
  no_show: 0,
});

/** Cuenta por estado. Un estado que no es de los seis (no debería existir por el CHECK) no se cuenta en ninguno. */
function recontar(reservas: readonly { estado: string }[]): CifrasPorEstado {
  const cifras = seisCeros();
  for (const r of reservas) {
    if (ESTADOS_CONOCIDOS.has(r.estado)) cifras[r.estado as EstadoReserva] += 1;
  }
  return cifras;
}

/**
 * Cuenta las reservas por estado — el recuento de la pestaña Hoy. `null` si las
 * reservas no han llegado: sin dato no hay cifras (mejor nada que un 0 falso).
 * `canceladas`, si llega, manda sobre lo que se cuente en las filas: quien llama
 * excluye las canceladas de la consulta y la cifra real la trae el resumen. Sin
 * `canceladas` (o `null`), la cifra de canceladas sale de las propias filas.
 */
export function contarPorEstado(
  reservas: readonly { estado: string }[] | null | undefined,
  canceladas?: number | null,
): CifrasPorEstado | null {
  if (!reservas) return null;
  const cifras = recontar(reservas);
  if (typeof canceladas === "number") cifras.cancelada = canceladas;
  return cifras;
}

/**
 * Las cifras de la pestaña Lista: las reservas que pasan los filtros de la lista
 * (búsqueda, fecha, canal) contadas por estado, SIN aplicar el filtro de estado
 * (`filtros.estado` se ignora, sea cual sea su valor). Como en la propia lista,
 * las que no son de Casa Tomás no entran (`unificarReservasYSolicitudes`). Ver la
 * cabecera. No toca `reservas` ni `filtros`.
 */
export function cifrasDeLaLista<R extends ReservaListable>(
  reservas: readonly R[],
  filtros: FiltrosListaUnificada,
): CifrasPorEstado {
  const filas = filtrarFilasUnificadas(unificarReservasYSolicitudes(reservas, []), {
    ...filtros,
    estado: "all",
  });
  return recontar(filas.flatMap((fila) => (fila.tipo === "reserva" ? [fila.reserva] : [])));
}

/** Cómo se rotulan las cifras: en la cabecera del timeline y en la lectura de cada una. */
export interface AlcanceCifras {
  /** Lo que va tras «Cómo avanza una reserva · » en la cabecera: «cifras de hoy». */
  cabecera: string;
  /** Lo que sigue a «N reservas» al leer cada cifra en voz alta: «hoy», «en la lista»… */
  lectura: string;
}

/** El alcance de la pestaña Hoy y el que lleva el timeline si nadie le dice otro. */
export const ALCANCE_HOY: AlcanceCifras = { cabecera: "cifras de hoy", lectura: "hoy" };

/**
 * El alcance de la pestaña Lista, según sus filtros:
 *   · sin día elegido        → «cifras de la lista»
 *   · con el día de hoy      → «cifras de la lista de hoy»
 *   · con otro día           → «cifras de la lista del 3 oct 2026» (el formato del botón de fecha)
 *   · con filtro de estado   → lo anterior + «, sin el filtro de estado»: avisa de que las demás cifras
 *                              no son las de las filas que se ven (cuentan todos los estados).
 * Siempre dice «de la lista» porque, además del día, pueden estar puestos la búsqueda y el canal: las
 * cifras son las de la lista TAL COMO ESTÁ FILTRADA, no las de un día entero.
 */
export function alcanceCifrasDeLaLista({
  fecha,
  hoy = new Date(),
  filtroDeEstado = false,
}: {
  /** Día elegido en el filtro de fecha de la lista; sin él, todas las fechas. */
  fecha?: Date | null;
  /** «Hoy» (solo se cambia en los tests). */
  hoy?: Date;
  /** Hay un filtro de estado distinto de «Todos». */
  filtroDeEstado?: boolean;
}): AlcanceCifras {
  let cabecera = "cifras de la lista";
  let lectura = "en la lista";
  if (fecha) {
    if (isSameDay(fecha, hoy)) {
      cabecera += " de hoy";
      lectura = "hoy";
    } else {
      const dia = format(fecha, "d MMM yyyy", { locale: es });
      cabecera += ` del ${dia}`;
      lectura = `el ${dia}`;
    }
  }
  if (filtroDeEstado) cabecera += ", sin el filtro de estado";
  return { cabecera, lectura };
}
