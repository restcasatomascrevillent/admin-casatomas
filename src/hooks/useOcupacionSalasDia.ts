import { useEffect, useId, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ESTADOS_QUE_OCUPAN } from "../../supabase/functions/_shared/disponibilidad";
import {
  horasBaseDeNegocio,
  repartirPorNegocio,
  type EspacioSala,
  type ReservaOcupacionSala,
} from "@/lib/reservas/ocupacionSalas";
import { MARCA_POR_DEFECTO, normalizarMarca } from "@/lib/reservas/negocios";
import { ESTADO_LLEGADA } from "@/lib/reservas/servicioSala";

// ============================================================================
// Datos de UN día para la rejilla "Ocupación de salas".
// ----------------------------------------------------------------------------
// Tres SELECT (turnos, espacios, reservas) y nada de cálculo propio: las
// franjas las da el motor compartido (`calcularDisponibilidad`, la MISMA
// fuente de horas que la web y el panel) y la ocupación la calcula
// `src/lib/reservas/ocupacionSalas.ts` (puro, testeado).
//
// TODOS los negocios (Casa Tomás + Touza · El Reservado, decisión del dueño
// 2026-09-24), ya repartidos en `negocios`: cada bloque trae sus espacios,
// sus reservas (columna `reservas.marca`) y sus franjas, para que el aforo se
// cuente por negocio igual que el trigger `validar_capacidad_reserva`.
//
// Clave ["ocupacion-salas-dia", fecha]: FormularioReserva y
// useAccionesServicioReserva invalidan por prefijo tras crear/mover, y además
// hay una suscripción realtime a `reservas` de ese día.
// ============================================================================

export const CLAVE_OCUPACION_SALAS_DIA = "ocupacion-salas-dia";

/** Estados que hay que traer: los que ocupan aforo + 'completada' (sentados). */
const ESTADOS_A_LEER = [...ESTADOS_QUE_OCUPAN, ESTADO_LLEGADA];

export interface DatosNegocioDia {
  marca: string;
  espacios: EspacioSala[];
  reservas: ReservaOcupacionSala[];
  /** Horas que ofrece el motor ese día para ESTE negocio ("HH:MM"). */
  horasBase: string[];
  /** El negocio no tiene turnos ese día (cerrado). */
  cerrado: boolean;
}

export interface DatosOcupacionSalasDia {
  /** Un bloque por negocio (Casa Tomás siempre, el primero). */
  negocios: DatosNegocioDia[];
}

/** Bloque de un negocio (vacío si ese día no tiene nada). */
export function datosDeNegocio(
  datos: DatosOcupacionSalasDia | null | undefined,
  marca: string | null | undefined,
): DatosNegocioDia | null {
  if (!datos) return null;
  const m = normalizarMarca(marca);
  return (
    datos.negocios.find((n) => n.marca === m) ?? { marca: m, espacios: [], reservas: [], horasBase: [], cerrado: true }
  );
}

export function useOcupacionSalasDia(
  fecha: string | null | undefined,
  opciones?: {
    enabled?: boolean;
    /** Negocio cuyas franjas devuelve `horasBase` (por defecto Casa Tomás). */
    marca?: string | null;
  },
) {
  const marca = normalizarMarca(opciones?.marca ?? MARCA_POR_DEFECTO);
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

      const espacios: EspacioSala[] = ((espaciosRes.data ?? []) as any[]).map((e) => ({
        id: e.id as string,
        nombre: e.nombre as string,
        capacidad_maxima: Number(e.capacidad_maxima) || 0,
        marca: normalizarMarca((e.caracteristicas?.marca as string | undefined) ?? null),
      }));

      const reservas: ReservaOcupacionSala[] = ((reservasRes.data ?? []) as any[]).map((r) => ({
        id: r.id as string,
        hora: String(r.hora),
        numero_comensales: Number(r.numero_comensales) || 0,
        estado: r.estado as string,
        espacio_id: (r.espacio_id as string | null) ?? null,
        marca: normalizarMarca((r.marca as string | null) ?? null),
      }));

      // Sin `ahora` ni política: aquí interesan TODAS las franjas del día (el
      // personal puede reservar hoy mismo y fuera del corte), no solo las que
      // la web ofrecería al público en este instante.
      const configuraciones = (turnosRes.data ?? []) as any[];
      return {
        negocios: repartirPorNegocio(espacios, reservas).map((bloque) => ({
          ...bloque,
          ...horasBaseDeNegocio(fecha as string, bloque, configuraciones),
        })),
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

  const negocio = useMemo(() => datosDeNegocio(query.data, marca), [query.data, marca]);
  const horasBase = useMemo(() => negocio?.horasBase ?? [], [negocio]);
  /** Bloque del negocio pedido (`opciones.marca`) y sus franjas. */
  return { ...query, negocio, horasBase };
}
