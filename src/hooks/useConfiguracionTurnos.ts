import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

export function useCrearConfiguracionTurno() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: ConfiguracionTurnoInsert) => {
      const { data, error } = await supabase
        .from("configuracion_turnos")
        .insert(config)
        .select()
        .single();

      if (error) throw error;
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
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
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

// Función auxiliar para generar los turnos dinámicos basados en la configuración
export function generarTurnosDinamicos(
  configuraciones: ConfiguracionTurno[],
  fecha: Date,
  ocupacionPorHora: Record<string, { ocupacion: number; capacidadMaxima: number }>
): { hora: string; esTurnoSecundario: boolean; motivoApertura?: string }[] {
  const diaSemana = fecha.getDay();
  const turnos: { hora: string; esTurnoSecundario: boolean; motivoApertura?: string }[] = [];

  for (const config of configuraciones) {
    // Verificar si el periodo aplica para este día
    if (!config.dias_semana.includes(diaSemana) || !config.activo) {
      continue;
    }

    const [horaInicio, minInicio] = config.hora_inicio.split(":").map(Number);
    const [horaFin, minFin] = config.hora_fin.split(":").map(Number);

    let currentHour = horaInicio;
    let currentMin = minInicio;

    // Manejar periodos que cruzan medianoche
    const finEnMinutos = horaFin * 60 + minFin;
    const inicioEnMinutos = horaInicio * 60 + minInicio;
    const cruzaMedianoche = finEnMinutos <= inicioEnMinutos;

    while (true) {
      const currentEnMinutos = currentHour * 60 + currentMin;
      
      // Verificar si hemos llegado al final del periodo
      if (cruzaMedianoche) {
        if (currentHour >= horaFin && currentHour < horaInicio && currentEnMinutos >= finEnMinutos) {
          break;
        }
      } else {
        if (currentEnMinutos >= finEnMinutos) {
          break;
        }
      }

      const horaFormateada = `${currentHour.toString().padStart(2, "0")}:${currentMin.toString().padStart(2, "0")}`;
      const esTurnoPrimario = currentMin % config.intervalo_base_minutos === 0;

      if (esTurnoPrimario) {
        // Turno primario - siempre se añade
        turnos.push({
          hora: horaFormateada,
          esTurnoSecundario: false,
        });
      } else {
        // Turno secundario - solo se añade si el turno primario anterior tiene alta ocupación
        const minutosTurnoPrimario = Math.floor(currentMin / config.intervalo_base_minutos) * config.intervalo_base_minutos;
        const horaTurnoPrimario = `${currentHour.toString().padStart(2, "0")}:${minutosTurnoPrimario.toString().padStart(2, "0")}`;
        
        const ocupacionPrimario = ocupacionPorHora[horaTurnoPrimario];
        
        if (ocupacionPrimario) {
          const porcentajeOcupacion = (ocupacionPrimario.ocupacion / ocupacionPrimario.capacidadMaxima) * 100;
          
          if (porcentajeOcupacion >= config.umbral_apertura_secundario) {
            turnos.push({
              hora: horaFormateada,
              esTurnoSecundario: true,
              motivoApertura: `Alta demanda en ${horaTurnoPrimario} (${Math.round(porcentajeOcupacion)}%)`,
            });
          }
        }
      }

      // Avanzar 15 minutos
      currentMin += 15;
      if (currentMin >= 60) {
        currentMin = 0;
        currentHour += 1;
        if (currentHour >= 24) {
          currentHour = 0;
        }
      }
    }
  }

  // Ordenar por hora
  return turnos.sort((a, b) => a.hora.localeCompare(b.hora));
}
