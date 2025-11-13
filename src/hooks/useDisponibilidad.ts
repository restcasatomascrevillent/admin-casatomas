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

export const useDisponibilidadPorFecha = (fecha: string) => {
  return useQuery({
    queryKey: ["disponibilidad", fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vista_ocupacion")
        .select("*")
        .eq("fecha", fecha);
      
      if (error) throw error;
      return data as DisponibilidadSala[];
    },
    enabled: !!fecha,
  });
};

export const useDisponibilidadRango = (fechaInicio: string, fechaFin: string) => {
  return useQuery({
    queryKey: ["disponibilidad-rango", fechaInicio, fechaFin],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vista_ocupacion")
        .select("*")
        .gte("fecha", fechaInicio)
        .lte("fecha", fechaFin);
      
      if (error) throw error;
      return data as DisponibilidadSala[];
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
    .from("ocupacion_diaria")
    .select("total_mesas_reservadas")
    .eq("fecha", fecha)
    .eq("hora", hora)
    .eq("sala_id", salaId)
    .eq("posicion_sala_id", posicionId)
    .maybeSingle();

  const mesasOcupadas = ocupacion?.total_mesas_reservadas || 0;
  const mesasDisponibles = sala.numero_mesas - mesasOcupadas;

  return {
    disponible: mesasDisponibles >= numeroMesas,
    mesasDisponibles,
    mesasOcupadas,
    totalMesas: sala.numero_mesas,
  };
};
