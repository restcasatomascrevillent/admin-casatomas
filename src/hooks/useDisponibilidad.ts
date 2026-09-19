import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ConfiguracionTurno } from "./useConfiguracionTurnos";

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

export interface TurnoDinamico {
  hora: string;
  disponible: boolean;
  capacidadDisponible: number;
  capacidadMaxima: number;
  comensalesActuales: number;
  esTurnoSecundario: boolean;
  motivoApertura?: string;
  porcentajeOcupacion: number;
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
          
          const salasPorHora = espacios.map((espacio: any) => {
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

          const capacidadTotalDisp = salasPorHora.reduce((sum: number, s: any) => sum + s.capacidad_disponible, 0);
          const totalCapacidad = salasPorHora.reduce((sum: number, s: any) => sum + s.capacidad_maxima, 0);
          const totalComensales = salasPorHora.reduce((sum: number, s: any) => sum + s.comensales_actuales, 0);

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

// Hora que separa el turno de comida del de cena.
// IMPORTANTE: debe coincidir con el trigger `trg_validar_capacidad` de la base de datos
// (función `validar_capacidad_reserva`, que usa `NEW.hora < '17:00:00'`). Si se cambia
// aquí sin cambiarlo allí, el panel dirá que hay hueco donde la base de datos lo rechaza.
export const HORA_CORTE_TURNO = "17:00";

// Estados que ocupan plaza. Mismo criterio que el trigger `trg_validar_capacidad`.
const ESTADOS_QUE_OCUPAN = ["pendiente", "verificada", "confirmada"];

export interface AforoTurno {
  disponible: boolean;
  capacidadMaxima: number;
  comensalesActuales: number;
  capacidadDisponible: number;
  esComida: boolean;
  mensaje: string;
}

/**
 * Verifica el aforo del turno (comida/cena) de una fecha, replicando exactamente la
 * regla que aplica el trigger `trg_validar_capacidad` en producción: suma de comensales
 * de las reservas del mismo turno frente a la suma de `capacidad_maxima` de los espacios
 * activos.
 *
 * Es una comprobación previa para dar feedback en el formulario: la autoridad sigue
 * siendo la base de datos, que además usa un advisory lock para evitar condiciones de
 * carrera. Por eso el INSERT puede fallar aunque esta función diga que hay hueco.
 */
export const verificarAforoTurno = async (
  fecha: string,
  hora: string,
  comensales: number
): Promise<AforoTurno> => {
  const esComida = hora < HORA_CORTE_TURNO;

  const [{ data: espacios, error: espaciosError }, { data: reservas, error: reservasError }] =
    await Promise.all([
      supabase
        .from("espacios_reserva" as any)
        .select("capacidad_maxima")
        .eq("activa", true),
      supabase
        .from("reservas" as any)
        .select("hora, numero_comensales")
        .eq("fecha", fecha)
        .in("estado", ESTADOS_QUE_OCUPAN),
    ]);

  if (espaciosError) throw espaciosError;
  if (reservasError) throw reservasError;

  const capacidadMaxima = (espacios ?? []).reduce(
    (acc: number, espacio: any) => acc + (espacio.capacidad_maxima || 0),
    0
  );

  const comensalesActuales = (reservas ?? [])
    .filter((reserva: any) => (reserva.hora < HORA_CORTE_TURNO) === esComida)
    .reduce((acc: number, reserva: any) => acc + (reserva.numero_comensales || 0), 0);

  const capacidadDisponible = Math.max(0, capacidadMaxima - comensalesActuales);
  const disponible = comensalesActuales + comensales <= capacidadMaxima;
  const turno = esComida ? "comida" : "cena";

  return {
    disponible,
    capacidadMaxima,
    comensalesActuales,
    capacidadDisponible,
    esComida,
    mensaje: disponible
      ? `Quedan ${capacidadDisponible} plazas en el turno de ${turno} (${comensalesActuales}/${capacidadMaxima} ocupadas)`
      : `Aforo superado en el turno de ${turno}: quedan ${capacidadDisponible} plazas de ${capacidadMaxima} y se piden ${comensales}`,
  };
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
    throw new Error("Sala/Espacio no encontrado");
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

// Función para obtener configuración de turnos
const obtenerConfiguracionTurnos = async (espacioId: string | null): Promise<ConfiguracionTurno[]> => {
  const { data, error } = await supabase
    .from("configuracion_turnos")
    .select("*")
    .eq("activo", true)
    .order("hora_inicio", { ascending: true });
  
  if (error) throw error;
  if (!data) return [];
  
  // Cast manual ya que la tabla no está en los types generados aún
  const configuraciones = data as unknown as ConfiguracionTurno[];
  
  // Priorizar configuraciones específicas sobre globales
  if (espacioId) {
    const especificas = configuraciones.filter(c => c.espacio_id === espacioId);
    const globales = configuraciones.filter(c => c.espacio_id === null);
    return especificas.length > 0 ? especificas : globales;
  }
  
  return configuraciones.filter(c => c.espacio_id === null);
};

// Nueva función para generar turnos dinámicos
export const generarTurnosDinamicos = async (
  fecha: string,
  salaId: string,
  diaSemana: number
): Promise<TurnoDinamico[]> => {
  // Obtener configuración de turnos
  const configuraciones = await obtenerConfiguracionTurnos(salaId);
  
  // Obtener capacidad del espacio
  const { data: sala } = await supabase
    .from("espacios_reserva" as any)
    .select("capacidad_maxima")
    .eq("id", salaId)
    .single() as any;

  if (!sala) throw new Error("Sala no encontrada");

  const capacidadMaxima = sala.capacidad_maxima;
  const turnos: TurnoDinamico[] = [];

  // Si no hay configuración, usar valores por defecto
  if (!configuraciones || configuraciones.length === 0) {
    const turnosPorDefecto = ["13:00", "15:00", "20:30", "22:00"];
    for (const hora of turnosPorDefecto) {
      const ocupacion = await verificarCapacidadDisponible(fecha, hora, salaId, capacidadMaxima);
      turnos.push({
        hora,
        disponible: ocupacion.disponible,
        capacidadDisponible: ocupacion.capacidadDisponible,
        capacidadMaxima: ocupacion.capacidadMaxima,
        comensalesActuales: ocupacion.comensalesActuales,
        esTurnoSecundario: false,
        porcentajeOcupacion: (ocupacion.comensalesActuales / ocupacion.capacidadMaxima) * 100,
      });
    }
    return turnos;
  }

  // Procesar cada configuración de periodo
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

    // Cache para ocupación de turnos primarios (para decidir si abrir secundarios)
    const ocupacionTurnosPrimarios: Record<string, number> = {};
    // Set para rastrear qué turnos primarios deben ocultarse
    const turnosPrimariosAOcultar = new Set<string>();

    // Primera pasada: generar todos los turnos primarios y obtener su ocupación
    let tempHour = currentHour;
    let tempMin = currentMin;

    while (true) {
      const tempEnMinutos = tempHour * 60 + tempMin;
      
      if (cruzaMedianoche) {
        if (tempHour >= horaFin && tempHour < horaInicio && tempEnMinutos >= finEnMinutos) break;
      } else {
        if (tempEnMinutos >= finEnMinutos) break;
      }

      const esTurnoPrimario = tempMin % config.intervalo_base_minutos === 0;
      
      if (esTurnoPrimario) {
        const horaFormateada = `${tempHour.toString().padStart(2, "0")}:${tempMin.toString().padStart(2, "0")}`;
        const ocupacion = await verificarCapacidadDisponible(fecha, horaFormateada, salaId, capacidadMaxima);
        const porcentaje = (ocupacion.comensalesActuales / capacidadMaxima) * 100;
        ocupacionTurnosPrimarios[horaFormateada] = porcentaje;
        
        // Si la configuración indica ocultar primarios y la ocupación supera el umbral
        if (config.ocultar_primario_si_secundario && porcentaje >= config.umbral_apertura_secundario) {
          turnosPrimariosAOcultar.add(horaFormateada);
        }
      }

      tempMin += 15;
      if (tempMin >= 60) {
        tempMin = 0;
        tempHour += 1;
        if (tempHour >= 24) tempHour = 0;
      }
    }

    // Segunda pasada: generar turnos incluyendo secundarios si aplica
    while (true) {
      const currentEnMinutos = currentHour * 60 + currentMin;
      
      if (cruzaMedianoche) {
        if (currentHour >= horaFin && currentHour < horaInicio && currentEnMinutos >= finEnMinutos) break;
      } else {
        if (currentEnMinutos >= finEnMinutos) break;
      }

      const horaFormateada = `${currentHour.toString().padStart(2, "0")}:${currentMin.toString().padStart(2, "0")}`;
      const esTurnoPrimario = currentMin % config.intervalo_base_minutos === 0;

      if (esTurnoPrimario) {
        // Turno primario - solo se añade si no está en la lista de ocultos
        if (!turnosPrimariosAOcultar.has(horaFormateada)) {
          const ocupacion = await verificarCapacidadDisponible(fecha, horaFormateada, salaId, capacidadMaxima);
          
          turnos.push({
            hora: horaFormateada,
            disponible: ocupacion.disponible,
            capacidadDisponible: ocupacion.capacidadDisponible,
            capacidadMaxima: ocupacion.capacidadMaxima,
            comensalesActuales: ocupacion.comensalesActuales,
            esTurnoSecundario: false,
            porcentajeOcupacion: (ocupacion.comensalesActuales / ocupacion.capacidadMaxima) * 100,
          });
        }
      } else {
        // Turno secundario - solo se añade si el turno primario anterior tiene alta ocupación
        const minutosTurnoPrimario = Math.floor(currentMin / config.intervalo_base_minutos) * config.intervalo_base_minutos;
        const horaTurnoPrimario = `${currentHour.toString().padStart(2, "0")}:${minutosTurnoPrimario.toString().padStart(2, "0")}`;
        
        const ocupacionPrimario = ocupacionTurnosPrimarios[horaTurnoPrimario];
        
        if (ocupacionPrimario !== undefined && ocupacionPrimario >= config.umbral_apertura_secundario) {
          const ocupacion = await verificarCapacidadDisponible(fecha, horaFormateada, salaId, capacidadMaxima);
          
          turnos.push({
            hora: horaFormateada,
            disponible: ocupacion.disponible,
            capacidadDisponible: ocupacion.capacidadDisponible,
            capacidadMaxima: ocupacion.capacidadMaxima,
            comensalesActuales: ocupacion.comensalesActuales,
            esTurnoSecundario: true,
            motivoApertura: `Alta demanda en ${horaTurnoPrimario} (${Math.round(ocupacionPrimario)}%)`,
            porcentajeOcupacion: (ocupacion.comensalesActuales / ocupacion.capacidadMaxima) * 100,
          });
        }
      }

      // Avanzar 15 minutos
      currentMin += 15;
      if (currentMin >= 60) {
        currentMin = 0;
        currentHour += 1;
        if (currentHour >= 24) currentHour = 0;
      }
    }
  }

  // Ordenar por hora y eliminar duplicados
  const turnosUnicos = turnos.reduce((acc, turno) => {
    if (!acc.find(t => t.hora === turno.hora)) {
      acc.push(turno);
    }
    return acc;
  }, [] as TurnoDinamico[]);

  return turnosUnicos.sort((a, b) => a.hora.localeCompare(b.hora));
};

// Obtener horas disponibles para una fecha y sala específica (basado en capacidad)
export const obtenerHorasDisponibles = async (
  fecha: string,
  salaId: string
) => {
  const fechaObj = new Date(fecha);
  const diaSemana = fechaObj.getDay();
  
  const turnos = await generarTurnosDinamicos(fecha, salaId, diaSemana);
  
  return turnos.filter(t => t.disponible).map(t => t.hora);
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
