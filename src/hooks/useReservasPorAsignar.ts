import { useEffect, useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esGradoAsignacion, esTurno, gradoDeReserva, turnoDeHora } from "@/lib/reservas/asignacionMesas";
import { normalizarMarca } from "@/lib/reservas/negocios";
import { CLAVE_RESUMEN_ASIGNACION_DIA, type FilaAsignacionDia } from "@/hooks/useResumenAsignacionDia";
import { estadosDePartida } from "@/lib/reservas/accionesEjecutables";
import { clavesAInvalidar } from "@/lib/reservas/clavesCache";
import { ErrorSinFilasReserva, escribirReserva } from "@/lib/reservas/escribirReserva";
import { etiquetaEstadoReserva } from "@/lib/reservas/estadosReserva";
import { paginarConsulta } from "@/lib/reservas/paginarConsulta";
import { crearInvalidacionDiferida, REFRESCO_PERIODICO, vigilarCanal } from "@/lib/realtimeCanal";

// ============================================================================
// RESERVAS POR ASIGNAR — panel "Asignación" (reservas-sin-salas, Fase B)
// ----------------------------------------------------------------------------
// Lee `vista_asignacion_dia` (una fila por reserva activa, con sus mesas ya
// contadas en SQL) sobre un RANGO de días. `useResumenAsignacionDia` hace lo
// mismo para un solo día; el panel necesita la ventana de N horas (hasta una
// semana) más lo que venga después.
//
// La clave de caché empieza por `CLAVE_RESUMEN_ASIGNACION_DIA` a propósito:
// las mutaciones de mesas ya invalidan ese prefijo, así que sentar una reserva
// desde el plano refresca también este panel sin tocar esos hooks.
//
// LAS 1000 FILAS: PostgREST corta cada petición a 1000 filas sin avisar, y un
// rango de 30 días en temporada las pasa. Antes la consulta se quedaba con las
// primeras y el panel avisaba de que «puede que falten reservas»; ahora se lee
// el rango ENTERO por lotes (`paginarConsulta`: recuento exacto, lotes en
// paralelo y orden total con `reserva_id` de desempate). La lectura es TODO O
// NADA dentro de la propia consulta: mientras faltan lotes el panel sigue en su
// «cargando» (o con los datos anteriores si es un refresco), si un lote falla la
// consulta falla entera (`isError`, con «Reintentar») y nunca se pintan filas a
// medias. Solo si el rango pasa del tope de seguridad (`LIMITE_FILAS`, 10.000)
// se devuelve lo que cabe con `truncado: true`, y el panel lo dice.
//
// SI LOS DATOS CAMBIAN MIENTRAS SE LEEN los lotes (una reserva sale de la vista
// porque pasa a «Llegó» o se cancela, o entra otra), lo que llega ya no es lo que
// el servidor contó: `paginarConsulta` lo detecta y lanza `ErrorLecturaInconsistente`
// en vez de devolver un conjunto con huecos. TanStack Query reintenta solo (3
// veces por defecto); en un refresco los datos anteriores siguen en pantalla y, si
// persiste, el panel acaba en su error con «Reintentar».
//
// CANCELACIÓN: la `queryFn` recibe el `signal` de TanStack Query y lo pasa a cada
// lote (`.abortSignal`) y al helper: si la consulta se cancela, la lectura vieja
// aborta sus peticiones en vuelo y no lanza más lotes. Se cancela (1) cuando un
// evento realtime invalida la consulta y YA HAY datos en caché (un refresco:
// TanStack Query cancela la lectura en curso y lanza otra) y (2) al desmontar el
// panel (el `signal` está en uso, así que TanStack Query cancela y revierte).
// En la CARGA INICIAL (aún sin datos) un evento realtime NO cancela nada:
// TanStack Query devuelve la lectura en vuelo y, al terminar, da la consulta por
// al día. Un cambio que el comprobante de coherencia no detecta (entra una fila y
// sale otra, o cambia un valor de una fila ya leída) se queda hasta el siguiente
// evento realtime, el refresco periódico o el foco de la ventana.
//
// RÁFAGAS: los eventos realtime invalidan DIFERIDO (1 s tras el último, como mucho
// cada 5 s): con una ráfaga (la carga de la demo, 861 altas en un minuto) cada
// evento ya no aborta y relanza la lectura por lotes, que así llega a terminar.
//
// RESPALDO SIN REALTIME: `REFRESCO_PERIODICO`, cada minuto con la pestaña a la
// vista (2 peticiones por minuto con la lectura por lotes de hoy). El intervalo de
// TanStack Query no se solapa con una lectura en curso: si la hay, la reutiliza.
// ============================================================================

export type { FilaAsignacionDia };

/** Lo que guarda la caché de esta consulta: todas las filas del rango y si el tope de seguridad las cortó. */
interface ResultadoAsignacion {
  filas: FilaAsignacionDia[];
  truncado: boolean;
}

export function useReservasPorAsignar(desde: string, hasta: string, opciones?: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  const idCanal = useId();
  const enabled = !!desde && !!hasta && (opciones?.enabled ?? true);
  const queryKey = [CLAVE_RESUMEN_ASIGNACION_DIA, "rango", desde, hasta] as const;

  const query = useQuery({
    ...REFRESCO_PERIODICO,
    queryKey,
    enabled,
    queryFn: async ({ signal }): Promise<ResultadoAsignacion> => {
      const { filas, truncado } = await paginarConsulta<Record<string, unknown>>(
        (primera, ultima, contar) =>
          supabase
            .from("vista_asignacion_dia")
            .select("*", contar ? { count: "exact" } : undefined)
            .gte("fecha", desde)
            .lte("fecha", hasta)
            .order("fecha", { ascending: true })
            .order("hora", { ascending: true })
            // Desempate: sin una columna única, dos reservas a la misma hora pueden repetirse o saltarse entre lotes.
            .order("reserva_id", { ascending: true })
            .range(primera, ultima)
            .abortSignal(signal),
        // `clave`: una fila que llega dos veces por un desplazamiento se descarta y el recuento deja de cuadrar.
        { clave: (fila) => String(fila?.reserva_id), signal },
      );
      return { filas: filas.filter(Boolean).map(normalizarFila), truncado };
    },
  });

  // Realtime: una reserva nueva, un cambio de sala (también el "Deshacer" de
  // otra pantalla) o una mesa asignada desde el plano mueven la reserva de
  // grupo. Nombre de canal único por instancia (ver useOcupacionSalasDia).
  // UN CANAL POR TABLA: el servidor da de alta las escuchas de un canal en una
  // sola transacción y, si una tabla no está en la publicación, las deshace
  // TODAS. Hasta la migración 20261001200000 no lo está ninguna de las dos (la
  // migración publica ambas); por separado, si algún día una deja de estarlo,
  // la otra sigue llegando.
  // `vigilarCanal`: si un canal no recibe cambios lo dice una vez por consola.
  useEffect(() => {
    if (!enabled) return;
    const diferida = crearInvalidacionDiferida(() => {
      queryClient.invalidateQueries({ queryKey: [CLAVE_RESUMEN_ASIGNACION_DIA, "rango"] });
    });
    const canales = (["reservas", "asignaciones_mesa"] as const).map((tabla) => {
      const nombre = `reservas-por-asignar-${tabla}-${idCanal}`;
      const vigilancia = vigilarCanal(nombre, { tabla });
      const canal = supabase
        .channel(nombre)
        .on("system", {}, vigilancia.alMensajeSistema)
        .on("postgres_changes", { event: "*", schema: "public", table: tabla }, diferida.programar)
        .subscribe(vigilancia.alCambiarEstado);
      return { canal, vigilancia };
    });
    return () => {
      diferida.cancelar();
      for (const { canal, vigilancia } of canales) {
        vigilancia.cerrar();
        supabase.removeChannel(canal);
      }
    };
  }, [enabled, idCanal, queryClient]);

  // Se devuelve solo lo que lee el panel, campo a campo, y no `...query`: el resultado de `useQuery`
  // lleva la cuenta de qué campos lee el componente para repintarlo solo por ellos, y un `...` los
  // leería todos y lo repintaría por cualquier cambio interno (cada refetch).
  return {
    /** Todas las filas del rango (`undefined` hasta que llegan TODOS los lotes). */
    data: query.data?.filas,
    /** Hay más reservas en el rango que el tope de seguridad: las que faltan son las últimas. */
    truncado: query.data?.truncado ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Error de escritura sin filas afectadas: la RLS la ha filtrado en silencio, la reserva ya no existe
 * o —la escritura va condicionada a que siga ocupando sitio— otra persona la cambió antes (la
 * canceló, o no vino). El nombre es el de siempre (el panel comprueba `instanceof`); el MENSAJE
 * dice la causa cuando se ha podido averiguar.
 */
export class ErrorSinPermisoSala extends Error {
  constructor(mensaje = MENSAJE_SALA_NO_SE_SABE) {
    super(mensaje);
    this.name = "ErrorSinPermisoSala";
  }
}

const MENSAJE_SALA_NO_SE_SABE =
  "No tienes permiso para cambiar la sala de esta reserva, o la reserva ya no existe o ya ha cambiado de estado.";

/** Qué decirle al personal según por qué no se ha tocado ninguna fila (`escribirReserva` relee el estado). */
function mensajeDeSala(error: ErrorSinFilasReserva): string {
  switch (error.motivo) {
    case "estado_cambiado":
      return `La reserva ya ha cambiado de estado (ahora está «${etiquetaEstadoReserva(error.estadoActual)}») y no se ha cambiado la sala. Se ha refrescado la pantalla.`;
    case "sin_permiso":
      return "No tienes permiso para cambiar la sala de esta reserva.";
    case "sin_permiso_o_inexistente":
      return "No tienes permiso para cambiar la sala de esta reserva, o la reserva ya no existe.";
    default:
      return MENSAJE_SALA_NO_SE_SABE;
  }
}

/**
 * Cambia la sala de una reserva. Es una decisión INTERNA: no invoca
 * `notify-reservation-change` ni ningún otro envío, así que el cliente no
 * recibe correo (mismo criterio que `useAccionesServicioReserva`).
 *
 * Es el mismo cambio que «Mover a…» del kanban (`useAccionesServicioReserva.moverEspacio`)
 * y comparte con él la escritura (`escribirReserva`: pide la fila de vuelta y va
 * condicionada a que la reserva siga ocupando sitio, o sea, no cancelada ni «No vino»)
 * y la lista de claves a refrescar (`clavesCache.ts`). Lo único propio de aquí es que es
 * una mutación de React Query, sin actualización optimista y sin avisos: el panel pone
 * los suyos.
 *
 * OJO: el trigger `trg_reservas_sincronizar_asignaciones` BORRA las mesas
 * asignadas cuando cambia la sala. Quien llama tiene que pedir confirmación
 * antes si la reserva ya tiene mesas.
 *
 * Nunca pone la sala a NULL: `espacioId` es obligatorio.
 */
export function useCambiarSalaReserva() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ reservaId, espacioId }: { reservaId: string; espacioId: string }) => {
      if (!reservaId || !espacioId) throw new Error("Falta la reserva o la sala");
      try {
        // Con RLS, una escritura denegada NO da error, devuelve 0 filas: `escribirReserva`
        // lo trata como error para que la pantalla no diga «guardado» sin haberlo.
        const filas = await escribirReserva(reservaId, { espacio_id: espacioId }, { desdeEstados: estadosDePartida("mover") });
        return filas[0];
      } catch (error) {
        if (error instanceof ErrorSinFilasReserva) throw new ErrorSinPermisoSala(mensajeDeSala(error));
        throw error;
      }
    },
    onSettled: () => {
      for (const clave of clavesAInvalidar({ espacio_id: null })) {
        queryClient.invalidateQueries({ queryKey: [clave] });
      }
    },
  });
}

/**
 * Saneado de una fila de la vista. Mismas reglas que `useResumenAsignacionDia`
 * (allí no está exportado): las columnas de una vista llegan todas nullable, y
 * `turno`/`grado` se recalculan con la lógica pura si no son válidos.
 */
function normalizarFila(fila: Record<string, unknown>): FilaAsignacionDia {
  const hora = String(fila.hora ?? "");
  const espacioId = fila.espacio_id ? String(fila.espacio_id) : null;
  const mesasAsignadas = entero(fila.mesas_asignadas);
  return {
    reserva_id: String(fila.reserva_id ?? ""),
    fecha: String(fila.fecha ?? ""),
    hora,
    turno: esTurno(fila.turno) ? fila.turno : turnoDeHora(hora),
    nombre: String(fila.nombre ?? ""),
    numero_comensales: entero(fila.numero_comensales),
    estado: String(fila.estado ?? ""),
    marca: normalizarMarca(fila.marca as string | null),
    espacio_id: espacioId,
    espacio_nombre: fila.espacio_nombre ? String(fila.espacio_nombre) : null,
    mesas_asignadas: mesasAsignadas,
    plazas_asignadas: entero(fila.plazas_asignadas),
    mesas_nombres: Array.isArray(fila.mesas_nombres) ? (fila.mesas_nombres as string[]).filter(Boolean) : [],
    grado: esGradoAsignacion(fila.grado)
      ? fila.grado
      : gradoDeReserva({ espacio_id: espacioId, mesas_asignadas: mesasAsignadas }),
  };
}

const entero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};
