import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DisponibilidadSala {
  fecha: string;
  hora: string;
  sala_id: string;
  sala: string;
  posicion_id: string | null;
  posicion: string | null;
  total_mesas_reservadas: number;
  total_comensales: number;
  total_reservas: number;
  total_mesas_sala: number;
  capacidad_maxima: number;
  mesas_disponibles: number;
  porcentaje_ocupacion: number;
}

export interface DisponibilidadHora {
  hora: string;
  salas: {
    sala_id: string;
    sala_nombre: string;
    total_mesas: number;
    mesas_ocupadas: number;
    mesas_disponibles: number;
    capacidad_maxima: number;
    comensales_actuales: number;
    porcentaje_ocupacion: number;
  }[];
  total_mesas_disponibles: number;
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
      // Obtener todas las salas
      const { data: salas, error: salasError } = await supabase
        .from("salas")
        .select("id, nombre, numero_mesas, capacidad_maxima")
        .eq("activa", true);

      if (salasError) throw salasError;

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
          
          const salasPorHora = salas.map((sala) => {
            const ocupSala = ocupacionHora.filter((o: any) => o.sala_id === sala.id);
            const mesasOcupadas = ocupSala.reduce((sum: number, o: any) => sum + o.total_mesas_reservadas, 0);
            const comensales = ocupSala.reduce((sum: number, o: any) => sum + o.total_comensales, 0);
            const mesasDisponibles = sala.numero_mesas - mesasOcupadas;
            const porcentaje = (comensales / sala.capacidad_maxima) * 100;

            return {
              sala_id: sala.id,
              sala_nombre: sala.nombre,
              total_mesas: sala.numero_mesas,
              mesas_ocupadas: mesasOcupadas,
              mesas_disponibles: mesasDisponibles,
              capacidad_maxima: sala.capacidad_maxima,
              comensales_actuales: comensales,
              porcentaje_ocupacion: porcentaje,
            };
          });

          const totalMesasDisp = salasPorHora.reduce((sum, s) => sum + s.mesas_disponibles, 0);
          const totalCapacidad = salasPorHora.reduce((sum, s) => sum + s.capacidad_maxima, 0);
          const totalComensales = salasPorHora.reduce((sum, s) => sum + s.comensales_actuales, 0);

          horarios.push({
            hora,
            salas: salasPorHora,
            total_mesas_disponibles: totalMesasDisp,
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
        .lte("fecha", fechaFin);
      
      if (error) throw error;
      return data as any[];
    },
    enabled: !!fechaInicio && !!fechaFin,
  });
};

// Hook para verificar disponibilidad específica antes de crear reserva
export const verificarDisponibilidad = async (
  fecha: string,
  hora: string,
  salaId: string,
  posicionId: string | null,
  numeroMesas: number
) => {
  // Obtener info de la sala
  const { data: sala } = await supabase
    .from("salas")
    .select("numero_mesas")
    .eq("id", salaId)
    .single();

  if (!sala) throw new Error("Sala no encontrada");

  // Obtener ocupación actual
  const { data: ocupacion } = await supabase
    .from("ocupacion_diaria" as any)
    .select("total_mesas_reservadas")
    .eq("fecha", fecha)
    .eq("hora", hora)
    .eq("sala_id", salaId)
    .eq("posicion_sala_id", posicionId)
    .maybeSingle();

  const mesasOcupadas = (ocupacion as any)?.total_mesas_reservadas || 0;
  const mesasDisponibles = sala.numero_mesas - mesasOcupadas;

  return {
    disponible: mesasDisponibles >= numeroMesas,
    mesasDisponibles,
    mesasOcupadas,
    totalMesas: sala.numero_mesas,
  };
};
