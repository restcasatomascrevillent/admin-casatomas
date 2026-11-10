// ============================================================================
// EL EJECUTOR DE ACCIONES SOBRE UNA RESERVA
// ----------------------------------------------------------------------------
// Un único sitio por el que pasa TODO lo que cambia una reserva desde los botones del
// panel:
//   · gestión (Lista y modal «Verificar solicitud»): aceptar, verificar, confirmar,
//     cancelar, rechazar y aceptar en bloque;
//   · servicio (Hoy y modo servicio): «Ha llegado», «No vino», deshacer y mover de sala;
//   · las dos vistas: la estrella («importante»).
// (El cambio de sala del panel «Asignación», `useCambiarSalaReserva`, comparte la misma
// escritura y la misma lista de claves, pero es una mutación de React Query.)
//
// Antes cada pantalla tenía el suyo —`updateReservationStatus` de la lista, las funciones
// de `useVerificacionReservas`, el `toggleImportante` (DOS copias), el `ejecutar` de
// este hook, `useCambiarSalaReserva`— y cada uno escribía, avisaba y refrescaba a su
// manera: cinco escritores no pedían la fila de vuelta (una escritura denegada por RLS
// pasaba por hecha, y en las que avisan al cliente el correo salía igualmente), tres
// formas de llamar a `notify-reservation-change` sin mirar la respuesta, cinco listas de
// claves distintas y un «Deshacer» del chip que siempre volvía a «Confirmada».
//
// QUÉ HACE CADA ACCIÓN está declarado en `src/lib/reservas/accionesEjecutables.ts`
// (columnas, si avisa al cliente, aviso al personal, estado de partida). Este hook solo
// lo EJECUTA, siempre igual:
//
//   1. GUARDA. El estado de partida lo decide `accionesDisponibles` (la función que
//      habilita el botón): no se cancela una reserva que ya llegó ni se da «Ha llegado» a
//      una cancelada. Si no toca, no se escribe nada ni se refresca nada.
//   2. UPDATE OPTIMISTA sobre TODAS las listas de reservas cacheadas por React Query
//      (kanban, «Reservas de hoy», lista completa), con rollback si falla.
//   3. ESCRITURA (`escribirReserva`): pide la fila de vuelta y va CONDICIONADA al estado de
//      partida, así que una denegación por RLS, una reserva que ya no existe o que otra
//      persona cambió antes dan un aviso claro en vez de un falso «hecho» (y si no toca
//      nada, relee el estado para decir cuál es de verdad). «Ha llegado», «No vino» y el
//      chip «Deshacer» escriben condicionados al estado que vio el personal: la tarjeta puede
//      estar desfasada y el estado previo que se recuerda para deshacer tiene que ser verdad.
//      Si la reserva ya no está así pero SIGUE VIVA (la tarjeta decía «Verificada» y el cliente
//      ya había confirmado), «Ha llegado» y «No vino» reintentan UNA vez desde el estado leído,
//      sin error (un falso error en plena hora de servicio es peor que el problema que evita).
//   4. REFRESCO de UNA lista única de claves por tipo de cambio (`clavesCache.ts`), aunque
//      falle (está en el `finally`).
//   5. AVISO al personal y, solo en aceptar / verificar / confirmar / cancelar / rechazar,
//      el correo al cliente (`notificarCliente.ts`): una sola forma de llamarlo, con la
//      respuesta comprobada. Si el correo no sale, el aviso lo dice SIN deshacer lo
//      guardado. Llegada, «No vino», deshacer, mover y la estrella NO avisan al cliente.
//
// · `llegada_at` es opcional: si la migración 20260923_reservas_llegada.sql no está
//   aplicada, el primer UPDATE falla con «columna inexistente», se recuerda y se reintenta
//   sin ella (ver `escribirReserva.ts`).
// · El «Deshacer» del chip vuelve al estado que la reserva tenía ANTES de llegar / no venir
//   (`estadoPrevio.ts`); si no se sabe, a «Confirmada».
// ============================================================================

import { useCallback, useState } from "react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ACCIONES_EJECUTABLES,
  desdeEstadosDeLaEscritura,
  evaluarGuarda,
  type AvisoPersonal,
  type DefinicionAccion,
  type Deshacer,
  type EntradasAccion,
  type IdAccionEjecutable,
  type ReservaEjecutable,
} from "@/lib/reservas/accionesEjecutables";
import { CLAVES_LISTAS_RESERVAS, clavesAInvalidar } from "@/lib/reservas/clavesCache";
import {
  ErrorSinFilasReserva,
  __resetColumnaLlegadaParaTests,
  escribirReserva,
  type CambiosReserva,
} from "@/lib/reservas/escribirReserva";
import type { EnvioCorreoEdicion } from "@/lib/reservas/edicionReserva";
import { ESTADO_LLEGADA, ESTADO_VERIFICADA, esEstadoVivo, etiquetaEstadoReserva } from "@/lib/reservas/estadosReserva";
import {
  MENSAJE_FUERA_SIN_MIGRACION,
  cambiosQuitarFuera,
  cambiosSentarFuera,
  esErrorColumnasFueraInexistentes,
  estaSentadaFuera,
  etiquetaFuera,
  problemaDatosFuera,
  puedeSentarseFuera,
  type DatosFuera,
} from "@/lib/reservas/sentarFuera";
import { estadoPrevioDe, olvidarEstadoPrevio, recordarEstadoPrevio } from "@/lib/reservas/estadoPrevio";
import {
  notificarAlCliente,
  notificarYAvisarSiFalla,
  seReintentaSolo,
  textoProblemaEnvio,
} from "@/lib/reservas/notificarCliente";
import { aplicarCambioReserva, mensajeErrorServicio, type ReservaServicio } from "@/lib/reservas/servicioSala";
import type { CambiosVerificacion, ReservaParaVerificar } from "@/lib/reservas/verificacion";

// Antes se declaraban aquí; siguen saliendo de este módulo para quien ya las importaba.
export { CLAVES_LISTAS_RESERVAS, ErrorSinFilasReserva, __resetColumnaLlegadaParaTests };

/** El texto en singular si `n` es 1 y en plural si no (para los avisos de las acciones en bloque). */
const uno = (n: number, singular: string, plural: string) => (n === 1 ? singular : plural);

/** Refresca lo cacheado que depende de una reserva cuando se escribe `cambios`. */
function refrescar(queryClient: QueryClient, cambios: object) {
  for (const clave of clavesAInvalidar(cambios)) {
    queryClient.invalidateQueries({ queryKey: [clave] });
  }
}

interface OpcionesEscritura {
  /** «No se pudo {verbo}: …» si falla. */
  verbo: string;
  /** Estados en los que la reserva tiene que estar ahora, en la BD (`null`: cualquiera). */
  desdeEstados?: readonly string[] | null;
  /** Parchear las listas en local antes de escribir, y deshacer el parche si falla. Por defecto, sí. */
  optimista?: boolean;
  /** Volver a pedir lo cacheado al terminar. Por defecto, sí. */
  refrescar?: boolean;
  /** No avisar del error en pantalla (las acciones en bloque cuentan sus fallos). */
  silencioso?: boolean;
  /** Mensaje de error propio; `null`: el de siempre. */
  traducirError?: (error: unknown) => string | null;
  /**
   * Si la escritura condicionada no toca nada porque la reserva cambió a OTRO estado vivo, reintentar UNA vez
   * condicionada a ese estado (y devolverlo en `estadoReal`) en vez de dar error. Ver `adoptaEstadoVivo`.
   */
  reintentarDesdeEstadoVivo?: boolean;
}

interface OpcionesEjecucion {
  /**
   * La acción va dentro de una acción en bloque: sin avisos sueltos, sin parche en local
   * (varios snapshots a la vez se pisarían al deshacer) y sin refresco propio —lo hace
   * quien llama UNA vez al final—, y el correo no avisa por su cuenta si falla.
   */
  enBloque?: boolean;
  /** Segundo botón del aviso de éxito (p. ej. «Cambiar mesa» tras «Llegó», 07/11/2026). */
  accionAviso?: AccionAviso;
}

/** Un botón extra en el aviso de éxito de una acción. */
export interface AccionAviso {
  label: string;
  onClick: () => void;
}

/** Lo que devuelve una escritura: si se guardó y, si no, por qué. Un solo shape (ver `ResultadoGuarda`). */
interface ResultadoEscritura {
  ok: boolean;
  error?: unknown;
  /** Solo si hubo que reintentar desde otro estado vivo: el estado que tenía la reserva DE VERDAD. */
  estadoReal?: string;
}

/** Lo que devuelve `aceptarVarias`: lo verificado, lo que ya había cambiado de estado y lo que falló de verdad. */
export interface ResultadoAceptarVarias {
  ok: Map<string, CambiosVerificacion>;
  /** No se pudieron guardar (error de la BD, RLS…): reintentar tiene sentido. */
  fallidas: string[];
  /** Ya no estaban pendientes (otra persona, o el cliente desde su correo): no se ha tocado nada y reintentar fallaría igual. */
  yaCambiadas: string[];
}

export interface ResultadoAccion {
  ok: boolean;
  /** Las columnas que se han escrito (solo si `ok`). */
  cambios?: CambiosReserva;
  /**
   * Solo si `!ok`: la reserva ya no estaba en un estado desde el que se pueda hacer esto (lo vio la guarda
   * en local, o la escritura condicionada no tocó nada porque otra persona la cambió antes). No es un fallo
   * que se arregle reintentando.
   */
  cambioDeEstado?: boolean;
  /**
   * Solo si la acción avisa al cliente y se ha guardado: el envío, que se resuelve cuando
   * contesta el servidor. La pantalla NO lo espera (el correo no retrasa el «hecho»); quien
   * quiera saber cómo acabó, sí (los tests).
   */
  correo?: Promise<EnvioCorreoEdicion>;
}

export function useAccionesServicioReserva() {
  const queryClient = useQueryClient();
  const [enCurso, setEnCurso] = useState<Set<string>>(new Set());

  const marcar = useCallback(
    (id: string, activo: boolean) =>
      setEnCurso((prev) => {
        const next = new Set(prev);
        if (activo) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );

  /**
   * Escribe `cambios` en BD con update optimista en las listas (rollback exacto si falla),
   * avisa del error y refresca lo cacheado. Devuelve si se ha guardado.
   */
  const escribir = useCallback(
    async (
      id: string,
      cambios: CambiosReserva,
      {
        verbo,
        desdeEstados,
        optimista = true,
        refrescar: refrescarAlTerminar = true,
        silencioso = false,
        traducirError,
        reintentarDesdeEstadoVivo = false,
      }: OpcionesEscritura,
    ): Promise<ResultadoEscritura> => {
      marcar(id, true);
      const snapshots: [QueryKey, unknown][] = [];
      if (optimista) {
        for (const clave of CLAVES_LISTAS_RESERVAS) {
          await queryClient.cancelQueries({ queryKey: [clave] });
          snapshots.push(...queryClient.getQueriesData({ queryKey: [clave] }));
          queryClient.setQueriesData({ queryKey: [clave] }, (old: unknown) =>
            Array.isArray(old) ? aplicarCambioReserva(old as { id: string }[], id, cambios as never) : old,
          );
        }
      }

      try {
        let estadoReal: string | undefined;
        try {
          await escribirReserva(id, cambios, { desdeEstados });
        } catch (error) {
          // La tarjeta iba desfasada pero la reserva SIGUE VIVA (p. ej. decía «Verificada» y el cliente ya había
          // confirmado desde el enlace): no es un error. Se reintenta UNA vez desde el estado leído, que es el
          // estado previo verdadero para el «Deshacer». Un segundo fallo sí es un error (sale del `catch` de abajo).
          const vivo =
            reintentarDesdeEstadoVivo &&
            error instanceof ErrorSinFilasReserva &&
            error.motivo === "estado_cambiado" &&
            esEstadoVivo(error.estadoActual)
              ? error.estadoActual
              : undefined;
          if (!vivo) throw error;
          estadoReal = vivo;
          await escribirReserva(id, cambios, { desdeEstados: [vivo] });
        }
        return { ok: true, estadoReal };
      } catch (error) {
        for (const [key, data] of snapshots) queryClient.setQueryData(key, data);
        console.error(`[servicio-reserva] Error al ${verbo}:`, error);
        if (!silencioso) toast.error(traducirError?.(error) ?? mensajeErrorServicio(error, verbo));
        return { ok: false, error };
      } finally {
        marcar(id, false);
        if (refrescarAlTerminar) refrescar(queryClient, cambios);
      }
    },
    [queryClient, marcar],
  );

  /** El «Deshacer» de un aviso: la escritura inversa, condicionada a que la reserva siga como la dejó la acción. */
  const deshacerDeAviso = useCallback(
    async (id: string, deshacer: Deshacer) => {
      const { ok } = await escribir(id, deshacer.cambios, { verbo: deshacer.verbo, desdeEstados: deshacer.desde });
      if (ok && deshacer.olvidarEstadoPrevio) olvidarEstadoPrevio(id);
      return ok;
    },
    [escribir],
  );

  /** Enseña el aviso de éxito al personal; con «Deshacer» si la acción lo declara. */
  const mostrarAviso = useCallback(
    (aviso: AvisoPersonal | null, id: string, extra?: AccionAviso) => {
      if (!aviso) return;
      const opciones: {
        description?: string;
        duration?: number;
        action?: { label: string; onClick: () => void };
        cancel?: { label: string; onClick: () => void };
      } = {};
      // Sonner pinta `cancel` como un segundo botón junto a «Deshacer».
      if (extra) opciones.cancel = extra;
      if (aviso.descripcion) opciones.description = aviso.descripcion;
      if (aviso.duracionMs) opciones.duration = aviso.duracionMs;
      if (aviso.deshacer) {
        const deshacer = aviso.deshacer;
        opciones.action = {
          label: "Deshacer",
          onClick: () => {
            void deshacerDeAviso(id, deshacer);
          },
        };
      }
      if (Object.keys(opciones).length === 0) toast.success(aviso.titulo);
      else toast.success(aviso.titulo, opciones);
    },
    [deshacerDeAviso],
  );

  /** Ejecuta la acción `id` sobre `reserva`: guarda, escribe, refresca, avisa al personal y, si toca, al cliente. */
  const ejecutarAccion = useCallback(
    async <K extends IdAccionEjecutable>(
      id: K,
      reserva: ReservaEjecutable,
      entrada?: EntradasAccion[K],
      { enBloque = false, accionAviso }: OpcionesEjecucion = {},
    ): Promise<ResultadoAccion> => {
      const def = ACCIONES_EJECUTABLES[id] as unknown as DefinicionAccion<K>;

      // 1. Guarda: el estado de partida lo decide `accionesDisponibles`.
      const guarda = evaluarGuarda(id, reserva);
      if (!guarda.ok) {
        if (!enBloque) toast.error(guarda.motivo);
        return { ok: false, cambioDeEstado: true };
      }

      // 2-4. Escribir (con parche en local, condicionado al estado de partida) y refrescar. Llegada, «No
      // vino» y deshacer exigen el estado EXACTO que vio el personal; el resto, el conjunto de la regla.
      const cambios = def.cambios(reserva, entrada as EntradasAccion[K], {
        ahora: new Date(),
        estadoPrevio: estadoPrevioDe(reserva.id),
      });
      const escrito = await escribir(reserva.id, cambios, {
        verbo: def.verbo(reserva),
        desdeEstados: desdeEstadosDeLaEscritura(id, reserva),
        optimista: !enBloque,
        refrescar: !enBloque,
        silencioso: enBloque,
        traducirError: def.traducirError,
        reintentarDesdeEstadoVivo: def.adoptaEstadoVivo,
      });
      if (!escrito.ok) {
        const cambioDeEstado = escrito.error instanceof ErrorSinFilasReserva && escrito.error.motivo === "estado_cambiado";
        return cambioDeEstado ? { ok: false, cambioDeEstado: true } : { ok: false };
      }

      // 5. Lo que queda apuntado para el «Deshacer» del chip, el aviso y el correo. Si hubo que reintentar desde
      // otro estado vivo, la reserva «de verdad» es la que tenía ESE estado: es el que se recuerda y el que
      // restaura el «Deshacer» del aviso.
      const vista = escrito.estadoReal ? { ...reserva, estado: escrito.estadoReal } : reserva;
      if (def.recuerdaEstadoPrevio) recordarEstadoPrevio(reserva.id, vista.estado);
      if (def.olvidaEstadoPrevio) olvidarEstadoPrevio(reserva.id);
      if (!enBloque) mostrarAviso(def.aviso(vista, entrada as EntradasAccion[K], cambios), reserva.id, accionAviso);

      const correo = def.avisaCliente
        ? enBloque
          ? notificarAlCliente(reserva.id, cambios)
          : notificarYAvisarSiFalla(reserva.id, cambios, { nombre: reserva.nombre })
        : undefined;
      return { ok: true, cambios, correo };
    },
    [escribir, mostrarAviso],
  );

  // ─── Servicio (Hoy, modo servicio) ─────────────────────────────────────────

  const moverEspacio = useCallback(
    async (reserva: ReservaServicio, destinoId: string | null, nombreDestino: string) =>
      (await ejecutarAccion("mover", reserva, { destinoId, nombreDestino })).ok,
    [ejecutarAccion],
  );

  const marcarLlegada = useCallback(
    async (reserva: ReservaServicio, opciones?: { accionAviso?: AccionAviso }) =>
      (await ejecutarAccion("haLlegado", reserva, undefined, { accionAviso: opciones?.accionAviso })).ok,
    [ejecutarAccion],
  );

  /** Deshacer «Llegó» o «No vino» más tarde: vuelve al estado que tenía antes (o a «Confirmada» si no se sabe). */
  const deshacerLlegadaONoShow = useCallback(
    async (reserva: ReservaServicio) => (await ejecutarAccion("deshacer", reserva)).ok,
    [ejecutarAccion],
  );

  const marcarNoShow = useCallback(
    async (reserva: ReservaServicio) => (await ejecutarAccion("noVino", reserva)).ok,
    [ejecutarAccion],
  );

  // ─── «Sentar fuera» (10/11/2026) ────────────────────────────────────────────
  // Fuera de las salas del plano (Touza, Terraza Touza…): es SENTAR («Llegó») sin sala ni mesas. La regla de la
  // BD (trigger `trg_reservas_sentada_fuera`) quita la sala y las mesas y las devuelve al deshacer; aquí se
  // escribe como «Ha llegado»: condicionado al estado que vio el personal (adoptando el de verdad si sigue viva)
  // y con «Deshacer» en el aviso. Ver `src/lib/reservas/sentarFuera.ts`.

  const traducirErrorFuera = (error: unknown) => (esErrorColumnasFueraInexistentes(error) ? MENSAJE_FUERA_SIN_MIGRACION : null);

  /** Sentar fuera (o cambiar el sitio de una que ya está fuera). Devuelve si se ha guardado. */
  const sentarFuera = useCallback(
    async (reserva: ReservaServicio & { salida_at?: string | null }, datos: DatosFuera) => {
      const problema = problemaDatosFuera(datos);
      if (problema) {
        toast.error(problema);
        return false;
      }
      if (!puedeSentarseFuera(reserva)) {
        toast.error(`No se puede sentar fuera una reserva «${etiquetaEstadoReserva(reserva.estado)}».`);
        return false;
      }
      const yaFuera = estaSentadaFuera(reserva);
      const yaSentada = reserva.estado === ESTADO_LLEGADA;
      const cambios = cambiosSentarFuera(reserva, datos, new Date());
      const escrito = await escribir(reserva.id, cambios, {
        verbo: yaFuera ? "cambiar el sitio de fuera" : "sentar fuera",
        desdeEstados: [reserva.estado],
        reintentarDesdeEstadoVivo: !yaSentada,
        traducirError: traducirErrorFuera,
      });
      if (!escrito.ok) return false;

      const previo = escrito.estadoReal ?? reserva.estado;
      if (previo !== ESTADO_LLEGADA) recordarEstadoPrevio(reserva.id, previo);
      // El «Deshacer» del aviso: lo que había justo antes.
      const deshacer: Deshacer = yaFuera
        ? {
            cambios: { fuera_lugar: reserva.fuera_lugar ?? null, fuera_mesa: reserva.fuera_mesa ?? null },
            verbo: "volver al sitio de antes",
            desde: [ESTADO_LLEGADA],
          }
        : yaSentada
          ? { cambios: cambiosQuitarFuera({ fuera_espacio_previo_id: reserva.espacio_id }), verbo: "volver a sentarla dentro", desde: [ESTADO_LLEGADA] }
          : {
              cambios: { estado: previo, llegada_at: null, ...cambiosQuitarFuera({ fuera_espacio_previo_id: reserva.espacio_id }) },
              verbo: "deshacer «Sentar fuera»",
              desde: [ESTADO_LLEGADA],
              olvidarEstadoPrevio: true,
            };
      const etiqueta = etiquetaFuera({ estado: ESTADO_LLEGADA, fuera_lugar: cambios.fuera_lugar, fuera_mesa: cambios.fuera_mesa });
      mostrarAviso(
        {
          titulo: `${reserva.nombre || "Reserva"}: ${etiqueta}`,
          descripcion: yaFuera ? undefined : "No cuenta en ninguna sala ni ocupa mesa.",
          duracionMs: 10_000,
          deshacer,
        },
        reserva.id,
      );
      return true;
    },
    [escribir, mostrarAviso],
  );

  /**
   * «Sentar dentro»: deja de estar fuera y sigue «Llegó», de vuelta en su sala y SIN mesa (se le da desde la
   * ficha o el plano). Para que no haya llegado, el «Deshacer» de siempre.
   */
  const quitarFuera = useCallback(
    async (reserva: ReservaServicio) => {
      if (!estaSentadaFuera(reserva)) return true;
      const escrito = await escribir(reserva.id, cambiosQuitarFuera(reserva), {
        verbo: "sentarla dentro",
        desdeEstados: [ESTADO_LLEGADA],
        traducirError: traducirErrorFuera,
      });
      if (!escrito.ok) return false;
      mostrarAviso(
        {
          titulo: `${reserva.nombre || "Reserva"} vuelve dentro`,
          descripcion: "Sigue «Llegó», sin mesa: dale mesa desde su ficha o el plano.",
          duracionMs: 10_000,
          deshacer: {
            cambios: { fuera_lugar: reserva.fuera_lugar ?? null, fuera_mesa: reserva.fuera_mesa ?? null, espacio_id: null },
            verbo: "volver a sentarla fuera",
            desde: [ESTADO_LLEGADA],
          },
        },
        reserva.id,
      );
      return true;
    },
    [escribir, mostrarAviso],
  );

  // ─── Gestión (Lista y modal «Verificar solicitud») ─────────────────────────

  /**
   * Un clic: verifica la reserva TAL COMO ESTÁ AHORA (lo que ve el personal): no cambia la hora ni la sala
   * (ni, por el trigger de la BD, las mesas). La sala solo se rellena si falta y el cliente pidió una
   * (Touza). Cambio acordado con el dueño, 2026-10-01; ver `espacioAlAceptar`.
   */
  const aceptar = useCallback(
    (reserva: ReservaParaVerificar) => ejecutarAccion("aceptar", reserva),
    [ejecutarAccion],
  );

  /**
   * Verifica la reserva con la hora que se le da al cliente y la sala que se le asigna por
   * dentro. Es el ÚNICO camino de guardado del modal: dé o no dé la hora que pidió, la
   * respuesta del restaurante es una sola.
   */
  const verificar = useCallback(
    (reserva: ReservaParaVerificar, decidido: { hora: string; espacio_id: string | null }) =>
      ejecutarAccion("verificar", reserva, decidido),
    [ejecutarAccion],
  );

  /** Rechaza la solicitud/reserva: pasa a 'cancelada' y dispara el correo de rechazo. */
  const rechazar = useCallback(
    (reserva: ReservaParaVerificar) => ejecutarAccion("rechazar", reserva),
    [ejecutarAccion],
  );

  /** «Confirmar» una reserva verificada (el botón principal de la Lista). */
  const confirmar = useCallback(
    (reserva: ReservaEjecutable) => ejecutarAccion("confirmar", reserva),
    [ejecutarAccion],
  );

  /** Cancela de verdad: solo se llega aquí desde el «sí» del diálogo de confirmación de la Lista. */
  const cancelar = useCallback(
    (reserva: ReservaEjecutable) => ejecutarAccion("cancelar", reserva),
    [ejecutarAccion],
  );

  /**
   * Acción en bloque: aceptar varias solicitudes tal cual, con un único aviso de resumen, un
   * único refresco y, si algún correo no sale, un único aviso de cuántos. Cuenta por separado
   * lo que se ha verificado, lo que YA HABÍA CAMBIADO de estado (no se toca y reintentar
   * fallaría igual) y lo que ha fallado de verdad (ahí sí: «inténtalo otra vez»).
   */
  const aceptarVarias = useCallback(
    async (reservas: ReservaParaVerificar[]): Promise<ResultadoAceptarVarias> => {
      const resultados = await Promise.all(
        reservas.map(async (reserva) => ({ reserva, ...(await ejecutarAccion("aceptar", reserva, undefined, { enBloque: true })) })),
      );

      const ok = new Map<string, CambiosVerificacion>();
      const fallidas: string[] = [];
      const yaCambiadas: string[] = [];
      for (const r of resultados) {
        if (r.ok && r.cambios) ok.set(r.reserva.id, r.cambios as CambiosVerificacion);
        else if (r.cambioDeEstado) yaCambiadas.push(r.reserva.id);
        else fallidas.push(r.reserva.id);
      }

      // Cada escritura del bloque salió SIN refresco propio: se hace una vez para todas.
      if (reservas.length > 0) refrescar(queryClient, { estado: ESTADO_VERIFICADA });

      if (ok.size > 0) {
        // Mismo criterio que el aviso individual: lo que hay que contarle es a quién NO se
        // le puede mandar el correo, que es a quien habrá que llamar.
        const sinCorreo = reservas.filter((r) => ok.has(r.id) && !(r.email ?? "").trim()).length;
        toast.success(`${ok.size} solicitud${ok.size === 1 ? "" : "es"} verificada${ok.size === 1 ? "" : "s"}`, {
          description:
            sinCorreo === 0 ? "Se les manda el correo a todos" : `${sinCorreo} sin correo: hay que avisarles por teléfono`,
        });
      }
      if (yaCambiadas.length > 0) {
        const n = yaCambiadas.length;
        toast.info(`${n} solicitud${n === 1 ? "" : "es"} ya ${n === 1 ? "había" : "habían"} cambiado de estado`, {
          description: `Ya ${n === 1 ? "estaba gestionada" : "estaban gestionadas"}: no se ha tocado nada y se ha actualizado la lista.`,
        });
      }
      if (fallidas.length > 0) {
        toast.error(`${fallidas.length} solicitud${fallidas.length === 1 ? "" : "es"} sin verificar`, {
          description: "No se pudieron guardar. Inténtalo otra vez.",
        });
      }

      // Los correos salen en segundo plano; si alguno no sale, UN aviso con cuántos. Los que se
      // reintentan automáticamente no piden llamar al cliente (el correo saldrá solo); se cuentan aparte.
      // Todo en singular o plural según cuántos sean (con uno solo no sale «esos clientes» ni «Avísales»).
      const correos = resultados.flatMap((r) => (r.correo ? [r.correo] : []));
      if (correos.length > 0) {
        void Promise.all(correos).then((envios) => {
          const conProblema = envios.filter((envio) => textoProblemaEnvio(envio));
          const reintentables = conProblema.filter((envio) => seReintentaSolo(envio)).length;
          const llamar = conProblema.length - reintentables;
          if (llamar > 0) {
            toast.error(`${llamar} ${uno(llamar, "correo al cliente no ha salido", "correos a clientes no han salido")}`, {
              description:
                uno(
                  llamar,
                  "La reserva ya está verificada, pero ese cliente no recibe el correo. Avísale por teléfono.",
                  "Las reservas ya están verificadas, pero esos clientes no reciben el correo. Avísales por teléfono.",
                ) +
                (reintentables > 0
                  ? ` ${uno(reintentables, "Otro se reintentará automáticamente.", `Otros ${reintentables} se reintentarán automáticamente.`)}`
                  : ""),
              duration: 10_000,
            });
          } else if (reintentables > 0) {
            toast.info(
              `${reintentables} ${uno(reintentables, "correo al cliente no ha salido todavía", "correos a clientes no han salido todavía")}`,
              {
                description: uno(
                  reintentables,
                  "La reserva ya está verificada. Se reintentará el envío automáticamente en unos minutos; si no sale, el panel te avisará.",
                  "Las reservas ya están verificadas. Se reintentarán los envíos automáticamente en unos minutos; si no salen, el panel te avisará.",
                ),
                duration: 10_000,
              },
            );
          }
        });
      }

      return { ok, fallidas, yaCambiadas };
    },
    [ejecutarAccion, queryClient],
  );

  // ─── Las dos vistas ────────────────────────────────────────────────────────

  /** La estrella: marca o desmarca la reserva como importante (en cualquier estado). */
  const alternarImportante = useCallback(
    async (reserva: ReservaEjecutable) => (await ejecutarAccion("importante", reserva)).ok,
    [ejecutarAccion],
  );

  return {
    moverEspacio,
    marcarLlegada,
    marcarNoShow,
    deshacerLlegadaONoShow,
    sentarFuera,
    quitarFuera,
    aceptar,
    verificar,
    rechazar,
    confirmar,
    cancelar,
    aceptarVarias,
    alternarImportante,
    estaEnCurso: (id: string) => enCurso.has(id),
  };
}
