import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ESTADOS_QUE_OCUPAN } from "../../supabase/functions/_shared/disponibilidad";
import { horasBaseDelDia, type EspacioSala, type ReservaOcupacionSala } from "@/lib/reservas/ocupacionSalas";
import { admiteReservas, salaAdmiteReservas } from "@/lib/reservas/negocios";
import { ESTADO_LLEGADA } from "@/lib/reservas/servicioSala";

// ============================================================================
// Datos de UN día para la rejilla "Ocupación de salas".
// ----------------------------------------------------------------------------
// Tres SELECT (turnos, espacios, reservas) y nada de cálculo propio: las
// franjas las da el motor compartido (`calcularDisponibilidad`, la MISMA
// fuente de horas que la web y el panel) y la ocupación la calcula
// `src/lib/reservas/ocupacionSalas.ts` (puro, testeado).
//
// SOLO CASA TOMÁS (decisión del dueño, 2026-10-01: Touza no admite reservas).
// Las salas y reservas de otro negocio que aún queden en la base de datos se
// descartan aquí con `admiteReservas` / `salaAdmiteReservas`, así que ninguna
// rejilla (cuartos de hora, salas, formulario, solicitudes, asignación) las ve.
// El aforo del turno es el de Casa Tomás, el mismo que valida el trigger
// `validar_capacidad_reserva` para su marca.
//
// Clave ["ocupacion-salas-dia", fecha]: FormularioReserva y
// useAccionesServicioReserva invalidan por prefijo tras crear/mover, y además
// hay una suscripción realtime a `reservas` de ese día.
// ============================================================================

export const CLAVE_OCUPACION_SALAS_DIA = "ocupacion-salas-dia";

/** Estados que hay que traer: los que ocupan aforo + 'completada' (sentados). */
const ESTADOS_A_LEER = [...ESTADOS_QUE_OCUPAN, ESTADO_LLEGADA];

export interface DatosOcupacionSalasDia {
  /** Salas activas de Casa Tomás. */
  espacios: EspacioSala[];
  /** Reservas del día de Casa Tomás que ocupan sitio (o ya llegaron). */
  reservas: ReservaOcupacionSala[];
  /** Horas que ofrece el motor ese día ("HH:MM"). */
  horasBase: string[];
  /** No hay turnos ese día (cerrado). */
  cerrado: boolean;
}

export function useOcupacionSalasDia(
  fecha: string | null | undefined,
  opciones?: {
    enabled?: boolean;
  },
) {
  const queryClient = useQueryClient();
  const idCanal = useId();

  const query = useQuery({
    queryKey: [CLAVE_OCUPACION_SALAS_DIA, fecha],
    enabled: !!fecha && (opciones?.enabled ?? true),
    queryFn: async (): Promise<DatosOcupacionSalasDia> => {
      const [turnosRes, espaciosRes, reservasRes] = await Promise.all([
        supabase.from("configuracion_turnos").select("*").eq("activo", true),
        supabase
          .from("espacios_reserva" as any)
          .select("id, nombre, capacidad_maxima, caracteristicas")
          .eq("activa", true),
        // `as any`: `marca` no está en los tipos generados (mismo recurso que
        // el Kanban y useDisponibilidad).
        (supabase.from("reservas" as any) as any)
          .select("id, hora, numero_comensales, estado, espacio_id, marca")
          .eq("fecha", fecha)
          .in("estado", ESTADOS_A_LEER),
      ]);
      if (turnosRes.error) throw turnosRes.error;
      if (espaciosRes.error) throw espaciosRes.error;
      if (reservasRes.error) throw reservasRes.error;

      const espacios: EspacioSala[] = ((espaciosRes.data ?? []) as any[])
        .filter((e) => salaAdmiteReservas(e))
        .map((e) => ({
          id: e.id as string,
          nombre: e.nombre as string,
          capacidad_maxima: Number(e.capacidad_maxima) || 0,
        }));

      const reservas: ReservaOcupacionSala[] = ((reservasRes.data ?? []) as any[])
        .filter((r) => admiteReservas(r.marca as string | null))
        .map((r) => ({
          id: r.id as string,
          hora: String(r.hora),
          numero_comensales: Number(r.numero_comensales) || 0,
          estado: r.estado as string,
          espacio_id: (r.espacio_id as string | null) ?? null,
        }));

      // Sin `ahora` ni política: aquí interesan TODAS las franjas del día (el
      // personal puede reservar hoy mismo y fuera del corte), no solo las que
      // la web ofrecería al público en este instante.
      const configuraciones = (turnosRes.data ?? []) as any[];
      return { espacios, reservas, ...horasBaseDelDia(fecha as string, { espacios, reservas }, configuraciones) };
    },
  });

  // Realtime: si alguien crea/mueve/cancela una reserva de ese día, se
  // refresca. Nombre de canal único por instancia (realtime-js reutiliza el
  // canal si el nombre coincide y el primer desmontaje lo cerraría para todos).
  useEffect(() => {
    if (!fecha || opciones?.enabled === false) return;
    const canal = supabase
      .channel(`ocupacion-salas-${fecha}-${idCanal}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservas", filter: `fecha=eq.${fecha}` },
        () => {
          queryClient.invalidateQueries({ queryKey: [CLAVE_OCUPACION_SALAS_DIA, fecha] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [fecha, idCanal, queryClient, opciones?.enabled]);

  return query;
}
