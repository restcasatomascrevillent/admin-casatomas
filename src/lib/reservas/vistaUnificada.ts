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
//
// SOLO CASA TOMÁS (decisión del dueño, 2026-10-01: Touza no admite reservas).
// Las reservas y solicitudes de otro negocio que queden en la base de datos ni
// siquiera llegan a ser filas: las descarta `unificarReservasYSolicitudes` con
// `admiteReservas`, así que ni se ven, ni se cuentan, ni se pueden convertir.
// ============================================================================

import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";
import { admiteReservas } from "./negocios";
import { ESTADO_PENDIENTE, ESTADOS_RESERVA, type EstadoReserva } from "./estadosReserva";

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
  /** Negocio (`reservas.marca`). Solo se listan las de Casa Tomás (`admiteReservas`). */
  marca?: string | null;
  /** «Menú del día» (true) o «Carta» (false); null en las antiguas. */
  menu_del_dia?: boolean | null;
}

export type FilaUnificada<R extends ReservaListable = ReservaListable> =
  | { tipo: "reserva"; id: string; fecha: string | null; hora: string | null; reserva: R }
  | { tipo: "solicitud"; id: string; fecha: string | null; hora: string | null; solicitud: SolicitudPendiente };

/** Estados de solicitud que todavía requieren que alguien haga algo. */
export const ESTADOS_SOLICITUD_ABIERTA = ["pendiente", "contactado"] as const;
export const esSolicitudAbierta = (estado: string) =>
  (ESTADOS_SOLICITUD_ABIERTA as readonly string[]).includes(estado);

/**
 * La cifra de la insignia de la pestaña Lista: las solicitudes del bot en estado
 * `pendiente` de Casa Tomás. Las de otro negocio no cuentan, igual que no salen
 * en la lista (`admiteReservas`), para que insignia y lista digan lo mismo.
 */
export function contarSolicitudesPendientes(solicitudes: readonly SolicitudPendiente[]): number {
  return solicitudes.filter((s) => s.estado === "pendiente" && admiteReservas(s.marca)).length;
}

/**
 * Valores del filtro "Estado" de la lista. Los de reserva son los del CHECK
 * `reservas_estado_check`; los dos últimos son de solicitudes.
 */
export const FILTRO_SOLICITUDES = "solicitudes";
export const FILTRO_SOLICITUDES_CERRADAS = "solicitudes_cerradas";
/**
 * «Por atender» (2026-10-05, petición del dueño: «pon aquí un filtro de solo
 * pendientes»; el nombre, «Por atender» y no «Pendientes», lo decidió él ese
 * mismo día): lo que espera a que el personal haga algo, sea reserva o
 * solicitud (`estaPorAtender`). No es el estado «Pendiente» de la reserva (ese
 * es solo de reservas, y es el paso «Pendiente» del timeline). Es un valor más
 * del filtro «Estado», no un filtro aparte: así el botón «Por atender» de la
 * barra y el desplegable «Estado» no pueden desincronizarse, y se combina con
 * la búsqueda, la fecha y el canal como cualquier otro estado.
 */
export const FILTRO_POR_ATENDER = "por_atender";

/**
 * ¿Espera la fila a que el personal haga algo? Es lo que enseña «Por atender»
 * (`FILTRO_POR_ATENDER`):
 *   · las RESERVAS en estado `pendiente` (hay que aceptarlas o verificarlas). Las
 *     de otro estado, no: una verificada ya espera al cliente, no al personal;
 *   · las SOLICITUDES del asistente sin resolver (`esSolicitudAbierta`: pendiente
 *     o contactado). Las cerradas (resuelta, descartada), no.
 */
export function estaPorAtender<R extends ReservaListable>(fila: FilaUnificada<R>): boolean {
  return fila.tipo === "solicitud" ? esSolicitudAbierta(fila.solicitud.estado) : fila.reserva.estado === ESTADO_PENDIENTE;
}

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

/**
 * Opciones del desplegable «Estado». `label` es el texto de la opción en la lista
 * abierta; `corta`, si la hay, lo que dice el desplegable CERRADO tras «Estado: »
 * (si no, `label`): «Por atender» en vez de la explicación entera y, en los estados
 * de reserva, el nombre de la insignia («Llegó», no «Llegó / completada», que no
 * cabe). «Todos los estados» y no «Todos» (2026-10-05, petición del dueño):
 * cerrado, el desplegable ya no dice «Todos» sino el nombre del filtro.
 */
export const OPCIONES_FILTRO_ESTADO: { value: string; label: string; corta?: string }[] = [
  { value: "all", label: "Todos los estados" },
  { value: FILTRO_POR_ATENDER, label: "Por atender (reservas y solicitudes sin resolver)", corta: "Por atender" },
  { value: FILTRO_SOLICITUDES, label: "Solicitudes sin resolver" },
  ...ORDEN_ESTADOS_EN_FILTRO.map((estado) => ({
    value: estado,
    label: ESTADOS_RESERVA[estado].etiquetaFiltro,
    corta: ESTADOS_RESERVA[estado].etiqueta,
  })),
  { value: FILTRO_SOLICITUDES_CERRADAS, label: "Solicitudes cerradas" },
];

export interface FiltrosListaUnificada {
  busqueda?: string;
  /** "all" | estado de reserva | FILTRO_POR_ATENDER | FILTRO_SOLICITUDES | FILTRO_SOLICITUDES_CERRADAS */
  estado?: string;
  /** "all" | telefono | web | manual */
  canal?: string;
  /** "yyyy-MM-dd" */
  fecha?: string | null;
  /**
   * Filtro rápido (10/11/2026): "menu" = solo reservas de «Menú del día», "carta" = solo las de «Carta»
   * (las que no tienen ese dato y las solicitudes no salen con ninguno de los dos). "all" o nada: todas.
   */
  servicio?: "all" | "menu" | "carta";
}

const normalizarHora = (hora: string | null | undefined) =>
  hora ? String(hora).substring(0, 5) : null;

/**
 * Junta reservas y solicitudes en una sola lista ordenada. Lo que no es de Casa
 * Tomás (`admiteReservas`: Touza ya no admite reservas) se queda FUERA aquí, en el
 * único punto de entrada de la lista: las filas y la cifra del botón «Por
 * atender» (`cifraPorAtender`) salen de este resultado.
 */
export function unificarReservasYSolicitudes<R extends ReservaListable>(
  reservas: readonly R[],
  solicitudes: readonly SolicitudPendiente[],
): FilaUnificada<R>[] {
  const filas: FilaUnificada<R>[] = [
    ...reservas.filter((r) => admiteReservas(r.marca)).map((r) => ({
      tipo: "reserva" as const,
      id: r.id,
      fecha: r.fecha ?? null,
      hora: normalizarHora(r.hora),
      reserva: r,
    })),
    ...solicitudes.filter((s) => admiteReservas(s.marca)).map((s) => ({
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
  const servicio = filtros.servicio ?? "all";

  // «Por atender»: reservas y solicitudes a la vez, pero solo lo que espera al personal (`estaPorAtender`).
  const porAtender = estado === FILTRO_POR_ATENDER;

  return filas.filter((f) => {
    if (fecha && f.fecha !== fecha) return false;
    if (porAtender && !estaPorAtender(f)) return false;

    if (f.tipo === "solicitud") {
      if (servicio !== "all") return false;
      const s = f.solicitud;
      if (estado === FILTRO_SOLICITUDES && !esSolicitudAbierta(s.estado)) return false;
      if (estado === FILTRO_SOLICITUDES_CERRADAS && esSolicitudAbierta(s.estado)) return false;
      // "Todos" muestra solo las solicitudes abiertas: las cerradas son
      // historial y se consultan con su filtro propio.
      if (estado === "all" && !esSolicitudAbierta(s.estado)) return false;
      if (estado !== "all" && !porAtender && estado !== FILTRO_SOLICITUDES && estado !== FILTRO_SOLICITUDES_CERRADAS) {
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
    if (estado !== "all" && !porAtender && r.estado !== estado) return false;
    if (canal !== "all" && (r.canal || "web") !== canal) return false;
    if (servicio === "menu" && r.menu_del_dia !== true) return false;
    if (servicio === "carta" && r.menu_del_dia !== false) return false;
    return coincideBusqueda([r.nombre, r.telefono, r.email, r.notas_cliente], termino);
  });
}

// ----------------------------------------------------------------------------
// Deep links: /reservas?tab=...&status=...&date=today
// ----------------------------------------------------------------------------
// "asignacion": panel de salas y mesas (reservas-sin-salas, Fase B); la
// campana enlaza ahí las notificaciones `reserva_sin_asignar`.
// "hoy" (10/11/2026): el kanban del día. Antes `?tab=hoy` caía en la Lista
// (era el nombre de la pestaña de ANTES de la unificación del 2026-09-23) y un
// enlace a «Hoy» acababa en otra pantalla; ahora abre «Hoy». Solo si el enlace
// trae filtro (`status`/`date`, que «Hoy» no tiene) sigue yendo a la Lista.
export const TABS_RESERVAS = ["hoy", "reservas", "calendario", "asignacion", "blacklist", "configuracion"] as const;

/** Nombres de pestaña que se escriben a mano o en notas: `?tab=proximas` abre «Próximas reservas». */
const ALIAS_TAB_RESERVAS = new Map<string, TabReservas>([
  ["proximas", "asignacion"],
  ["proximas-reservas", "asignacion"],
  ["calendario-ocupacion", "calendario"],
]);
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
      return status || date ? { tab: "reservas", status, date } : { tab: "hoy", status, date };
    case "lista":
    case null:
      return { tab: "reservas", status, date };
    default: {
      const alias = ALIAS_TAB_RESERVAS.get(tab);
      if (alias) return { tab: alias, status, date };
      return (TABS_RESERVAS as readonly string[]).includes(tab)
        ? { tab: tab as TabReservas, status, date }
        : { tab: "reservas", status, date };
    }
  }
}

// ----------------------------------------------------------------------------
// Subpestañas de «Configuración»: /reservas?tab=configuracion&sub=plantillas
// ----------------------------------------------------------------------------
// «Plantillas email» son los correos de reserva, que hasta el 04/11/2026
// vivían en el Super Admin (/super-admin/plantillas-email, que ahora redirige
// aquí). Como las pestañas de arriba, la URL solo se lee al llegar por un
// enlace: al cambiar de chip a mano se limpia.
//
// 04/11/2026, petición del dueño («pon subpestañas porque el scroll es
// eterno»): lo que era un solo chip «General» (reglas, mesas y turnos, todo
// seguido) se reparte en cuatro, cada uno corto:
//   · «Reglas»: antelación y cierre, límites por contacto, comensales y qué
//     datos se piden;
//   · «Servicio»: tiempo de ocupación de mesa, retraso del modo servicio y
//     qué salas y mesas se ofrecen al asignar;
//   · «Mesas»: mesas y aforo por espacio;
//   · «Turnos»: los periodos de servicio.
// «Servicio» y «Mesas» van aparte porque las dos son una lista sala a sala, y
// juntas volvían a dar un scroll largo.
export const SUBPESTANAS_CONFIGURACION = ["reglas", "servicio", "mesas", "turnos", "plantillas"] as const;
export type SubpestanaConfiguracion = (typeof SUBPESTANAS_CONFIGURACION)[number];

/** Texto de cada chip. Aquí y no en la página: el aviso de «corrige esto en …» del formulario los nombra igual. */
export const ETIQUETAS_SUBPESTANA_CONFIGURACION: Record<SubpestanaConfiguracion, string> = {
  reglas: "Reglas",
  servicio: "Servicio",
  mesas: "Mesas",
  turnos: "Turnos",
  plantillas: "Plantillas email",
};

/**
 * Nombres viejos que siguen valiendo. `sub=general` era el chip único de antes del reparto (enlaces
 * guardados, notas): abre el primero, «Reglas». Un `Map` y no un objeto, para que `sub=toString` y
 * compañía no encuentren nada heredado.
 */
const ALIAS_SUBPESTANA_CONFIGURACION = new Map<string, SubpestanaConfiguracion>([["general", "reglas"]]);

/** `?sub=` → subpestaña de Configuración; sin ella, o desconocida, «Reglas». */
export function resolverSubpestanaConfiguracion(sub?: string | null): SubpestanaConfiguracion {
  const valor = sub ?? "";
  if ((SUBPESTANAS_CONFIGURACION as readonly string[]).includes(valor)) return valor as SubpestanaConfiguracion;
  return ALIAS_SUBPESTANA_CONFIGURACION.get(valor) ?? "reglas";
}
