// ============================================================================
// ACCIONES QUE EJECUTA EL EJECUTOR — qué hace cada una, declarado en UN sitio.
// ----------------------------------------------------------------------------
// Módulo PURO (sin React, sin Supabase, sin reloj: `ahora` llega por parámetro).
//
// `accionesReserva.ts` (paso 0) decide QUÉ BOTONES tiene una reserva en cada vista.
// Este módulo declara QUÉ HACE cada botón cuando se pulsa, y el ejecutor
// (`useAccionesServicioReserva`) lo lee para hacerlo siempre igual:
//
//   guarda         el estado de PARTIDA: lo decide `accionesDisponibles` (la misma función
//                  que pinta el botón habilitado o no), no una regla aparte. Si la reserva
//                  no está en uno de esos estados, no se escribe nada; y la escritura va
//                  condicionada a ellos en la BD (`.in("estado", …)`, ver
//                  `escribirReserva.ts`) por si la pantalla llevaba un rato sin refrescar.
//                  Las acciones que GUARDAN el estado previo para deshacer (llegada, «No
//                  vino», deshacer) escriben condicionadas al estado que vio el personal
//                  (`desdeEstadoVisto`), para que el estado previo sea verdad. Llegada y «No
//                  vino» (`adoptaEstadoVivo`) además ADOPTAN el estado de verdad si la
//                  reserva sigue viva aunque ya no sea el de la tarjeta (la tarjeta decía
//                  «Verificada» y el cliente ya había confirmado): un reintento desde ese
//                  estado, sin error. El chip «Deshacer» exige el estado exacto.
//   cambios        las COLUMNAS que escribe.
//   avisaCliente   si se llama a `notify-reservation-change` (el correo al cliente).
//                  Son cinco: aceptar, verificar, confirmar, cancelar y rechazar. Llegada,
//                  «No vino», deshacer, mover y la estrella son decisiones INTERNAS: no
//                  se le cuentan al cliente ('completada' y 'no_show' ni tienen plantilla).
//   aviso          lo que se le dice al PERSONAL cuando se ha guardado (título, detalle y,
//                  si se puede, un «Deshacer» con la escritura inversa).
//   verbo          «No se pudo {verbo}: …» si la escritura falla.
//
// Antes cada una de estas cosas estaba repartida entre seis sitios (la lista, el kanban,
// el modal, `useVerificacionReservas`, `useAccionesServicioReserva` y
// `useCambiarSalaReserva`), cada uno con su manera de escribir, de avisar y de refrescar.
//
// Los TEXTOS y las columnas son los de hoy. Lo único que cambia en el paso 2:
//   · el «Deshacer» del chip vuelve al estado que la reserva tenía ANTES (antes: siempre
//     «Confirmada»; si no se sabe cuál era, sigue siendo «Confirmada»);
//   · ninguna acción parte de un estado que no le corresponde (cancelar una reserva que
//     ya llegó, dar «Ha llegado» a una cancelada, aceptar una ya verificada…).
// ============================================================================

import { accionesDisponibles, type AccionReserva, type VistaReservas } from "./accionesReserva";
import {
  ESTADO_CANCELADA,
  ESTADO_CONFIRMADA,
  ESTADO_LLEGADA,
  ESTADO_NO_SHOW,
  ESTADO_TRAS_DESHACER,
  ESTADO_VERIFICADA,
  ORDEN_ESTADOS,
  etiquetaEstadoReserva,
  type EstadoReserva,
} from "./estadosReserva";
import type { CambiosReserva } from "./escribirReserva";
import {
  MENSAJE_MIGRACION_PENDIENTE,
  avisoAlCliente,
  esErrorMigracionReservasFaltante,
  espacioAlAceptar,
  horaCorta,
  type ReservaParaVerificar,
} from "./verificacion";

export const IDS_ACCIONES_EJECUTABLES = [
  // Gestión (Lista y modal «Verificar solicitud»)
  "aceptar",
  "verificar",
  "confirmar",
  "cancelar",
  "rechazar",
  // Servicio (Hoy, modo servicio)
  "haLlegado",
  "noVino",
  "deshacer",
  "mover",
  // Las dos vistas
  "importante",
] as const;

export type IdAccionEjecutable = (typeof IDS_ACCIONES_EJECUTABLES)[number];

/** Lo que una acción necesita saber de la reserva: sirve tanto a la fila de la Lista como a la tarjeta de Hoy. */
export interface ReservaEjecutable {
  id: string;
  estado: string;
  nombre?: string | null;
  email?: string | null;
  importante?: boolean | null;
  hora?: string;
  espacio_id?: string | null;
  hora_solicitada?: string | null;
  espacio_solicitado_id?: string | null;
}

/** Lo que hace falta además de la reserva, según la acción. `undefined`: nada. */
export interface EntradasAccion {
  aceptar: undefined;
  /** La hora que se le da al cliente y la sala que se le asigna por dentro. */
  verificar: { hora: string; espacio_id: string | null };
  confirmar: undefined;
  cancelar: undefined;
  rechazar: undefined;
  haLlegado: undefined;
  noVino: undefined;
  deshacer: undefined;
  /** A dónde se mueve (`null` = «Sin asignar») y cómo se llama, para el aviso. */
  mover: { destinoId: string | null; nombreDestino: string };
  importante: undefined;
}

export interface ContextoCambios {
  ahora: Date;
  /** El estado que tenía la reserva antes de llegar / no venir, si se sabe (`estadoPrevio.ts`). */
  estadoPrevio?: string;
}

/** La escritura inversa que ofrece el botón «Deshacer» de un aviso. */
export interface Deshacer {
  cambios: CambiosReserva;
  verbo: string;
  /** Estados en los que aún tiene sentido deshacer (si la reserva cambió por otro lado, no se pisa). */
  desde: readonly string[] | null;
  /** Tras deshacer, olvidar el estado previo recordado (ya no sirve). */
  olvidarEstadoPrevio?: boolean;
}

export interface AvisoPersonal {
  titulo: string;
  descripcion?: string;
  /** Milisegundos en pantalla; sin valor, los normales del sistema de avisos. */
  duracionMs?: number;
  deshacer?: Deshacer;
}

export interface DefinicionAccion<K extends IdAccionEjecutable> {
  /** Qué botón de qué vista decide el estado de partida; `null`: vale cualquier estado. */
  guarda: { vista: VistaReservas; accion: AccionReserva } | null;
  /** Texto del aviso de error: «No se pudo {verbo}: …». */
  verbo: (reserva: ReservaEjecutable) => string;
  /** Las columnas que escribe. */
  cambios: (reserva: ReservaEjecutable, entrada: EntradasAccion[K], contexto: ContextoCambios) => CambiosReserva;
  /** ¿Se llama a `notify-reservation-change` tras guardar? */
  avisaCliente: boolean;
  /** Qué se le dice al personal una vez guardado. */
  aviso: (reserva: ReservaEjecutable, entrada: EntradasAccion[K], cambios: CambiosReserva) => AvisoPersonal | null;
  /** Guarda el estado de partida para el «Deshacer» del chip (llegada y «No vino»). */
  recuerdaEstadoPrevio?: boolean;
  /** Olvida el estado de partida guardado (deshacer). */
  olvidaEstadoPrevio?: boolean;
  /**
   * La escritura va condicionada al estado que vio el personal (el de la tarjeta), no a cualquiera
   * de los que admite la regla. Lo piden las acciones que guardan o usan el estado previo para el
   * «Deshacer»: la tarjeta puede estar desfasada (el kanban y la lista no tienen realtime) y, si se
   * guardara un estado que ya no es el de la reserva, deshacer la dejaría donde no le toca. Si el
   * estado cambió, no se escribe (y se avisa, salvo que `adoptaEstadoVivo` lo resuelva).
   */
  desdeEstadoVisto?: boolean;
  /**
   * Solo con `desdeEstadoVisto`: si la reserva ya no está en el estado de la tarjeta pero SIGUE VIVA
   * (pendiente, verificada, confirmada) —p. ej. la tarjeta decía «Verificada» y el cliente ya había
   * confirmado desde el enlace— NO es un error: se relee el estado y se REINTENTA una vez condicionada a
   * ese estado. Ese es el estado previo que se recuerda para el «Deshacer» (toast y chip). Solo si ya no
   * está viva (cancelada, «Llegó», «No vino») o el reintento también falla se avisa del cambio de estado.
   * Sin esto, exigir el estado exacto daba un falso error en rojo al primer toque en plena hora de
   * servicio. El chip «Deshacer» NO lo usa: exige el estado exacto que dejó la acción.
   */
  adoptaEstadoVivo?: boolean;
  /** Mensaje de error propio para un error de la BD; `null`: el de siempre. */
  traducirError?: (error: unknown) => string | null;
  /** Por qué no se puede, cuando la guarda la rechaza (sin él: el del botón o uno genérico). */
  motivoRechazo?: (reserva: ReservaEjecutable) => string;
}

const DURACION_CON_DESHACER_MS = 10_000;

const nombreOr = (reserva: ReservaEjecutable, porDefecto: string) => reserva.nombre || porDefecto;

/** Solo se puede {accion} una reserva {requerido}: … */
const soloDesde = (accion: string, requerido: string) => (reserva: ReservaEjecutable) =>
  `Solo se puede ${accion} una reserva ${requerido}: esta está «${etiquetaEstadoReserva(reserva.estado)}».`;

const traducirErrorMigracion = (error: unknown): string | null =>
  esErrorMigracionReservasFaltante(error) ? MENSAJE_MIGRACION_PENDIENTE : null;

/**
 * El aviso de aceptar / verificar: título corto con la hora y, debajo, el efecto de verdad. La hora es la que
 * se ESCRIBE (`verificar`, el modal, la decide el personal) o, si no se escribe ninguna (`aceptar` no toca la
 * hora), la ACTUAL de la reserva: la que ve el personal en la lista.
 */
const avisoVerificada = (reserva: ReservaEjecutable, cambios: CambiosReserva): AvisoPersonal => ({
  titulo: `Reserva verificada para las ${horaCorta(cambios.hora ?? reserva.hora)}`,
  descripcion: avisoAlCliente({ email: reserva.email ?? null }),
});

/**
 * El aviso de confirmar / cancelar desde la Lista. Sin email (el alta manual ya no lo
 * exige) el cambio no manda ningún correo: se dice, para no dar por hecho que el cliente
 * ya lo sabe.
 */
const avisoEstadoActualizado = (reserva: ReservaEjecutable): AvisoPersonal =>
  (reserva.email ?? "").trim()
    ? { titulo: "Estado actualizado correctamente" }
    : { titulo: "Estado actualizado correctamente", descripcion: "Sin email: no se envía ningún correo al cliente." };

export const ACCIONES_EJECUTABLES: { readonly [K in IdAccionEjecutable]: DefinicionAccion<K> } = {
  // ─── Gestión ──────────────────────────────────────────────────────────────
  // «Aceptar» acepta la reserva TAL COMO ESTÁ AHORA, o sea lo que ve el personal (cambio acordado con el dueño,
  // 2026-10-01): escribe SOLO el estado. La hora no se toca y la sala tampoco (ni, por el trigger de la BD, las
  // mesas), salvo para RELLENAR la que falta con la pedida (Touza). Antes escribía la hora y la sala PEDIDAS: en
  // Casa Tomás (sin sala pedida) dejaba `espacio_id` en null, y el trigger borraba la sala y las mesas asignadas.
  // El correo no cambia: lo dispara el estado y el servidor relee la BD (si el personal editó la hora, ahora sale
  // el «Solicitado / Ofrecido» con la hora que de verdad se le da). Ver `espacioAlAceptar`.
  aceptar: {
    guarda: { vista: "lista", accion: "aceptar" },
    verbo: () => "guardar",
    cambios: (reserva) => ({
      ...espacioAlAceptar(reserva as ReservaParaVerificar),
      estado: ESTADO_VERIFICADA,
    }),
    avisaCliente: true,
    aviso: (reserva, _entrada, cambios) => avisoVerificada(reserva, cambios),
    traducirError: traducirErrorMigracion,
    motivoRechazo: soloDesde("aceptar", "pendiente"),
  },

  verificar: {
    guarda: { vista: "lista", accion: "verificar" },
    verbo: () => "guardar",
    cambios: (_reserva, { hora, espacio_id }) => ({ hora, espacio_id, estado: ESTADO_VERIFICADA }),
    avisaCliente: true,
    aviso: (reserva, _entrada, cambios) => avisoVerificada(reserva, cambios),
    traducirError: traducirErrorMigracion,
    motivoRechazo: soloDesde("verificar", "pendiente"),
  },

  confirmar: {
    guarda: { vista: "lista", accion: "confirmar" },
    verbo: () => "confirmar la reserva",
    cambios: () => ({ estado: ESTADO_CONFIRMADA }),
    avisaCliente: true,
    aviso: (reserva) => avisoEstadoActualizado(reserva),
    motivoRechazo: soloDesde("confirmar", "verificada"),
  },

  cancelar: {
    guarda: { vista: "lista", accion: "cancelar" },
    verbo: () => "cancelar la reserva",
    cambios: () => ({ estado: ESTADO_CANCELADA }),
    avisaCliente: true,
    aviso: (reserva) => avisoEstadoActualizado(reserva),
  },

  // «Rechazar» es cancelar desde el modal de una solicitud: pasa a 'cancelada' (no existe
  // un estado «rechazada») y el correo que sale es el de rechazo. Parte SOLO de una
  // PENDIENTE, igual que «Verificar» (el modal solo se abre con una pendiente): si otra
  // persona la aceptó entre tanto, al cliente ya le salió la «propuesta» y rechazarla ahora
  // mandaría «rechazada» justo después — dos correos contradictorios. Cancelar una reserva
  // ya verificada o confirmada es «Cancelar» de la lista, con su confirmación.
  rechazar: {
    guarda: { vista: "lista", accion: "verificar" },
    verbo: () => "rechazar la solicitud",
    cambios: () => ({ estado: ESTADO_CANCELADA }),
    avisaCliente: true,
    aviso: (reserva) => ({ titulo: "Solicitud rechazada", descripcion: avisoAlCliente({ email: reserva.email ?? null }) }),
    traducirError: traducirErrorMigracion,
    motivoRechazo: soloDesde("rechazar", "pendiente"),
  },

  // ─── Servicio ─────────────────────────────────────────────────────────────
  haLlegado: {
    guarda: { vista: "hoy", accion: "haLlegado" },
    verbo: () => "registrar la llegada",
    cambios: (_reserva, _entrada, { ahora }) => ({ estado: ESTADO_LLEGADA, llegada_at: ahora.toISOString() }),
    avisaCliente: false,
    recuerdaEstadoPrevio: true,
    desdeEstadoVisto: true,
    adoptaEstadoVivo: true,
    aviso: (reserva) => ({
      titulo: `${nombreOr(reserva, "Cliente")} ha llegado`,
      duracionMs: DURACION_CON_DESHACER_MS,
      deshacer: {
        cambios: { estado: reserva.estado, llegada_at: null },
        verbo: "deshacer la llegada",
        desde: [ESTADO_LLEGADA],
        olvidarEstadoPrevio: true,
      },
    }),
  },

  noVino: {
    guarda: { vista: "hoy", accion: "noVino" },
    verbo: () => "marcar «No vino»",
    cambios: () => ({ estado: ESTADO_NO_SHOW, llegada_at: null }),
    avisaCliente: false,
    recuerdaEstadoPrevio: true,
    desdeEstadoVisto: true,
    adoptaEstadoVivo: true,
    aviso: (reserva) => ({
      titulo: `${nombreOr(reserva, "Reserva")}: no vino`,
      duracionMs: DURACION_CON_DESHACER_MS,
      deshacer: {
        cambios: { estado: reserva.estado },
        verbo: "deshacer el «No vino»",
        desde: [ESTADO_NO_SHOW],
        olvidarEstadoPrevio: true,
      },
    }),
  },

  // El chip «Llegó» / «No vino» con su «Deshacer»: vuelve al estado que la reserva tenía
  // antes (si se sabe) y borra `llegada_at`. Sin aviso de «Deshacer»: no hay deshacer del deshacer.
  deshacer: {
    guarda: { vista: "hoy", accion: "deshacer" },
    verbo: (reserva) => (reserva.estado === ESTADO_NO_SHOW ? "quitar el «No vino»" : "deshacer la llegada"),
    cambios: (_reserva, _entrada, { estadoPrevio }) => ({
      estado: estadoPrevio ?? ESTADO_TRAS_DESHACER,
      llegada_at: null,
    }),
    avisaCliente: false,
    olvidaEstadoPrevio: true,
    desdeEstadoVisto: true,
    aviso: (_reserva, _entrada, cambios) => ({
      titulo: `Reserva devuelta a «${etiquetaEstadoReserva(cambios.estado)}»`,
    }),
    motivoRechazo: (reserva) => `No hay nada que deshacer: la reserva está «${etiquetaEstadoReserva(reserva.estado)}».`,
  },

  mover: {
    guarda: { vista: "hoy", accion: "mover" },
    verbo: () => "mover la reserva",
    cambios: (_reserva, { destinoId }) => ({ espacio_id: destinoId }),
    avisaCliente: false,
    aviso: (reserva, { nombreDestino }) => ({
      titulo: `${nombreOr(reserva, "Reserva")} → ${nombreDestino}`,
      duracionMs: DURACION_CON_DESHACER_MS,
      deshacer: {
        cambios: { espacio_id: reserva.espacio_id ?? null },
        verbo: "deshacer el movimiento",
        desde: estadosDePartida("mover"),
      },
    }),
    motivoRechazo: () => "Esta reserva no se puede mover.",
  },

  // ─── Las dos vistas ───────────────────────────────────────────────────────
  // La estrella vale en cualquier estado: no hay condición de partida.
  importante: {
    guarda: null,
    verbo: () => "actualizar la reserva",
    cambios: (reserva) => ({ importante: !reserva.importante }),
    avisaCliente: false,
    aviso: (_reserva, _entrada, cambios) => ({
      titulo: cambios.importante ? "Reserva marcada como importante" : "Reserva desmarcada",
    }),
  },
};

/**
 * Los estados desde los que se puede ejecutar `id`, o `null` si vale cualquiera. Sale de
 * `accionesDisponibles` (con permiso): la regla de qué botón se puede pulsar en cada
 * estado vive allí y solo allí.
 */
export function estadosDePartida(id: IdAccionEjecutable): readonly EstadoReserva[] | null {
  const guarda = ACCIONES_EJECUTABLES[id].guarda;
  if (!guarda) return null;
  const permitidos = ORDEN_ESTADOS.filter(
    (estado) => accionesDisponibles({ estado }, { vista: guarda.vista, canEdit: true })[guarda.accion].habilitada,
  );
  return permitidos.length === ORDEN_ESTADOS.length ? null : permitidos;
}

/**
 * Los estados en los que tiene que estar la reserva, EN LA BD, para que se escriba `id` (lo que
 * va en el `.in("estado", …)` del UPDATE). Es la regla de `estadosDePartida`, salvo en las
 * acciones `desdeEstadoVisto` (llegada, «No vino», deshacer): ahí es EXACTAMENTE el estado que
 * vio el personal en la tarjeta (llegada y «No vino», además, adoptan el estado de verdad si la
 * reserva sigue viva: ver `adoptaEstadoVivo`). `null`: vale cualquiera.
 */
export function desdeEstadosDeLaEscritura(id: IdAccionEjecutable, reserva: ReservaEjecutable): readonly string[] | null {
  return ACCIONES_EJECUTABLES[id].desdeEstadoVisto ? [reserva.estado] : estadosDePartida(id);
}

/**
 * Un solo shape y no una unión discriminada (`{ ok: true } | { ok: false; motivo }`): con
 * `strictNullChecks` apagado (tsconfig.app.json) el compilador de este proyecto no estrecha
 * por un booleano literal y `motivo` saldría como inexistente.
 */
export interface ResultadoGuarda {
  ok: boolean;
  /** Por qué no se puede, cuando `ok` es false. */
  motivo?: string;
}

/**
 * ¿Se puede ejecutar `id` sobre una reserva en ese estado? Es el MISMO criterio que
 * habilita el botón (`accionesDisponibles`), aplicado también dentro del ejecutor para
 * que una acción lanzada de otra manera (un «Deshacer», un atajo, otra pantalla) no se
 * salte la regla: no se cancela una reserva que ya llegó, no se mueve una cancelada…
 *
 * No mira el PERMISO: lo gobierna el botón (que sale deshabilitado) y, de verdad, la RLS.
 */
export function evaluarGuarda(id: IdAccionEjecutable, reserva: ReservaEjecutable): ResultadoGuarda {
  const def = ACCIONES_EJECUTABLES[id];
  if (!def.guarda) return { ok: true };

  const boton = accionesDisponibles(
    { estado: reserva.estado, nombre: reserva.nombre, importante: reserva.importante },
    { vista: def.guarda.vista, canEdit: true },
  )[def.guarda.accion];
  if (boton.habilitada) return { ok: true };

  return {
    ok: false,
    motivo:
      def.motivoRechazo?.(reserva) ??
      (boton.titulo || `No se puede ${def.verbo(reserva)}: la reserva está «${etiquetaEstadoReserva(reserva.estado)}».`),
  };
}
