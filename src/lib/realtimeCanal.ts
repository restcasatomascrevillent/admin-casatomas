import type { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";

// ============================================================================
// CANALES REALTIME: nombre único, vigilancia, invalidación diferida y sondeo.
// ----------------------------------------------------------------------------
// Módulo sin React ni Supabase (solo tipos). Lo usan los hooks que escuchan
// `postgres_changes`: campana, solicitudes, «Hoy»/Calendario
// (`useReservasEnVivo`), Lista (`useListaReservasEnVivo`), rejilla de salas,
// modo servicio y Asignación.
//
// NOMBRE ÚNICO POR SUSCRIPCIÓN. realtime-js (2.81) devuelve el MISMO canal si
// ya hay uno ABIERTO con ese nombre. Con dos instancias del mismo hook a la vez
// (las dos campanas del Dashboard en móvil) la segunda añadía su `.on()` a un
// canal ya suscrito: el servidor no conoce esa escucha, el canal se cierra con
// «mismatch between server and client bindings for postgres changes» y el
// primer desmontaje lo cerraba para las dos. `nombreCanalUnico` (un contador,
// llamado dentro del efecto) los separa. Al desmontar no hay carrera:
// `removeChannel` saca el canal de la lista y emite CLOSED de forma SÍNCRONA
// (`unsubscribe()` pone el canal en «leaving» antes de mirar si puede enviar),
// así que el mismo nombre justo después ya da un canal nuevo. Un contador y no
// `crypto.randomUUID()`: este solo existe en contextos seguros (HTTPS o
// localhost) y el panel a veces se abre por la IP de la red local.
//
// VIGILANCIA. Sin callback en `.subscribe()` un canal que no llega a suscribirse
// o que se cae no da ninguna señal. Y una tabla que NO está en la publicación
// `supabase_realtime` tampoco: el canal se une (SUBSCRIBED) y el servidor solo
// lo dice con un mensaje `system` («Unable to subscribe to changes with given
// parameters…», que reintenta cada 5-10 s), que realtime-js no pasa al callback
// de `.subscribe()`. Por eso hay que escuchar también `system`:
//
//   const nombre = nombreCanalUnico("prefijo");
//   const vigilancia = vigilarCanal(nombre, { tabla: "reservas", alSuscribirse: (vez) => … });
//   const canal = supabase.channel(nombre)
//     .on("system", {}, vigilancia.alMensajeSistema)
//     .on("postgres_changes", { … table: "reservas" … }, …)
//     .subscribe(vigilancia.alCambiarEstado);
//   return () => { vigilancia.cerrar(); supabase.removeChannel(canal); };   // ESE orden
//
//   · SUBSCRIBED -> `alSuscribirse(vez)`: vez 1 al suscribirse y 2, 3… cada vez
//     que realtime-js recupera el canal tras una caída (red, tablet dormida).
//     Realtime NO reenvía lo que pasó mientras estaba caído: quien lo necesite
//     relee ahí.
//   · CHANNEL_ERROR, TIMED_OUT, CLOSED o un `system` con status "error" -> UN
//     console.warn con el prefijo `[realtime]` por TABLA y sesión (cada pestaña,
//     día o formulario abre su canal; sin migración serían decenas de avisos
//     iguales). El CLOSED que provoca nuestro propio `removeChannel` no avisa:
//     `cerrar()` va ANTES (el CLOSED es síncrono, ver arriba).
//
// OJO, UNA TABLA SIN PUBLICAR TUMBA EL CANAL ENTERO: el servidor da de alta las
// escuchas `postgres_changes` de un canal en UNA transacción y, si una tabla no
// está publicada, deshace todas. Por eso cada tabla va en su canal (ver
// `useReservasPorAsignar`): si una deja de estar publicada, las demás siguen.
//
// INVALIDACIÓN DIFERIDA (`crearInvalidacionDiferida`): cada evento reinicia una
// espera de 1 s y se refresca una vez al acabar la ráfaga, pero como mucho 5 s
// después del primer evento sin refrescar. 20 cambios seguidos = 1 relectura; la
// carga de la demo (861 altas en un minuto) = una cada 5 s, no 861 (en
// Asignación, cada invalidación aborta y relanza la lectura por lotes).
//
// SONDEO (`programarSondeo`) y `REFRESCO_PERIODICO`: el respaldo mientras no hay
// realtime (o si se cae), solo con la pestaña a la vista.
// ============================================================================

/** Estados que realtime-js pasa al callback de `.subscribe()` (`REALTIME_SUBSCRIBE_STATES`). */
export type EstadoCanalRealtime = `${REALTIME_SUBSCRIBE_STATES}`;

/** Prefijo de los avisos por consola, para filtrarlos en las herramientas del navegador. */
export const PREFIJO_AVISO_REALTIME = "[realtime]";

let secuenciaCanales = 0;

/** Nombre de canal distinto en cada llamada (`prefijo-N`). Llamarlo dentro del efecto que se suscribe. */
export function nombreCanalUnico(prefijo: string): string {
  secuenciaCanales += 1;
  return `${prefijo}-${secuenciaCanales}`;
}

/** Tablas de las que ya se ha avisado en esta sesión (una vez por tabla, no por canal). */
const tablasAvisadas = new Set<string>();

/** Solo para tests: olvida de qué tablas se ha avisado ya. */
export function olvidarAvisosRealtime(): void {
  tablasAvisadas.clear();
}

export interface OpcionesVigilancia {
  /** La tabla que escucha el canal (una por canal): se avisa una vez por tabla y sesión. */
  tabla?: string;
  /** Cada SUBSCRIBED. `vez` = 1 la primera; 2, 3… cuando el canal se recupera de una caída. */
  alSuscribirse?: (vez: number) => void;
}

export interface VigilanciaCanal {
  /** Para `.subscribe(…)`. */
  alCambiarEstado: (estado: EstadoCanalRealtime, error?: Error) => void;
  /** Para `.on("system", {}, …)`: avisa si el servidor no puede dar de alta las escuchas. */
  alMensajeSistema: (mensaje: unknown) => void;
  /** Llamar justo ANTES de `removeChannel`: desde aquí no se avisa ni se relee nada. */
  cerrar: () => void;
}

export function vigilarCanal(nombre: string, opciones: OpcionesVigilancia = {}): VigilanciaCanal {
  const { tabla } = opciones;
  let suscripciones = 0;
  let avisado = false;
  let cerrado = false;

  const avisar = (motivo: string, detalle?: unknown) => {
    if (avisado || cerrado) return;
    avisado = true;
    if (tabla !== undefined) {
      if (tablasAvisadas.has(tabla)) return;
      tablasAvisadas.add(tabla);
    }
    const queTabla = tabla === undefined ? "" : ` (tabla ${tabla})`;
    const texto =
      `${PREFIJO_AVISO_REALTIME} El canal «${nombre}»${queTabla} no está recibiendo cambios en vivo (${motivo}). ` +
      "Lo que cambie desde otro dispositivo no aparecerá solo hasta recargar o hasta el siguiente refresco periódico." +
      (tabla === undefined ? "" : " No se volverá a avisar de esta tabla en esta sesión.");
    if (detalle === undefined) console.warn(texto);
    else console.warn(texto, detalle);
  };

  return {
    alCambiarEstado: (estado, error) => {
      if (cerrado) return;
      if (estado === "SUBSCRIBED") {
        suscripciones += 1;
        opciones.alSuscribirse?.(suscripciones);
        return;
      }
      avisar(estado, error);
    },
    alMensajeSistema: (mensaje) => {
      const sistema = (mensaje ?? null) as { status?: unknown; message?: unknown; extension?: unknown } | null;
      if (sistema?.status !== "error") return;
      avisar(`error del servidor${sistema.extension ? ` en ${String(sistema.extension)}` : ""}`, sistema.message);
    },
    cerrar: () => {
      cerrado = true;
    },
  };
}

/** Espera tras el ÚLTIMO evento de una ráfaga antes de refrescar. */
export const ESPERA_INVALIDACION_MS = 1_000;
/** Tope: con eventos seguidos se refresca como mucho cada tanto, aunque la ráfaga no pare. */
export const ESPERA_MAXIMA_INVALIDACION_MS = 5_000;

export interface InvalidacionDiferida {
  /** Ha llegado un evento: refrescar 1 s después del último, y como mucho 5 s después del primero pendiente. */
  programar: () => void;
  /** Al desmontar: lo pendiente ya no se ejecuta. */
  cancelar: () => void;
}

export function crearInvalidacionDiferida(
  accion: () => void,
  opciones: { espera?: number; esperaMaxima?: number } = {},
): InvalidacionDiferida {
  const espera = opciones.espera ?? ESPERA_INVALIDACION_MS;
  const esperaMaxima = opciones.esperaMaxima ?? ESPERA_MAXIMA_INVALIDACION_MS;
  let cola: ReturnType<typeof setTimeout> | undefined; // 1 s tras el último evento
  let tope: ReturnType<typeof setTimeout> | undefined; // 5 s tras el primero sin refrescar

  const cancelar = () => {
    if (cola !== undefined) clearTimeout(cola);
    if (tope !== undefined) clearTimeout(tope);
    cola = undefined;
    tope = undefined;
  };
  const ejecutar = () => {
    cancelar();
    accion();
  };

  return {
    programar: () => {
      if (cola !== undefined) clearTimeout(cola);
      cola = setTimeout(ejecutar, espera);
      if (tope === undefined) tope = setTimeout(ejecutar, esperaMaxima);
    },
    cancelar,
  };
}

/** Cada cuánto se relee lo que no llega por realtime (el respaldo). */
export const INTERVALO_SONDEO_MS = 60_000;

/**
 * Respaldo sin realtime para las consultas de TanStack Query (Hoy, Calendario, modo servicio,
 * Asignación): se releen cada minuto mientras la pestaña está a la vista; con la pestaña oculta,
 * nada. TanStack Query no lanza la relectura del intervalo si ya hay una en curso: reutiliza esa.
 */
export const REFRESCO_PERIODICO = { refetchInterval: INTERVALO_SONDEO_MS, refetchIntervalInBackground: false } as const;

/**
 * Sondeo para lo que no es de TanStack Query (campana, solicitudes): llama a `alTocar` cada
 * `intervalo` ms solo con la pestaña a la vista. Devuelve la función que lo para (al desmontar).
 */
export function programarSondeo(alTocar: () => void, intervalo: number = INTERVALO_SONDEO_MS): () => void {
  const id = setInterval(() => {
    // Pestaña oculta (otra delante, tablet bloqueada): no se pide nada.
    if (globalThis.document?.visibilityState !== "visible") return;
    alTocar();
  }, intervalo);
  return () => clearInterval(id);
}
