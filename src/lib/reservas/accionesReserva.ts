// ============================================================================
// ACCIONES DE UNA RESERVA — qué se puede hacer con ella en cada vista, por
// estado y por permiso. Una función PURA: sin React, sin Supabase, sin reloj.
// ----------------------------------------------------------------------------
// Hasta ahora esta decisión estaba repartida en los `if (estado === …)` de la
// lista (ListaReservasAvanzada: `accionPrincipalReserva`, `tituloCancelar`, los
// `onClick` de cada ranura), en `ControlLlegada` + la tarjeta del kanban
// (GestorReservasKanban) y en las comprobaciones de `canEdit` de cada pantalla.
// `accionesDisponibles` las junta en UN sitio para que las dos vistas puedan
// pintar (paso 3: componente `AccionesReserva`) y ejecutar (paso 2: un único
// ejecutor) sin volver a decidir nada.
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
//   habilitada  ¿Se puede pulsar? Mezcla estado y permiso. NO mira el estado
//               transitorio de la pantalla (petición en curso): eso lo suma quien
//               pinta (`ocupada || !habilitada`).
//   titulo      Texto para el `title` / `aria-label` del botón. SIEMPRE dice algo
//               si `visible`, también habilitado; vacío si no es visible.
//
// MATRIZ CON PERMISO (✔ = habilitada, ✖ = visible pero deshabilitada, · = no
// visible). Columnas en el orden del ciclo de vida (`ORDEN_ESTADOS`). Sin permiso
// (`canEdit` false) todo lo que escribe en `reservas` pasa de ✔ a ✖ y lo que
// estaba en · sigue en ·; la única excepción es «seleccionar», que sin permiso
// desaparece.
//
//   LISTA (gestión)     pend.  verif.  confirm.  Llegó  cancel.  No vino
//   aceptar              ✔      ·       ·         ·      ·        ·
//   confirmar            ·      ✔       ✖         ✖      ✖        ✖
//   verificar (*)        ✔      ✖       ✖         ✖      ✖        ✖
//   seleccionar (bloque) ✔      ·       ·         ·      ·        ·
//   cancelar (**)        ✔      ✔       ✔         ✖      ✖        ✖
//   editar               ✔      ✔       ✔         ✔      ✔        ✔
//   importante (*)       ✔      ✔       ✔         ✔      ✔        ✔
//   listaNegra (*)       ✔      ✔       ✔         ✔      ✔        ✔
//   haLlegado/noVino/deshacer/mover: · en todos los estados
//
//   HOY (servicio)      pend.  verif.  confirm.  Llegó  cancel.(***)  No vino
//   haLlegado            ✔      ✔       ✔         ·      ·            ·
//   noVino               ✔      ✔       ✔         ·      ·            ·
//   deshacer             ·      ·       ·         ✔      ·            ✔
//   mover                ✔      ✔       ✔         ✔      ✖            ✖
//   editar               ✔      ✔       ✔         ✔      ✔            ✔
//   importante           ✔      ✔       ✔         ✔      ✔            ✔
//   listaNegra (*)       ✔      ✔       ✔         ✔      ✔            ✔
//   aceptar/confirmar/verificar/seleccionar/cancelar: · en todos los estados
//
// (*) NO mira `canEdit`, igual que hoy: «Verificar» abre el modal, que va en solo
//     lectura sin permiso; la estrella y la lista negra escriben sin comprobarlo
//     (la RLS las rechaza, y la estrella ni se entera: ver los tests de efectos).
// (**) Cambio acordado: antes también se podía cancelar una reserva «Llegó» o «No
//     vino»; ya no (decisión del dueño). Si la Lista quiere que la ranura siga
//     en su sitio, sale deshabilitada con el motivo.
// (***) «Cancelada» nunca llega a Hoy (el kanban la excluye con
//     `neq("estado","cancelada")`): la columna está por coherencia, no por uso.
//
// CAMBIOS ACORDADOS respecto al comportamiento de hoy:
//   · (a) `cancelar` no se ofrece en «Llegó» / «No vino».
//   · (b) `editar` está visible en los seis estados, y habilitada según
//     `canEdit` («No tienes permiso para editar reservas» si no).
//   · (c) Hoy respeta el permiso: «Ha llegado», «No vino», «Deshacer», «Mover» y
//     la estrella pasan a ir deshabilitadas sin `canEdit`. Hoy el kanban no mira
//     el permiso y se apoya en la RLS.
//   · (d) Un solo vocabulario: «Ha llegado» / «No vino» (antes el menú del kanban
//     decía «No se presentó»).
//
// FUERA DE ESTA FUNCIÓN, a propósito y tal como está hoy:
//   · «Dar mesa» lo decide `resolverSaltoAsignacion` (saltoAsignacion.ts), módulo
//     compartido con la franja «Pendientes de mesa» de Hoy: Lista siempre lo
//     pinta, habilitado si la reserva tiene sala y fecha y no está cancelada, sin
//     mirar `canEdit`; la tarjeta del kanban no lo tiene.
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

/** Texto ya existente en la lista, el kanban, el plano y el panel de asignación. */
export const TITULO_SIN_PERMISO_EDITAR = "No tienes permiso para editar reservas";
/** Texto actual del botón de cancelar de la lista. */
export const TITULO_SIN_PERMISO_CANCELAR = "No tienes permiso para cancelar reservas";

const oculta = (): EstadoAccion => ({ visible: false, habilitada: false, titulo: "" });
const accion = (habilitada: boolean, titulo: string): EstadoAccion => ({ visible: true, habilitada, titulo });

/** Frase «la reserva está …» del estado, o el estado tal cual si no es de los seis. */
const fraseDe = (estado: string) => infoEstadoReserva(estado)?.frase ?? estado;

/** Por qué no se puede cancelar una reserva que no está viva. */
function motivoNoCancelable(estado: string): string {
  if (estado === ESTADO_CANCELADA) return "La reserva ya está cancelada";
  if (estado === ESTADO_LLEGADA) return "No se puede cancelar una reserva que ya llegó";
  if (estado === ESTADO_NO_SHOW) return "No se puede cancelar una reserva marcada como «No vino»";
  return `No se puede cancelar: la reserva está ${fraseDe(estado)}`;
}

/**
 * Qué acciones tiene `reserva` en `vista`, cuáles se pueden pulsar y con qué
 * texto. Devuelve SIEMPRE las doce claves de `ACCIONES_RESERVA`.
 */
export function accionesDisponibles(reserva: ReservaParaAcciones, { vista, canEdit }: OpcionesAcciones): AccionesDisponibles {
  const { estado } = reserva;
  const nombre = reserva.nombre || "este cliente";
  const importante = !!reserva.importante;

  return vista === "lista" ? accionesDeLista(estado, nombre, importante, canEdit) : accionesDeHoy(estado, importante, canEdit);
}

// ─── LISTA (gestión) ─────────────────────────────────────────────────────────

function accionesDeLista(estado: string, nombre: string, importante: boolean, canEdit: boolean): AccionesDisponibles {
  const pendiente = estado === ESTADO_PENDIENTE;
  const verificada = estado === ESTADO_VERIFICADA;
  const viva = esEstadoVivo(estado);

  return {
    // La acción PRINCIPAL de la fila es una sola: «Aceptar» si está pendiente y
    // «Confirmar» en el resto (deshabilitada si no hay nada que confirmar).
    aceptar: pendiente
      ? accion(canEdit, canEdit ? "Aceptar la reserva tal y como la pidió el cliente" : TITULO_SIN_PERMISO_EDITAR)
      : oculta(),
    confirmar: pendiente
      ? oculta()
      : !canEdit
        ? accion(false, TITULO_SIN_PERMISO_EDITAR)
        : verificada
          ? accion(true, "Confirmar la reserva verificada")
          : accion(false, `Nada que aceptar ni confirmar: la reserva está ${fraseDe(estado)}`),

    // NO mira `canEdit`: hoy el botón abre el modal aunque no haya permiso y el
    // modal se queda en solo lectura (sin «Verificar» ni «Rechazar»).
    verificar: pendiente
      ? accion(true, "Verificar: comparar lo pedido con lo ofrecido")
      : accion(false, "Verificar: solo para reservas pendientes"),

    // La casilla de «aceptar en bloque»: solo las pendientes y solo con permiso.
    seleccionar: pendiente && canEdit ? accion(true, "Seleccionar para aceptar en bloque") : oculta(),

    // Cambio (a): solo las vivas se cancelan. «Llegó» y «No vino» ya no.
    cancelar: viva
      ? accion(canEdit, canEdit ? `Cancelar la reserva de ${nombre} — pedirá confirmación` : TITULO_SIN_PERMISO_CANCELAR)
      : accion(false, motivoNoCancelable(estado)),

    // Cambio (b): siempre, en los seis estados; solo la apaga el permiso.
    editar: accion(
      canEdit,
      canEdit
        ? `Gestionar: editar la reserva de ${nombre} — datos, día, hora, comensales y sala`
        : TITULO_SIN_PERMISO_EDITAR,
    ),

    // NO miran `canEdit` (ver la cabecera).
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

function accionesDeHoy(estado: string, importante: boolean, canEdit: boolean): AccionesDisponibles {
  const viva = esEstadoVivo(estado);
  const llego = estado === ESTADO_LLEGADA;
  const noVino = estado === ESTADO_NO_SHOW;
  const movible = ocupaEspacio(estado);
  // Cambio (c): lo que escribe en `reservas` respeta el permiso.
  const conPermiso = (habilitadoTitulo: string) => accion(canEdit, canEdit ? habilitadoTitulo : TITULO_SIN_PERMISO_EDITAR);

  return {
    haLlegado: viva ? conPermiso("Ha llegado") : oculta(),
    noVino: viva ? conPermiso("No vino") : oculta(),
    // En el lugar de «Ha llegado» sale el chip «Llegó» / «No vino» con su «Deshacer».
    deshacer: llego ? conPermiso("Deshacer llegada") : noVino ? conPermiso("Deshacer «No vino»") : oculta(),
    // La entrada «Mover a…» del menú está siempre; lo que cambia es si hay a dónde.
    mover: accion(
      movible && canEdit,
      !movible ? "No se puede mover en este estado" : canEdit ? "Mover a…" : TITULO_SIN_PERMISO_EDITAR,
    ),

    // Cambio (b): siempre, en los seis estados.
    editar: conPermiso("Editar reserva"),

    importante: conPermiso(importante ? "Quitar importante" : "Marcar como importante"),
    // NO mira `canEdit` (la lista negra tiene su propia tabla y su propio modal).
    listaNegra: accion(true, "Añadir a blacklist"),

    // De gestión: Hoy no los tiene.
    aceptar: oculta(),
    verificar: oculta(),
    confirmar: oculta(),
    cancelar: oculta(),
    seleccionar: oculta(),
  };
}
