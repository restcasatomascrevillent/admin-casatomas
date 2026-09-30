// ============================================================================
// ESTADOS DE UNA RESERVA — fuente ÚNICA de clave, nombre, icono, color y
// descripción de los seis estados.
// ----------------------------------------------------------------------------
// Hasta ahora esto vivía COPIADO en cuatro sitios, cada uno con lo suyo:
//   · `getStatusBadge` de ListaReservasAvanzada.tsx  (nombre + icono + color de
//     las insignias de la lista) y `ESTADO_RESERVA_TEXTO` (la frase que sale en
//     los `title` de sus botones).
//   · `ESTADOS_RESERVA` de GestorReservasKanban.tsx  (nombre + color con la paleta
//     cruda de Tailwind: yellow-500, blue-500, green-500…; sin icono).
//   · `CAMINO` / `SALIDAS` de TimelineEstadosReserva.tsx (nombre + icono + color
//     de las burbujas + la frase que explica cada estado).
//   · `OPCIONES_FILTRO_ESTADO` de vistaUnificada.ts  (el texto de las opciones del
//     filtro «Estado»; lo lee también EditarReservaDialog para rotular el estado).
// Este módulo es un SUPERCONJUNTO de las cuatro: cada campo de aquí existe porque
// alguna copia lo usa, y donde las copias DIFIEREN (ver `etiquetaFiltro`,
// `frase`, `insignia` y `burbuja`) se conservan los valores actuales para que el
// paso de migración de cada consumidor sea un cambio de fuente de datos y no de
// aspecto. Qué converger y qué no es una decisión aparte.
//
// Es un módulo de datos: sin hooks, sin JSX, sin Supabase. Importa los iconos de
// `lucide-react` porque el icono forma parte del estado (lo pintan la lista y el
// timeline), pero no toca React por su cuenta.
//
// LOS SEIS ESTADOS (CHECK `reservas_estado_check`)
// ----------------------------------------------------------------------------
//   pendiente | verificada | confirmada | cancelada | completada | no_show
// «completada» se ve como «Llegó» y «no_show» como «No vino» (ver
// `servicioSala.ts`: «Ha llegado» pasa la reserva a 'completada').
//
// TOKENS `status-*`: SOLO existen para los tres estados vivos (pendiente,
// verificada, confirmada: index.css + tailwind.config.ts). Para cancelada, Llegó y
// No vino NO hay token: se usan las clases que ya usa la lista (destructive,
// emerald-600, secondary). Dárselos a los tres es crear tres variables nuevas en
// index.css y tailwind.config.ts, fuera del alcance de este módulo.
// ============================================================================

import { CheckCheck, CheckCircle, Clock, UserX, XCircle, type LucideIcon } from "lucide-react";

export type EstadoReserva = "pendiente" | "verificada" | "confirmada" | "completada" | "cancelada" | "no_show";

export const ESTADO_PENDIENTE = "pendiente" as const;
export const ESTADO_VERIFICADA = "verificada" as const;
export const ESTADO_CONFIRMADA = "confirmada" as const;
export const ESTADO_CANCELADA = "cancelada" as const;
/** «Ha llegado» = 'completada' (ver servicioSala.ts). Se muestra como «Llegó». */
export const ESTADO_LLEGADA = "completada" as const;
/** «No vino». */
export const ESTADO_NO_SHOW = "no_show" as const;
/** Estado al que vuelve una reserva al deshacer «Llegó» / «No vino» desde el chip. */
export const ESTADO_TRAS_DESHACER = "confirmada" as const;

/**
 * Orden del CICLO DE VIDA, el del timeline: el camino (pendiente → verificada →
 * confirmada → llegó) y luego las dos salidas (cancelada, no vino). El filtro
 * «Estado» de la lista usa hoy otro orden (no_show antes que cancelada) y la
 * función `getStatusBadge` un tercero; ninguno es el del CHECK de la BD.
 */
export const ORDEN_ESTADOS = [
  "pendiente",
  "verificada",
  "confirmada",
  "completada",
  "cancelada",
  "no_show",
] as const satisfies readonly EstadoReserva[];

/**
 * Estados «vivos»: los que todavía esperan al cliente y cuentan para el aforo
 * (mismo conjunto que `ESTADOS_QUE_OCUPAN` del trigger y que `esperandoLlegada`
 * de servicioSala.ts; un test lo comprueba).
 */
export const ESTADOS_VIVOS = ["pendiente", "verificada", "confirmada"] as const satisfies readonly EstadoReserva[];

/**
 * Estados terminales: el flujo normal ya no avanza desde ellos (la reserva se
 * cerró: cancelada, el cliente llegó o el cliente no vino). «Llegó» y «No vino»
 * se pueden deshacer a mano con «Deshacer», pero eso es una corrección, no un
 * paso del flujo.
 */
export const ESTADOS_TERMINALES = ["completada", "cancelada", "no_show"] as const satisfies readonly EstadoReserva[];

export interface InfoEstadoReserva {
  clave: EstadoReserva;
  /** Nombre en las insignias de la lista, el kanban, el timeline y los chips: «Llegó», «No vino»… */
  etiqueta: string;
  /**
   * Texto de la opción del filtro «Estado» (hoy en `vistaUnificada.ts`). Difiere
   * de `etiqueta` en dos: «Llegó / completada» y «No se presentó». TRANSITORIO:
   * se conserva para que migrar el filtro no cambie lo que ve el personal; si
   * se converge al vocabulario único «Llegó» / «No vino», esta propiedad sobra.
   */
  etiquetaFiltro: string;
  /**
   * Cómo se dice el estado en una frase «la reserva está …» (hoy
   * `ESTADO_RESERVA_TEXTO` de la lista, para el `title` del botón principal).
   * Conserva «ya servida» y «marcada como «no vino»»: distinto vocabulario del
   * de las insignias, igual que `etiquetaFiltro`.
   */
  frase: string;
  Icono: LucideIcon;
  /**
   * Clases de la insignia sólida (la de la lista): relleno + color de texto. Se
   * le pasan a `<Badge className={cn(…, insignia)}>`. Las tres primeras son los
   * tokens `status-*`; el resto, lo que la lista usa hoy (destructive /
   * emerald-600 / secondary) porque NO hay token para esos tres estados.
   */
  insignia: string;
  /**
   * Clases de la burbuja del timeline: sólida en el camino principal y con borde
   * discontinuo en las dos salidas (cancelada, no vino).
   */
  burbuja: string;
  /** Solo las salidas del timeline: CUÁNDO pasa, en negrita delante de `descripcion`. */
  cuando?: string;
  /** Qué significa el estado y qué toca hacer, en una frase (la del timeline). */
  descripcion: string;
}

/**
 * Los seis estados, en el orden de `ORDEN_ESTADOS`. Las cadenas son las mismas
 * que hoy pintan las cuatro copias (ver la cabecera); no hay ninguna nueva.
 */
export const ESTADOS_RESERVA: Readonly<Record<EstadoReserva, InfoEstadoReserva>> = {
  pendiente: {
    clave: "pendiente",
    etiqueta: "Pendiente",
    etiquetaFiltro: "Pendiente",
    frase: "pendiente",
    Icono: Clock,
    insignia: "bg-status-pending text-status-pending-foreground",
    burbuja: "bg-status-pending text-status-pending-foreground dark:text-background",
    descripcion: "Solicitada por web o teléfono. Toca verificarla.",
  },
  verificada: {
    clave: "verificada",
    etiqueta: "Verificada",
    etiquetaFiltro: "Verificada",
    frase: "verificada",
    Icono: CheckCircle,
    insignia: "bg-status-verified text-status-verified-foreground",
    burbuja: "bg-status-verified text-status-verified-foreground",
    descripcion: "Revisada: el cliente recibe «Confirma tu reserva».",
  },
  confirmada: {
    clave: "confirmada",
    etiqueta: "Confirmada",
    etiquetaFiltro: "Confirmada",
    frase: "ya confirmada",
    Icono: CheckCircle,
    insignia: "bg-status-confirmed text-status-confirmed-foreground",
    burbuja: "bg-status-confirmed text-status-confirmed-foreground",
    descripcion: "Confirma el cliente (o tú con «Confirmar»).",
  },
  completada: {
    clave: "completada",
    etiqueta: "Llegó",
    etiquetaFiltro: "Llegó / completada",
    frase: "ya servida",
    Icono: CheckCheck,
    insignia: "bg-emerald-600 text-white",
    burbuja: "bg-emerald-600 text-white",
    descripcion: "Ya está en el local. Se marca con «Ha llegado».",
  },
  cancelada: {
    clave: "cancelada",
    etiqueta: "Cancelada",
    etiquetaFiltro: "Cancelada",
    frase: "cancelada",
    Icono: XCircle,
    insignia: "bg-destructive text-destructive-foreground",
    burbuja: "border-2 border-dashed border-destructive/70 bg-destructive/10 text-destructive",
    cuando: "En cualquier momento:",
    descripcion: "la cancelas tú o el cliente.",
  },
  no_show: {
    clave: "no_show",
    etiqueta: "No vino",
    etiquetaFiltro: "No se presentó",
    frase: "marcada como «no vino»",
    Icono: UserX,
    insignia: "bg-secondary text-secondary-foreground",
    burbuja: "border-2 border-dashed border-muted-foreground/70 bg-muted/60 text-muted-foreground",
    cuando: "Si no se presenta:",
    descripcion: "lo marcas tú o el sistema.",
  },
};

/** ¿Es uno de los seis estados del CHECK? (Cualquier otro texto no existe en la BD.) */
export function esEstadoReserva(estado: unknown): estado is EstadoReserva {
  return typeof estado === "string" && (ORDEN_ESTADOS as readonly string[]).includes(estado);
}

/** Pendiente, verificada o confirmada: sigue esperando al cliente y ocupa aforo. */
export function esEstadoVivo(estado: string | null | undefined): boolean {
  return typeof estado === "string" && (ESTADOS_VIVOS as readonly string[]).includes(estado);
}

/** Cancelada, «Llegó» o «No vino»: el flujo normal ya no avanza desde aquí. */
export function esTerminal(estado: string | null | undefined): boolean {
  return typeof estado === "string" && (ESTADOS_TERMINALES as readonly string[]).includes(estado);
}

/**
 * ¿Ocupa sitio físico en una sala? Los vivos más «Llegó» (el cliente ya está
 * sentado). Cancelada y No vino no ocupan nada: por eso no se mueven. Es
 * `ocupaEspacio` de servicioSala.ts, y para los seis estados coincide con
 * `puedeMoverReserva`.
 */
export function ocupaEspacio(estado: string | null | undefined): boolean {
  return esEstadoVivo(estado) || estado === ESTADO_LLEGADA;
}

/**
 * La ficha del estado, o `undefined` si no es uno de los seis. Quien pinta ya
 * decide qué hacer con un estado desconocido (la lista lo enseña como insignia
 * con borde y el texto tal cual; el kanban, en gris): aquí no se inventa ninguno.
 */
export function infoEstadoReserva(estado: string | null | undefined): InfoEstadoReserva | undefined {
  return esEstadoReserva(estado) ? ESTADOS_RESERVA[estado] : undefined;
}

/** «Llegó», «No vino»… o el texto tal cual si no es un estado conocido. */
export function etiquetaEstadoReserva(estado: string | null | undefined): string {
  return infoEstadoReserva(estado)?.etiqueta ?? estado ?? "";
}
