import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
// Tipos de la escalera de niveles — el MISMO módulo que usan la web y el
// teléfono (ver `disponibilidad.ts`). `niveles_escalera` viaja tal cual el
// jsonb de Supabase: puede ser un array ya parseado, un string, o no venir
// (columna aún sin aplicar / fila creada antes de la migración).
import {
  horasFijasDelDia,
  type NivelEscalera,
  type BaseUmbral,
} from "../../supabase/functions/_shared/disponibilidad";

export interface ConfiguracionTurno {
  id: string;
  nombre_periodo: string;
  hora_inicio: string;
  hora_fin: string;
  intervalo_base_minutos: number;
  umbral_apertura_secundario: number;
  dias_semana: number[];
  activo: boolean;
  espacio_id: string | null;
  ocultar_primario_si_secundario: boolean;
  created_at: string;
  updated_at: string;
  /** NUEVO (migración `20260921000000`, aún no aplicada). Ver `disponibilidad.ts`. */
  niveles_escalera?: NivelEscalera[] | string | null;
  ocultar_nivel_anterior?: boolean | null;
  base_umbral?: BaseUmbral | string | null;
  /** Turnos de hora fija (20261122200000, jueves de tapas: ["20:30:00","22:00:00"]). `null` = escalera. */
  horas_fijas?: string[] | null;
}

export interface ConfiguracionTurnoInsert {
  nombre_periodo: string;
  hora_inicio: string;
  hora_fin: string;
  intervalo_base_minutos?: number;
  umbral_apertura_secundario?: number;
  dias_semana?: number[];
  activo?: boolean;
  espacio_id?: string | null;
  ocultar_primario_si_secundario?: boolean;
  niveles_escalera?: NivelEscalera[] | null;
  ocultar_nivel_anterior?: boolean;
  base_umbral?: BaseUmbral;
  horas_fijas?: string[] | null;
}

export interface ConfiguracionTurnoUpdate extends Partial<ConfiguracionTurnoInsert> {
  id: string;
}

export function useConfiguracionTurnos() {
  return useQuery({
    queryKey: ["configuracion-turnos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracion_turnos")
        .select("*")
        .order("hora_inicio", { ascending: true });

      if (error) throw error;
      return data as ConfiguracionTurno[];
    },
  });
}

export function useConfiguracionTurnosPorEspacio(espacioId: string | null) {
  return useQuery({
    queryKey: ["configuracion-turnos", espacioId],
    queryFn: async () => {
      // Obtener configuraciones específicas del espacio O globales (espacio_id = null)
      const { data, error } = await supabase
        .from("configuracion_turnos")
        .select("*")
        .or(`espacio_id.eq.${espacioId},espacio_id.is.null`)
        .eq("activo", true)
        .order("hora_inicio", { ascending: true });

      if (error) throw error;
      
      // Priorizar configuraciones específicas sobre globales
      const configuraciones = data as ConfiguracionTurno[];
      const especificas = configuraciones.filter(c => c.espacio_id === espacioId);
      const globales = configuraciones.filter(c => c.espacio_id === null);
      
      // Si hay configuraciones específicas, usarlas; si no, usar globales
      return especificas.length > 0 ? especificas : globales;
    },
    enabled: espacioId !== undefined,
  });
}

/**
 * Turnos de hora fija de ese día ("HH:MM"): el jueves de tapas por la noche,
 * 20:30 y 22:00 (`configuracion_turnos.horas_fijas`). Vacío = día normal.
 * Misma consulta (y caché) que `useConfiguracionTurnos`.
 */
export function useHorasFijasDelDia(fecha: string | null | undefined): string[] {
  const { data } = useConfiguracionTurnos();
  return useMemo(() => horasFijasDelDia(fecha, data), [fecha, data]);
}

/**
 * La migración `20260921000000_escalera_niveles_turno.sql` que añade
 * `niveles_escalera` / `ocultar_nivel_anterior` / `base_umbral` está
 * escrita pero NO aplicada (a propósito: no la toca esta pantalla). Los
 * tipos generados de Supabase (`integrations/supabase/types.ts`) por tanto
 * no conocen esas columnas — de ahí el `as any` en el payload, igual que
 * ya hace este código con `espacios_reserva`, tabla tampoco tipada.
 *
 * Si esas claves llegan a un entorno donde la migración no está aplicada,
 * Postgres/PostgREST responde "column ... does not exist" (42703) o
 * "Could not find column" (PGRST204). Se traduce a un mensaje que se
 * entiende sin leer un log, en vez de dejar pasar el error crudo.
 */
function esErrorColumnaEscaleraFaltante(error: unknown): boolean {
  const mensaje = String((error as { message?: string } | null)?.message ?? "");
  const codigo = String((error as { code?: string } | null)?.code ?? "");
  return (
    codigo === "42703" ||
    codigo === "PGRST204" ||
    /niveles_escalera|ocultar_nivel_anterior|base_umbral/.test(mensaje)
  );
}

function relanzarErrorEscalera(error: unknown): never {
  if (esErrorColumnaEscaleraFaltante(error)) {
    throw new Error(
      "No se pudo guardar la escalera de niveles: falta aplicar la migración pendiente en la base de datos (niveles_escalera). Pide que se aplique y vuelve a intentarlo.",
    );
  }
  throw error;
}

export function useCrearConfiguracionTurno() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: ConfiguracionTurnoInsert) => {
      const { data, error } = await supabase
        .from("configuracion_turnos")
        .insert(config as any)
        .select()
        .single();

      if (error) relanzarErrorEscalera(error);
      return data as ConfiguracionTurno;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracion-turnos"] });
    },
  });
}

export function useActualizarConfiguracionTurno() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: ConfiguracionTurnoUpdate) => {
      const { data, error } = await supabase
        .from("configuracion_turnos")
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();

      if (error) relanzarErrorEscalera(error);
      return data as ConfiguracionTurno;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracion-turnos"] });
    },
  });
}

export function useEliminarConfiguracionTurno() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("configuracion_turnos")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracion-turnos"] });
    },
  });
}

// NOTA: existió aquí una `generarTurnosDinamicos` local (copia muerta de la
// regla del umbral, distinta de la de `useDisponibilidad.ts` y de la del
// motor compartido). Se confirmó sin uso — ningún import en el repo la
// referenciaba, solo `useDisponibilidad.ts` exporta una función con ese
// mismo nombre — y se eliminó. La única fuente de esta regla es
// `supabase/functions/_shared/disponibilidad.ts`.
