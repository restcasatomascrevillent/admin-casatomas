import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { mensajeErrorAsignacion, turnoDeHora, type Turno } from "@/lib/reservas/asignacionMesas";
import { CLAVE_RESUMEN_ASIGNACION_DIA } from "@/hooks/useResumenAsignacionDia";

// ============================================================================
// ASIGNACIONES DE MESA — grado 2 del cierre del día
// ----------------------------------------------------------------------------
// El grado 1 (reserva → SALA) lo hace el kanban moviendo `reservas.espacio_id`.
// Aquí se trabaja el grado 2 (reserva → MESA concreta), que es OPCIONAL: una
// reserva con sala y sin mesa es un estado normal, no un error. Quitarle todas
// las mesas a una reserva es una operación legítima, no un fallo.
//
// DOS CAMINOS para guardar, y conviven a propósito:
//   · `useAsignarMesasReserva` (RECOMENDADO): llama al RPC
//     `asignar_mesas_reserva`, que es ATÓMICO y reemplaza TODAS las mesas de la
//     reserva por el array que se le pase (array vacío = quitarlas todas).
//     Valida en servidor sala, estado de la reserva, mesa activa y choque de
//     mesa en ese día+turno.
//   · `useCrearAsignacion` / `useEliminarAsignacion` (LEGADO): un INSERT y un
//     DELETE sueltos, mesa a mesa. Los usa `PlanoEspacio2D.tsx`. Se mantienen
//     con la MISMA firma para no romperlo; no valida nada en cliente y depende
//     de las restricciones de la tabla.
// ============================================================================

// Reexportado por comodidad: quien use estos hooks necesita el tipo `Turno`
// para el parámetro nuevo y para `useAsignarMesasReserva`.
export type { Turno };

/** Prefijo de todas las claves de caché de este hook. Invalidar por aquí. */
export const CLAVE_ASIGNACIONES_MESA = "asignaciones_mesa";

export interface AsignacionMesa {
  id: string;
  reserva_id: string;
  mesa_id: string;
  created_at: string;
  // Columnas denormalizadas que añade la migración de asignación de mesas.
  // OPCIONALES a propósito: hasta que la migración esté aplicada no llegan, y
  // así el mismo tipo sirve antes y después.
  fecha?: string | null;
  turno?: Turno | string | null;
  espacio_id?: string | null;
  asignada_por?: string | null;
}

export interface AsignacionConDetalles extends AsignacionMesa {
  reservas: {
    id: string;
    nombre: string;
    hora: string;
    numero_comensales: number;
    estado: string;
    /** Viene en el select; declarada opcional para no romper a quien construya el objeto. */
    fecha?: string;
  };
  mesas: {
    id: string;
    nombre: string;
    capacidad: number;
    espacio_id?: string;
  };
}

/**
 * Asignaciones de un día (y opcionalmente de una sala y de un turno).
 *
 * `turno` es un parámetro NUEVO y va al final para no romper las llamadas de
 * dos argumentos que ya existen (`PlanoEspacio2D`).
 *
 * POR QUÉ EL TURNO SE FILTRA EN JS y no con un `.eq("turno", …)`: el turno sale
 * de `reservas.hora` con la misma regla que el SQL (`turnoDeHora`, corte 17:00),
 * así que filtrar aquí da el mismo resultado que la columna denormalizada
 * `asignaciones_mesa.turno` y además funciona ANTES de aplicar la migración. La
 * lista ya viene recortada a un día (y casi siempre a una sala), así que filtrar
 * en memoria no cuesta nada.
 *
 * `refresco` (opcional, al final por lo mismo): relectura periódica de respaldo
 * mientras realtime no entrega `asignaciones_mesa` (`REFRESCO_PERIODICO` de
 * realtimeCanal.ts). La piden «Hoy» (el kanban, para marcar «Sin mesa») y el modo
 * servicio, que pueden pasarse horas a la vista sin que cambie el foco.
 */
export function useAsignacionesMesa(
  fecha?: string,
  espacioId?: string,
  turno?: Turno,
  refresco?: { refetchInterval: number | false; refetchIntervalInBackground?: boolean },
) {
  return useQuery({
    ...refresco,
    // La clave solo crece cuando hay turno, para que las llamadas antiguas
    // conserven su clave de siempre. Todas empiezan por "asignaciones_mesa", así
    // que un invalidateQueries por ese prefijo sigue alcanzándolas todas.
    queryKey: turno
      ? [CLAVE_ASIGNACIONES_MESA, fecha, espacioId, turno]
      : [CLAVE_ASIGNACIONES_MESA, fecha, espacioId],
    queryFn: async () => {
      let query = supabase
        .from("asignaciones_mesa")
        .select(`
          *,
          reservas!inner (
            id,
            nombre,
            hora,
            numero_comensales,
            estado,
            fecha
          ),
          mesas!inner (
            id,
            nombre,
            capacidad,
            espacio_id
          )
        `);

      // Filtrar por fecha y espacio en el propio servidor (PostgREST) en vez de
      // descargar todas las asignaciones y filtrar en JS.
      if (fecha) {
        query = query.eq("reservas.fecha", fecha);
      }

      if (espacioId) {
        query = query.eq("mesas.espacio_id", espacioId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const filas = (data || []) as unknown as AsignacionConDetalles[];
      if (!turno) return filas;
      return filas.filter((a) => a && turnoDeHora(a.reservas?.hora ?? "") === turno);
    },
    enabled: true,
  });
}

/**
 * Añade UNA mesa a una reserva (camino legado, el del plano actual).
 *
 * `fecha`, `turno` y `espacio_id` son opcionales y solo se envían si se pasan:
 * el payload por defecto sigue siendo `{ reserva_id, mesa_id }` exactamente como
 * antes, para no escribir columnas que quizá aún no existan. Para guardar varias
 * mesas de golpe usa `useAsignarMesasReserva`, que además valida en servidor.
 */
export function useCrearAsignacion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      reserva_id,
      mesa_id,
      fecha,
      turno,
      espacio_id,
    }: {
      reserva_id: string;
      mesa_id: string;
      fecha?: string;
      turno?: Turno;
      espacio_id?: string;
    }) => {
      const fila: TablesInsert<"asignaciones_mesa"> = { reserva_id, mesa_id };
      if (fecha) fila.fecha = fecha;
      if (turno) fila.turno = turno;
      if (espacio_id) fila.espacio_id = espacio_id;

      const { data, error } = await supabase
        .from("asignaciones_mesa")
        .insert(fila)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidarAsignaciones(queryClient);
    },
    onError: (error) => {
      // Traducido: si salta la unique (mesa_id, fecha, turno) el camarero tiene
      // que leer "esa mesa ya está asignada", no "Error al asignar mesa".
      toast.error(mensajeErrorAsignacion(error));
      console.error(error);
    },
  });
}

/** Quita UNA asignación por su id (camino legado, el del plano actual). */
export function useEliminarAsignacion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("asignaciones_mesa")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidarAsignaciones(queryClient);
    },
    onError: (error) => {
      // Antes fallaba en silencio: la mesa seguía pintada como ocupada y nadie
      // se enteraba de que el borrado no había llegado a la base de datos.
      toast.error(mensajeErrorAsignacion(error));
      console.error(error);
    },
  });
}

export interface AsignarMesasReservaInput {
  reserva_id: string;
  /** Mesas definitivas de la reserva. Array VACÍO = quitarle todas las mesas. */
  mesa_ids: string[];
  /** No enseñar el toast de éxito (la pantalla ya avisa a su manera). */
  silencioso?: boolean;
}

/**
 * Guarda las mesas de UNA reserva contra el RPC `asignar_mesas_reserva`.
 *
 * Es el camino bueno: una sola llamada ATÓMICA que reemplaza todas las mesas de
 * la reserva. Un array vacío quita las mesas y deja la reserva con sala y sin
 * mesa — eso NO es un error y sale con su propio mensaje de éxito.
 *
 * Los ids se deduplican antes de enviarlos: dos clics rápidos sobre la misma
 * mesa en el plano mandarían el id dos veces y la restricción
 * `unique (mesa_id, fecha, turno)` lo leería como "mesa ocupada" por sí misma.
 *
 * Los errores del servidor (`MESA_OCUPADA:`, `MESA_OTRA_SALA:`,
 * `RESERVA_SIN_SALA:`, `RESERVA_CANCELADA:`, `MESA_INACTIVA:`) se traducen con
 * `mensajeErrorAsignacion`, así que la pantalla NO necesita poner su propio
 * toast de error.
 */
export function useAsignarMesasReserva() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ reserva_id, mesa_ids }: AsignarMesasReservaInput) => {
      const ids = Array.from(new Set((mesa_ids ?? []).filter(Boolean)));

      const { data, error } = await supabase.rpc("asignar_mesas_reserva", {
        p_reserva_id: reserva_id,
        p_mesa_ids: ids,
      });
      if (error) throw error;
      return (data ?? []) as AsignacionMesa[];
    },
    onSuccess: (filas, variables) => {
      invalidarAsignaciones(queryClient);
      if (variables?.silencioso) return;

      const cuantas = filas?.length ?? 0;
      if (cuantas === 0) {
        toast.success("Mesas quitadas. La reserva se queda en su sala, sin mesa.");
      } else {
        toast.success(cuantas === 1 ? "Mesa asignada" : `${cuantas} mesas asignadas`);
      }
    },
    onError: (error) => {
      toast.error(mensajeErrorAsignacion(error));
      console.error(error);
    },
  });
}

/**
 * Asignación masiva mesa-a-mesa (borra y reinserta en dos pasos).
 *
 * LEGADO: no es atómico y no valida sala ni turno. Se conserva por compatibilidad
 * con quien ya lo llame; para código nuevo, `useAsignarMesasReserva` por reserva.
 */
export function useAsignarMesasAutomatico() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (asignaciones: Array<{ reserva_id: string; mesa_id: string }>) => {
      // Primero eliminar asignaciones existentes para estas reservas
      const reservaIds = asignaciones.map(a => a.reserva_id);
      await supabase
        .from("asignaciones_mesa")
        .delete()
        .in("reserva_id", reservaIds);

      // Insertar nuevas asignaciones
      const { error } = await supabase
        .from("asignaciones_mesa")
        .insert(asignaciones);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidarAsignaciones(queryClient);
      toast.success("Mesas asignadas correctamente");
    },
    onError: (error) => {
      toast.error(mensajeErrorAsignacion(error));
      console.error(error);
    },
  });
}

/**
 * Invalida TODO lo que depende de las mesas de una reserva: la lista de
 * asignaciones (cualquier fecha/sala/turno, por prefijo) y el resumen del día,
 * que es lo que lee el calendario. Si solo se invalidase la primera, el plano se
 * refrescaría y el calendario seguiría diciendo que falta por cerrar.
 */
function invalidarAsignaciones(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: [CLAVE_ASIGNACIONES_MESA] });
  queryClient.invalidateQueries({ queryKey: [CLAVE_RESUMEN_ASIGNACION_DIA] });
}
