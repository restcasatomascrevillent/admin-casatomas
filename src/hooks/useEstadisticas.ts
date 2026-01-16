import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, startOfWeek, endOfWeek, subWeeks } from "date-fns";

// Tipos para las estadísticas
export interface EstadisticaDiaria {
  fecha: string;
  hora: string;
  espacio_id: string;
  total_reservas: number;
  total_comensales: number;
  reservas_confirmadas: number;
  reservas_canceladas: number;
  reservas_no_show: number;
  comensales_confirmados: number;
  dia_semana: number;
  turno: string;
}

export interface EstadisticaSemanal {
  semana_inicio: string;
  semana_fin: string;
  espacio_id: string;
  espacio_nombre: string;
  total_reservas: number;
  total_comensales: number;
  reservas_confirmadas: number;
  reservas_canceladas: number;
  reservas_no_show: number;
  comensales_confirmados: number;
  reservas_comida: number;
  reservas_cena: number;
  ocupacion_promedio: number;
  distribucion_dias: Record<string, number>;
}

export interface EstadisticaMensual {
  mes_inicio: string;
  mes_fin: string;
  espacio_id: string;
  espacio_nombre: string;
  total_reservas: number;
  total_comensales: number;
  reservas_confirmadas: number;
  reservas_canceladas: number;
  comensales_confirmados: number;
  ocupacion_promedio: number;
}

// Hook para estadísticas de un período específico
export function useEstadisticasPeriodo(fechaInicio: Date, fechaFin: Date) {
  return useQuery({
    queryKey: ["estadisticas-periodo", format(fechaInicio, "yyyy-MM-dd"), format(fechaFin, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocupacion_diaria")
        .select("*")
        .gte("fecha", format(fechaInicio, "yyyy-MM-dd"))
        .lte("fecha", format(fechaFin, "yyyy-MM-dd"))
        .order("fecha", { ascending: true });

      if (error) throw error;
      return data as EstadisticaDiaria[];
    },
  });
}

// Hook para estadísticas semanales (últimas N semanas)
export function useEstadisticasSemanales(numSemanas: number = 12) {
  return useQuery({
    queryKey: ["estadisticas-semanales", numSemanas],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vista_estadisticas_semanales")
        .select("*")
        .order("semana_inicio", { ascending: false })
        .limit(numSemanas);

      if (error) throw error;
      return data as EstadisticaSemanal[];
    },
  });
}

// Hook para estadísticas mensuales (últimos N meses)
export function useEstadisticasMensuales(numMeses: number = 12) {
  return useQuery({
    queryKey: ["estadisticas-mensuales", numMeses],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vista_estadisticas_mensuales")
        .select("*")
        .order("mes_inicio", { ascending: false })
        .limit(numMeses);

      if (error) throw error;
      return data as EstadisticaMensual[];
    },
  });
}

// Hook para comparar semana actual vs anterior
export function useComparativaSemanal() {
  return useQuery({
    queryKey: ["comparativa-semanal"],
    queryFn: async () => {
      const hoy = new Date();
      const inicioSemanaActual = startOfWeek(hoy, { weekStartsOn: 1 });
      const finSemanaActual = endOfWeek(hoy, { weekStartsOn: 1 });
      const inicioSemanaAnterior = subWeeks(inicioSemanaActual, 1);
      const finSemanaAnterior = subWeeks(finSemanaActual, 1);

      // Obtener datos de ambas semanas
      const { data, error } = await supabase
        .from("ocupacion_diaria")
        .select("*")
        .gte("fecha", format(inicioSemanaAnterior, "yyyy-MM-dd"))
        .lte("fecha", format(finSemanaActual, "yyyy-MM-dd"));

      if (error) throw error;

      const estadisticas = data as EstadisticaDiaria[];
      
      // Separar por semana
      const semanaActual = estadisticas.filter(
        e => e.fecha >= format(inicioSemanaActual, "yyyy-MM-dd")
      );
      const semanaAnterior = estadisticas.filter(
        e => e.fecha < format(inicioSemanaActual, "yyyy-MM-dd")
      );

      // Calcular totales
      const calcularTotales = (data: EstadisticaDiaria[]) => ({
        totalReservas: data.reduce((acc, e) => acc + (e.total_reservas || 0), 0),
        totalComensales: data.reduce((acc, e) => acc + (e.total_comensales || 0), 0),
        reservasConfirmadas: data.reduce((acc, e) => acc + (e.reservas_confirmadas || 0), 0),
        reservasCanceladas: data.reduce((acc, e) => acc + (e.reservas_canceladas || 0), 0),
        reservasNoShow: data.reduce((acc, e) => acc + (e.reservas_no_show || 0), 0),
        comensalesConfirmados: data.reduce((acc, e) => acc + (e.comensales_confirmados || 0), 0),
      });

      const actual = calcularTotales(semanaActual);
      const anterior = calcularTotales(semanaAnterior);

      // Calcular variaciones porcentuales
      const calcularVariacion = (actual: number, anterior: number) => {
        if (anterior === 0) return actual > 0 ? 100 : 0;
        return Math.round(((actual - anterior) / anterior) * 100);
      };

      return {
        semanaActual: {
          inicio: format(inicioSemanaActual, "yyyy-MM-dd"),
          fin: format(finSemanaActual, "yyyy-MM-dd"),
          ...actual,
        },
        semanaAnterior: {
          inicio: format(inicioSemanaAnterior, "yyyy-MM-dd"),
          fin: format(finSemanaAnterior, "yyyy-MM-dd"),
          ...anterior,
        },
        variaciones: {
          reservas: calcularVariacion(actual.totalReservas, anterior.totalReservas),
          comensales: calcularVariacion(actual.totalComensales, anterior.totalComensales),
          confirmadas: calcularVariacion(actual.reservasConfirmadas, anterior.reservasConfirmadas),
          canceladas: calcularVariacion(actual.reservasCanceladas, anterior.reservasCanceladas),
        },
      };
    },
    refetchInterval: 300000, // Refrescar cada 5 minutos
  });
}

// Hook para distribución por día de la semana
export function useDistribucionDiasSemana(numSemanas: number = 4) {
  return useQuery({
    queryKey: ["distribucion-dias", numSemanas],
    queryFn: async () => {
      const fechaInicio = format(subWeeks(new Date(), numSemanas), "yyyy-MM-dd");
      
      const { data, error } = await supabase
        .from("ocupacion_diaria")
        .select("dia_semana, total_reservas, total_comensales")
        .gte("fecha", fechaInicio);

      if (error) throw error;

      // Agrupar por día de la semana
      const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
      const distribucion = DIAS.map((nombre, index) => {
        const datosDia = (data || []).filter(d => d.dia_semana === index);
        return {
          dia: nombre,
          diaSemana: index,
          totalReservas: datosDia.reduce((acc, d) => acc + (d.total_reservas || 0), 0),
          totalComensales: datosDia.reduce((acc, d) => acc + (d.total_comensales || 0), 0),
          promedio: datosDia.length > 0 
            ? Math.round(datosDia.reduce((acc, d) => acc + (d.total_reservas || 0), 0) / numSemanas)
            : 0,
        };
      });

      return distribucion;
    },
  });
}

// Hook para distribución comida vs cena
export function useDistribucionTurnos(numSemanas: number = 4) {
  return useQuery({
    queryKey: ["distribucion-turnos", numSemanas],
    queryFn: async () => {
      const fechaInicio = format(subWeeks(new Date(), numSemanas), "yyyy-MM-dd");
      
      const { data, error } = await supabase
        .from("ocupacion_diaria")
        .select("turno, total_reservas, total_comensales")
        .gte("fecha", fechaInicio);

      if (error) throw error;

      const comida = (data || []).filter(d => d.turno === "comida");
      const cena = (data || []).filter(d => d.turno === "cena");

      return {
        comida: {
          totalReservas: comida.reduce((acc, d) => acc + (d.total_reservas || 0), 0),
          totalComensales: comida.reduce((acc, d) => acc + (d.total_comensales || 0), 0),
        },
        cena: {
          totalReservas: cena.reduce((acc, d) => acc + (d.total_reservas || 0), 0),
          totalComensales: cena.reduce((acc, d) => acc + (d.total_comensales || 0), 0),
        },
      };
    },
  });
}
