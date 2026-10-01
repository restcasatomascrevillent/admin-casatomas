// ============================================================================
// ESTADOS DE UNA RESERVA — fuente ÚNICA de clave, nombre, icono, color y
// descripción de los seis estados.
// ----------------------------------------------------------------------------
// Antes esto vivía COPIADO en cuatro sitios, cada uno con lo suyo. Hoy lo LEEN de
// aquí el kanban de Hoy (`GestorReservasKanban`: nombre y color de la insignia),
// el timeline (`TimelineEstadosReserva`: nodos, burbujas y frases), el control de
// llegada (`ControlLlegada`), el modo servicio (`ModoServicioPlano`), el filtro
// «Estado» (`vistaUnificada.ts`), `servicioSala.ts` (constantes y predicados) y,
// desde el paso 3, la Lista (`ListaReservasAvanzada`: la insignia de estado, con
// `insignia` y `varianteInsignia`) y sus botones (`accionesReserva.ts`: `frase`).
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
// VOCABULARIO ÚNICO (decisión del dueño): las ACCIONES son «Ha llegado» y «No
// vino»; los ESTADOS, «Llegó» y «No vino». «No se presentó» y «servida» ya no se
// usan de cara al personal.
//
// TOKENS `status-*`: SOLO existen para los tres estados vivos (pendiente,
// verificada, confirmada: index.css + tailwind.config.ts). Para cancelada, Llegó y
// No vino NO hay token: se usan las clases que ya usa la lista (destructive,
// emerald-600, secondary). No se crean tokens nuevos (decisión del dueño).
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
 * «Estado» de la lista usa otro orden (no_show antes que cancelada); ninguno es
 * el del CHECK de la BD.
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
 * (mismo conjunto que `ESTADOS_QUE_OCUPAN` del trigger; un test lo comprueba).
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
   * Texto de la opción del filtro «Estado» (`vistaUnificada.ts`, y de ahí el
   * «Estado: …» del editor de reservas). Es `etiqueta` salvo en «Llegó», que el
   * filtro escribe «Llegó / completada» para quien busca por el nombre de la BD.
   */
  etiquetaFiltro: string;
  /**
   * Cómo se dice el estado en una frase «la reserva está …» (el `title` del botón
   * principal de la Lista cuando no hay nada que aceptar ni confirmar, vía
   * `accionesReserva.ts`). «Llegó» se dice «marcada como «Llegó»»: el vocabulario
   * único, ya no «ya servida».
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
   * Variante del `Badge` con la que la Lista pinta la insignia, si no es la de por
   * defecto: cancelada y «No vino» van con la suya (`destructive`, `secondary`), que
   * trae su propio fondo al pasar el ratón; las demás, con la de por defecto y sus
   * clases.
   */
  varianteInsignia?: "destructive" | "secondary";
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
 * Los seis estados, en el orden de `ORDEN_ESTADOS`. Las cadenas son las que
 * pintaban las cuatro copias que había (ver la cabecera), salvo la `frase` de
 * «Llegó», que deja el «ya servida» por el vocabulario único.
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
    frase: "marcada como «Llegó»",
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
    varianteInsignia: "destructive",
    burbuja: "border-2 border-dashed border-destructive/70 bg-destructive/10 text-destructive",
    // Hasta que el cliente llega: una reserva «Llegó» o «No vino» ya no se cancela.
    cuando: "Antes de que llegue:",
    descripcion: "la cancelas tú o el cliente.",
  },
  no_show: {
    clave: "no_show",
    etiqueta: "No vino",
    etiquetaFiltro: "No vino",
    frase: "marcada como «no vino»",
    Icono: UserX,
    insignia: "bg-secondary text-secondary-foreground",
    varianteInsignia: "secondary",
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
 * sentado). Cancelada y No vino no ocupan nada: por eso no se mueven (es
 * también la regla de «Mover»). servicioSala.ts la reexporta con este nombre.
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
