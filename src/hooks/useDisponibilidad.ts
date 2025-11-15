import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DisponibilidadSala {
  fecha: string;
  hora: string;
  sala_id: string;
  sala: string;
  posicion_id: string | null;
  posicion: string | null;
  total_comensales: number;
  total_reservas: number;
  capacidad_maxima: number;
  capacidad_disponible: number;
  porcentaje_ocupacion: number;
}

export interface DisponibilidadHora {
  hora: string;
  salas: {
    sala_id: string;
    sala_nombre: string;
    capacidad_maxima: number;
    comensales_actuales: number;
    capacidad_disponible: number;
    porcentaje_ocupacion: number;
  }[];
  capacidad_total_disponible: number;
  porcentaje_ocupacion_global: number;
}

export const useDisponibilidadPorFecha = (fecha: string) => {
  return useQuery({
    queryKey: ["disponibilidad", fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vista_ocupacion" as any)
        .select("*")
        .eq("fecha", fecha)
        .order("hora", { ascending: true });
      
      if (error) throw error;
      return data as any[];
    },
    enabled: !!fecha,
  });
};

export const useDisponibilidadDetalladaPorFecha = (fecha: string) => {
  return useQuery({
    queryKey: ["disponibilidad-detallada", fecha],
    queryFn: async () => {
      // Obtener todos los espacios de reserva
      const { data: espacios, error: espaciosError } = await supabase
        .from("espacios_reserva" as any)
        .select("id, nombre, capacidad_maxima")
        .eq("activa", true) as any;

      if (espaciosError) throw espaciosError;

      // Obtener ocupación del día
      const { data: ocupacion, error: ocupacionError } = await supabase
        .from("vista_ocupacion" as any)
        .select("*")
        .eq("fecha", fecha)
        .order("hora", { ascending: true });

      if (ocupacionError) throw ocupacionError;

      // Generar horarios cada 30 minutos de 8:00 a 23:30
      const horarios: DisponibilidadHora[] = [];
      for (let h = 8; h <= 23; h++) {
        for (let m = 0; m < 60; m += 30) {
          const hora = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
          
          const ocupacionHora = ocupacion?.filter((o: any) => o.hora === hora) || [];
          
          const salasPorHora = espacios.map((espacio) => {
            const ocupEspacio = ocupacionHora.filter((o: any) => o.espacio_id === espacio.id);
            const comensales = ocupEspacio.reduce((sum: number, o: any) => sum + o.total_comensales, 0);
            const capacidadDisponible = Math.max(0, espacio.capacidad_maxima - comensales);
            const porcentaje = (comensales / espacio.capacidad_maxima) * 100;

            return {
              sala_id: espacio.id,
              sala_nombre: espacio.nombre,
              capacidad_maxima: espacio.capacidad_maxima,
              comensales_actuales: comensales,
              capacidad_disponible: capacidadDisponible,
              porcentaje_ocupacion: porcentaje,
            };
          });

          const capacidadTotalDisp = salasPorHora.reduce((sum, s) => sum + s.capacidad_disponible, 0);
          const totalCapacidad = salasPorHora.reduce((sum, s) => sum + s.capacidad_maxima, 0);
          const totalComensales = salasPorHora.reduce((sum, s) => sum + s.comensales_actuales, 0);

          horarios.push({
            hora,
            salas: salasPorHora,
            capacidad_total_disponible: capacidadTotalDisp,
            porcentaje_ocupacion_global: totalCapacidad > 0 ? (totalComensales / totalCapacidad) * 100 : 0,
          });
        }
      }

      return horarios;
    },
    enabled: !!fecha,
  });
};

export const useDisponibilidadRango = (fechaInicio: string, fechaFin: string) => {
  return useQuery({
    queryKey: ["disponibilidad-rango", fechaInicio, fechaFin],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vista_ocupacion" as any)
        .select("*")
        .gte("fecha", fechaInicio)
        .lte("fecha", fechaFin)
        .order("fecha", { ascending: true })
        .order("hora", { ascending: true });
      
      if (error) throw error;
      return data as any[];
    },
    enabled: !!fechaInicio && !!fechaFin,
  });
};

// Hook para verificar disponibilidad específica por espacio (basado en capacidad)
export const verificarDisponibilidadSala = async (
  fecha: string,
  hora: string,
  salaId: string
) => {
  // Obtener info del espacio/sala
  const { data: sala } = await supabase
    .from("espacios_reserva" as any)
    .select("capacidad_maxima")
    .eq("id", salaId)
    .single() as any;

  if (!sala) {
    // Intenta buscar en salas si no lo encuentra en espacios
    const { data: salaData } = await supabase
      .from("salas" as any)
      .select("capacidad_maxima")
      .eq("id", salaId)
      .single() as any;
    
    if (!salaData) throw new Error("Sala/Espacio no encontrado");
    
    return verificarCapacidadDisponible(fecha, hora, salaId, salaData.capacidad_maxima);
  }

  return verificarCapacidadDisponible(fecha, hora, salaId, sala.capacidad_maxima);
};

// Función auxiliar para verificar capacidad disponible
const verificarCapacidadDisponible = async (
  fecha: string,
  hora: string,
  espacioId: string,
  capacidadMaxima: number
) => {
  // Obtener ocupación actual
  const { data: ocupacion } = await supabase
    .from("ocupacion_diaria" as any)
    .select("total_comensales")
    .eq("fecha", fecha)
    .eq("hora", hora)
    .eq("espacio_id", espacioId)
    .maybeSingle();

  const comensalesActuales = (ocupacion as any)?.total_comensales || 0;
  const capacidadDisponible = Math.max(0, capacidadMaxima - comensalesActuales);

  return {
    disponible: capacidadDisponible > 0,
    capacidadDisponible,
    capacidadMaxima,
    comensalesActuales,
    mensaje: capacidadDisponible > 0
      ? `Hay capacidad para ${capacidadDisponible} comensales más`
      : "No hay capacidad disponible en este horario",
  };
};

// Obtener horas disponibles para una fecha y sala específica (basado en capacidad)
export const obtenerHorasDisponibles = async (
  fecha: string,
  salaId: string
) => {
  const horasDisponibles: string[] = [];
  
  // Generar todas las horas posibles (8:00 - 23:30)
  for (let h = 8; h <= 23; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hora = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
      
      const disponibilidad = await verificarDisponibilidadSala(
        fecha,
        hora,
        salaId
      );
      
      if (disponibilidad.disponible) {
        horasDisponibles.push(hora);
      }
    }
  }
  
  return horasDisponibles;
};

// Mantener compatibilidad con código existente (espacio)
export const verificarDisponibilidad = async (
  fecha: string,
  hora: string,
  espacioId: string,
  posicionId: string | null = null
) => {
  // Delegar a la función principal que ahora usa capacidad en lugar de mesas
  return verificarDisponibilidadSala(fecha, hora, espacioId);
};