// ============================================================================
// ACCIONES DE UNA RESERVA — qué se puede hacer con ella en cada vista, por
// estado y por permiso. Una función PURA: sin React, sin Supabase, sin reloj.
// ----------------------------------------------------------------------------
// Antes esta decisión estaba repartida en los `if (estado === …)` de la lista
// (ListaReservasAvanzada: `accionPrincipalReserva`, `tituloCancelar`, los
// `onClick` de cada ranura), en `ControlLlegada` + la tarjeta del kanban
// (GestorReservasKanban) y en las comprobaciones de `canEdit` de cada pantalla.
// `accionesDisponibles` las junta en UN sitio y las dos vistas la leen para
// pintar (Hoy: kanban, `ControlLlegada` y modo servicio; Lista: componente
// `AccionesReserva`) y para ejecutar (un único ejecutor) sin volver a decidir nada.
//
// LISTA Y HOY SON DIFERENTES A PROPÓSITO (decisión del dueño): la Lista es de
// GESTIÓN (aceptar, verificar, confirmar, cancelar) y Hoy es de SERVICIO (ha
// llegado, no vino, deshacer, mover). Este módulo NO unifica sus conjuntos de
// botones: solo centraliza la fuente de verdad de cada uno. Lo que una vista no
// tiene sale con `visible: false`.
//
//   visible     ¿Existe ese botón para esta reserva en esta vista? En la Lista
//               casi todas las ranuras se pintan SIEMPRE (petición del dueño,
//               2026-09-26: los botones no bailan de sitio) y lo que no aplica
//               va `habilitada: false` con el porqué en `titulo`. En Hoy lo que
//               no aplica directamente no se pinta (p. ej. «Ha llegado» en una
//               reserva que ya llegó: su sitio lo ocupa el chip con «Deshacer»).
//               Sin permiso de edición, nada es visible (06/11/2026).
//   habilitada  ¿Se puede pulsar? Lo decide el estado. NO mira el estado
//               transitorio de la pantalla (petición en curso): eso lo suma quien
//               pinta (`ocupada || !habilitada`).
//   titulo      Texto para el `title` / `aria-label` del botón. SIEMPRE dice algo
//               si `visible`, también habilitado; vacío si no es visible.
//
// MATRIZ CON PERMISO (✔ = habilitada, ✖ = visible pero deshabilitada, · = no
// visible). Columnas en el orden del ciclo de vida (`ORDEN_ESTADOS`).
//
// SIN PERMISO (`canEdit` false): TODO va a «·», en las dos vistas (06/11/2026,
// decisión del dueño para quien solo tiene «Ver» en Reservas: lo que no puede
// usar se OCULTA, no se desactiva, y la página enseña la etiqueta común «Solo
// lectura», `EtiquetaSoloLectura`). Hasta entonces salía deshabilitado con «No
// tienes permiso para editar reservas» (cambios c y e de abajo).
//
//   LISTA (gestión)     pend.  verif.  confirm.  Llegó  cancel.  No vino
//   aceptar              ✔      ·       ·         ·      ·        ·
//   confirmar            ·      ✔       ✖         ✖      ✖        ✖
//   verificar            ✔      ✖       ✖         ✖      ✖        ✖
//   seleccionar (bloque) ✔      ·       ·         ·      ·        ·
//   cancelar (**)        ✔      ✔       ✔         ✖      ✖        ✖
//   editar               ✔      ✔       ✔         ✔      ✔        ✔
//   importante           ✔      ✔       ✔         ✔      ✔        ✔
//   listaNegra           ✔      ✔       ✔         ✔      ✔        ✔
//   haLlegado/noVino/deshacer/mover: · en todos los estados
//
//   HOY (servicio)      pend.  verif.  confirm.  Llegó  cancel.(***)  No vino
//   haLlegado            ✔      ✔       ✔         ·      ·            ·
//   noVino               ✔      ✔       ✔         ·      ·            ·
//   deshacer             ·      ·       ·         ✔      ·            ✔
//   mover                ✔      ✔       ✔         ✔      ✖            ✖
//   editar               ✔      ✔       ✔         ✔      ✔            ✔
//   importante           ✔      ✔       ✔         ✔      ✔            ✔
//   listaNegra           ✔      ✔       ✔         ✔      ✔            ✔
//   aceptar/confirmar/verificar/seleccionar/cancelar: · en todos los estados
//
// (**) Cambio acordado: antes también se podía cancelar una reserva «Llegó» o «No
//     vino»; ya no (decisión del dueño). Si la Lista quiere que la ranura siga
//     en su sitio, sale deshabilitada con el motivo.
// (***) «Cancelada» nunca llega a Hoy (el kanban la excluye con
//     `neq("estado","cancelada")`): la columna está por coherencia, no por uso.
//
// CAMBIOS ACORDADOS respecto al comportamiento de hoy:
//   · (a) `cancelar` no se ofrece en «Llegó» / «No vino».
//   · (b) `editar` está visible en los seis estados (con permiso).
//   · (c) Hoy respeta el permiso: «Ha llegado», «No vino», «Deshacer», «Mover», la
//     estrella y la lista negra exigen `canEdit`. Antes el kanban no miraba el
//     permiso y se apoyaba en la RLS.
//   · (d) Un solo vocabulario: «Ha llegado» / «No vino» (antes el menú del kanban
//     decía «No se presentó»). En la Lista, «Llegó» ya no se dice «ya servida».
//   · (e) La Lista también respeta el permiso en «Verificar», la estrella y la
//     lista negra (decisión del dueño, 2026-10-01, junto con endurecer la RLS de
//     `reservas`: escribir exige permiso de EDICIÓN).
//   · (f) 06/11/2026: sin permiso, todo oculto (ver arriba).
//
// FUERA DE ESTA FUNCIÓN, a propósito y tal como está hoy:
//   · «Dar mesa» lo decide `resolverSaltoAsignacion` (saltoAsignacion.ts), módulo
//     compartido con el kanban de Hoy (menú «⋮» de las tarjetas «Sin mesa»). Con
//     permiso, la Lista siempre lo pinta, habilitado si la reserva tiene sala y
//     fecha y no está cancelada; sin permiso no se pinta (lleva a repartir mesas).
//   · «Gestionar» es de las SOLICITUDES del bot; en una reserva esa ranura es
//     ahora «editar».
//   · «Llamar» (enlace tel:) del menú de la tarjeta.
// ============================================================================

import {
  ESTADO_CANCELADA,
  ESTADO_LLEGADA,
  ESTADO_NO_SHOW,
  ESTADO_PENDIENTE,
  ESTADO_VERIFICADA,
  esEstadoVivo,
  infoEstadoReserva,
  ocupaEspacio,
} from "./estadosReserva";

export type VistaReservas = "lista" | "hoy";

/** Todas las acciones posibles, agrupadas por la vista a la que pertenecen. */
export const ACCIONES_RESERVA = [
  // Gestión (Lista)
  "aceptar",
  "verificar",
  "confirmar",
  "cancelar",
  "seleccionar",
  // Servicio (Hoy)
  "haLlegado",
  "noVino",
  "deshacer",
  "mover",
  // Las dos vistas
  "editar",
  "importante",
  "listaNegra",
] as const;

export type AccionReserva = (typeof ACCIONES_RESERVA)[number];

export interface EstadoAccion {
  visible: boolean;
  habilitada: boolean;
  titulo: string;
}

export type AccionesDisponibles = Record<AccionReserva, EstadoAccion>;

/** Lo mínimo de una reserva que hace falta para decidir. */
export interface ReservaParaAcciones {
  estado: string;
  /** Para los textos («Cancelar la reserva de Ana»). Sin nombre: «este cliente». */
  nombre?: string | null;
  /** Para el texto de la estrella («Marcar» / «Quitar»). */
  importante?: boolean | null;
}

export interface OpcionesAcciones {
  vista: VistaReservas;
  /** Permiso de edición sobre la sección «reservas» (`useCanAccessSection("reservas", "edit")`). */
  canEdit: boolean;
}

/**
 * Motivo «sin permiso» de antes del 06/11/2026, cuando lo que no se podía usar salía deshabilitado.
 * Ya no lo devuelve `accionesDisponibles` (sin permiso todo va oculto); se conserva para las
 * pantallas que todavía lo enseñen como defensa (p. ej. el editor si se abre sin permiso).
 */
export const TITULO_SIN_PERMISO_EDITAR = "No tienes permiso para editar reservas";
/** Ídem, el del botón de cancelar de la lista. */
export const TITULO_SIN_PERMISO_CANCELAR = "No tienes permiso para cancelar reservas";
/**
 * «Aceptar» de la Lista: acepta la reserva TAL COMO ESTÁ, sin tocar hora ni sala
 * (cambio acordado con el dueño, 2026-10-01). Antes: «tal y como la pidió el cliente».
 */
// 10/11/2026 (dueño): el botón se llama «Verificar», porque es lo que hace (pasa a `verificada`). La clave
// interna sigue siendo `aceptar`.
export const TITULO_ACEPTAR = "Verificar la reserva tal como está (hora y sala actuales); se avisa al cliente si tiene email";

const oculta = (): EstadoAccion => ({ visible: false, habilitada: false, titulo: "" });
const accion = (habilitada: boolean, titulo: string): EstadoAccion => ({ visible: true, habilitada, titulo });

/**
 * El motivo por el que un botón está deshabilitado, listo para `ConMotivo`: el
 * `titulo` si no se puede pulsar (ahí dice por qué) y nada si se puede. Un botón
 * deshabilitado no recibe el ratón, así que el motivo se enseña en su envoltorio.
 */
export const motivoSiNoSePuede = (a: EstadoAccion): string | undefined => (a.habilitada ? undefined : a.titulo || undefined);

/** Frase «la reserva está …» del estado, o el estado tal cual si no es de los seis. */
const fraseDe = (estado: string) => infoEstadoReserva(estado)?.frase ?? estado;

/** Por qué no se puede cancelar una reserva que no está viva. */
function motivoNoCancelable(estado: string): string {
  if (estado === ESTADO_CANCELADA) return "La reserva ya está cancelada";
  if (estado === ESTADO_LLEGADA) return "No se puede cancelar una reserva que ya llegó";
  if (estado === ESTADO_NO_SHOW) return "No se puede cancelar una reserva marcada como «No vino»";
  return `No se puede cancelar: la reserva está ${fraseDe(estado)}`;
}

/** Sin permiso de edición: ninguna acción (todo oculto, decisión del dueño del 06/11/2026). */
const SIN_PERMISO: AccionesDisponibles = Object.fromEntries(
  ACCIONES_RESERVA.map((a) => [a, oculta()]),
) as AccionesDisponibles;

/**
 * Qué acciones tiene `reserva` en `vista`, cuáles se pueden pulsar y con qué
 * texto. Devuelve SIEMPRE las doce claves de `ACCIONES_RESERVA`. Sin `canEdit`,
 * las doce ocultas.
 */
export function accionesDisponibles(reserva: ReservaParaAcciones, { vista, canEdit }: OpcionesAcciones): AccionesDisponibles {
  if (!canEdit) return { ...SIN_PERMISO };
  const { estado } = reserva;
  const nombre = reserva.nombre || "este cliente";
  const importante = !!reserva.importante;

  return vista === "lista" ? accionesDeLista(estado, nombre, importante) : accionesDeHoy(estado, importante);
}

// ─── LISTA (gestión) ─────────────────────────────────────────────────────────

function accionesDeLista(estado: string, nombre: string, importante: boolean): AccionesDisponibles {
  const pendiente = estado === ESTADO_PENDIENTE;
  const verificada = estado === ESTADO_VERIFICADA;
  const viva = esEstadoVivo(estado);

  return {
    // La acción PRINCIPAL de la fila es una sola: «Aceptar» si está pendiente y
    // «Confirmar» en el resto (deshabilitada si no hay nada que confirmar).
    // «Aceptar» acepta la reserva TAL COMO ESTÁ, sin tocar hora ni sala (ver
    // `espacioAlAceptar` en verificacion.ts).
    aceptar: pendiente ? accion(true, TITULO_ACEPTAR) : oculta(),
    confirmar: pendiente
      ? oculta()
      : verificada
        ? accion(true, "Confirmar la reserva verificada")
        : accion(false, `Nada que aceptar ni confirmar: la reserva está ${fraseDe(estado)}`),

    verificar: pendiente
      ? accion(true, "Verificar: comparar lo pedido con lo ofrecido")
      : accion(false, "Verificar: solo para reservas pendientes"),

    // La casilla de «aceptar en bloque»: solo las pendientes.
    seleccionar: pendiente ? accion(true, "Seleccionar para aceptar en bloque") : oculta(),

    // Cambio (a): solo las vivas se cancelan. «Llegó» y «No vino» ya no.
    cancelar: viva
      ? accion(true, `Cancelar la reserva de ${nombre} — pedirá confirmación`)
      : accion(false, motivoNoCancelable(estado)),

    // Cambio (b): siempre, en los seis estados.
    editar: accion(true, `Gestionar: editar la reserva de ${nombre} — datos, día, hora, comensales y sala`),

    // Cambio (e): en cualquier estado.
    importante: accion(true, importante ? `Desmarcar ${nombre} como importante` : `Marcar ${nombre} como importante`),
    listaNegra: accion(true, `Añadir a ${nombre} a la lista negra`),

    // De servicio: la Lista no los tiene.
    haLlegado: oculta(),
    noVino: oculta(),
    deshacer: oculta(),
    mover: oculta(),
  };
}

// ─── HOY (servicio) ──────────────────────────────────────────────────────────

function accionesDeHoy(estado: string, importante: boolean): AccionesDisponibles {
  const viva = esEstadoVivo(estado);
  const llego = estado === ESTADO_LLEGADA;
  const noVino = estado === ESTADO_NO_SHOW;
  const movible = ocupaEspacio(estado);

  return {
    haLlegado: viva ? accion(true, "Ha llegado") : oculta(),
    noVino: viva ? accion(true, "No vino") : oculta(),
    // En el lugar de «Ha llegado» sale el chip «Llegó» / «No vino» con su «Deshacer».
    deshacer: llego ? accion(true, "Deshacer llegada") : noVino ? accion(true, "Deshacer «No vino»") : oculta(),
    // La entrada «Mover a…» del menú está siempre; lo que cambia es si hay a dónde.
    mover: accion(movible, movible ? "Mover a…" : "No se puede mover en este estado"),

    // Cambio (b): siempre, en los seis estados.
    editar: accion(true, "Editar reserva"),

    importante: accion(true, importante ? "Quitar importante" : "Marcar como importante"),
    listaNegra: accion(true, "Añadir a blacklist"),

    // De gestión: Hoy no los tiene.
    aceptar: oculta(),
    verificar: oculta(),
    confirmar: oculta(),
    cancelar: oculta(),
    seleccionar: oculta(),
  };
}
