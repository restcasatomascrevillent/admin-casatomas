import { useEffect, useId, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  calcularDisponibilidad,
  filtrarEspaciosPorMarca,
  MARCA_POR_DEFECTO,
} from "./useDisponibilidad";
import { ESTADOS_QUE_OCUPAN } from "../../supabase/functions/_shared/disponibilidad";
import type { EspacioSala, ReservaOcupacionSala } from "@/lib/reservas/ocupacionSalas";
import { ESTADO_LLEGADA } from "@/lib/reservas/servicioSala";

// ============================================================================
// Datos de UN día para la rejilla "Ocupación de salas".
// ----------------------------------------------------------------------------
// Tres SELECT (turnos, espacios, reservas) y nada de cálculo propio: las
// franjas las da el motor compartido (`calcularDisponibilidad`, la MISMA
// fuente de horas que la web y el panel) y la ocupación la calcula
// `src/lib/reservas/ocupacionSalas.ts` (puro, testeado).
//
// Clave ["ocupacion-salas-dia", fecha, marca]: FormularioReserva y
// useAccionesServicioReserva invalidan por prefijo tras crear/mover, y además
// hay una suscripción realtime a `reservas` de ese día.
// ============================================================================

export const CLAVE_OCUPACION_SALAS_DIA = "ocupacion-salas-dia";

/** Estados que hay que traer: los que ocupan aforo + 'completada' (sentados). */
const ESTADOS_A_LEER = [...ESTADOS_QUE_OCUPAN, ESTADO_LLEGADA];

export interface DatosOcupacionSalasDia {
  espacios: EspacioSala[];
  reservas: ReservaOcupacionSala[];
  /** Horas que ofrece el motor ese día ("HH:MM"), comida y cena. */
  horasBase: string[];
  /** El día no tiene turnos configurados (cerrado). */
  cerrado: boolean;
}

export function useOcupacionSalasDia(
  fecha: string | null | undefined,
  opciones?: { marca?: string; enabled?: boolean },
) {
  const marca = opciones?.marca ?? MARCA_POR_DEFECTO;
  const queryClient = useQueryClient();
  const idCanal = useId();

  const query = useQuery({
    queryKey: [CLAVE_OCUPACION_SALAS_DIA, fecha, marca],
    enabled: !!fecha && (opciones?.enabled ?? true),
    queryFn: async (): Promise<DatosOcupacionSalasDia> => {
      const [turnosRes, espaciosRes, reservasRes] = await Promise.all([
        supabase.from("configuracion_turnos").select("*").eq("activo", true),
        supabase
          .from("espacios_reserva" as any)
          .select("id, nombre, capacidad_maxima, caracteristicas")
          .eq("activa", true),
        // `as any`: `.eq("marca", ...)` no está en los tipos generados (mismo
        // recurso que el Kanban y useDisponibilidad).
        (supabase.from("reservas" as any) as any)
          .select("id, hora, numero_comensales, estado, espacio_id")
          .eq("fecha", fecha)
          .eq("marca", marca)
          .in("estado", ESTADOS_A_LEER),
      ]);
      if (turnosRes.error) throw turnosRes.error;
      if (espaciosRes.error) throw espaciosRes.error;
      if (reservasRes.error) throw reservasRes.error;

      const espacios = filtrarEspaciosPorMarca(
        ((espaciosRes.data ?? []) as any[]).map((e) => ({
          id: e.id as string,
          nombre: e.nombre as string,
          capacidad_maxima: Number(e.capacidad_maxima) || 0,
          marca: (e.caracteristicas?.marca as string | undefined) ?? null,
        })),
        marca,
      ).map(({ id, nombre, capacidad_maxima }) => ({ id, nombre, capacidad_maxima }));

      const reservas = ((reservasRes.data ?? []) as any[]).map((r) => ({
        id: r.id as string,
        hora: String(r.hora),
        numero_comensales: Number(r.numero_comensales) || 0,
        estado: r.estado as string,
        espacio_id: (r.espacio_id as string | null) ?? null,
      }));

      // Sin `ahora` ni política: aquí interesan TODAS las franjas del día (el
      // personal puede reservar hoy mismo y fuera del corte), no solo las que
      // la web ofrecería al público en este instante.
      const resultado = calcularDisponibilidad({
        fecha: fecha as string,
        configuraciones: (turnosRes.data ?? []) as any,
        reservas: reservas.filter((r) => (ESTADOS_QUE_OCUPAN as readonly string[]).includes(r.estado)),
        capacidadTotal: espacios.reduce((s, e) => s + e.capacidad_maxima, 0),
        ahora: null,
      });

      return {
        espacios,
        reservas,
        horasBase: Array.from(new Set(resultado.huecos.map((h) => h.hora))),
        cerrado: resultado.cerrado,
      };
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

  const horasBase = useMemo(() => query.data?.horasBase ?? [], [query.data]);
  return { ...query, horasBase };
}
