import { supabase } from "@/integrations/supabase/client";

type EstadoTurno = "programado" | "activo" | "completado" | "cancelado";

interface TurnoInsert {
  trabajador_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: EstadoTurno;
  notas: string;
}

export const generarTurnosManualmente = async () => {
  const turnos: TurnoInsert[] = [
    // Juan (camarero) - Semana actual
    { trabajador_id: '6b5883f4-703b-41a6-b30c-61acff942385', fecha: '2025-01-13', hora_inicio: '09:00', hora_fin: '17:00', estado: 'completado', notas: 'Turno de mañana' },
    { trabajador_id: '6b5883f4-703b-41a6-b30c-61acff942385', fecha: '2025-01-14', hora_inicio: '09:00', hora_fin: '17:00', estado: 'completado', notas: 'Turno de mañana' },
    { trabajador_id: '6b5883f4-703b-41a6-b30c-61acff942385', fecha: '2025-01-15', hora_inicio: '13:00', hora_fin: '21:00', estado: 'completado', notas: 'Turno de tarde' },
    { trabajador_id: '6b5883f4-703b-41a6-b30c-61acff942385', fecha: '2025-01-16', hora_inicio: '13:00', hora_fin: '21:00', estado: 'activo', notas: 'Turno de tarde' },
    { trabajador_id: '6b5883f4-703b-41a6-b30c-61acff942385', fecha: '2025-01-17', hora_inicio: '09:00', hora_fin: '17:00', estado: 'programado', notas: 'Turno de mañana' },
    { trabajador_id: '6b5883f4-703b-41a6-b30c-61acff942385', fecha: '2025-01-18', hora_inicio: '13:00', hora_fin: '21:00', estado: 'programado', notas: 'Turno de tarde' },

    // María (camarero) - Semana actual
    { trabajador_id: 'e3d44e33-9f80-4bee-866c-d7cdd2255218', fecha: '2025-01-13', hora_inicio: '13:00', hora_fin: '21:00', estado: 'completado', notas: 'Turno de tarde' },
    { trabajador_id: 'e3d44e33-9f80-4bee-866c-d7cdd2255218', fecha: '2025-01-14', hora_inicio: '13:00', hora_fin: '21:00', estado: 'completado', notas: 'Turno de tarde' },
    { trabajador_id: 'e3d44e33-9f80-4bee-866c-d7cdd2255218', fecha: '2025-01-15', hora_inicio: '09:00', hora_fin: '17:00', estado: 'completado', notas: 'Turno de mañana' },
    { trabajador_id: 'e3d44e33-9f80-4bee-866c-d7cdd2255218', fecha: '2025-01-16', hora_inicio: '09:00', hora_fin: '17:00', estado: 'activo', notas: 'Turno de mañana' },
    { trabajador_id: 'e3d44e33-9f80-4bee-866c-d7cdd2255218', fecha: '2025-01-17', hora_inicio: '13:00', hora_fin: '21:00', estado: 'programado', notas: 'Turno de tarde' },
    { trabajador_id: 'e3d44e33-9f80-4bee-866c-d7cdd2255218', fecha: '2025-01-19', hora_inicio: '09:00', hora_fin: '17:00', estado: 'programado', notas: 'Turno de domingo' },

    // Ana (ayudante_camarero) - Semana actual
    { trabajador_id: '130fafdc-567e-4280-a5fa-b4eade02a489', fecha: '2025-01-13', hora_inicio: '10:00', hora_fin: '18:00', estado: 'completado', notas: 'Apoyo sala' },
    { trabajador_id: '130fafdc-567e-4280-a5fa-b4eade02a489', fecha: '2025-01-15', hora_inicio: '14:00', hora_fin: '22:00', estado: 'completado', notas: 'Apoyo noche' },
    { trabajador_id: '130fafdc-567e-4280-a5fa-b4eade02a489', fecha: '2025-01-16', hora_inicio: '14:00', hora_fin: '22:00', estado: 'activo', notas: 'Apoyo noche' },
    { trabajador_id: '130fafdc-567e-4280-a5fa-b4eade02a489', fecha: '2025-01-18', hora_inicio: '10:00', hora_fin: '18:00', estado: 'programado', notas: 'Apoyo sala' },
    { trabajador_id: '130fafdc-567e-4280-a5fa-b4eade02a489', fecha: '2025-01-19', hora_inicio: '14:00', hora_fin: '22:00', estado: 'programado', notas: 'Apoyo fin de semana' },

    // Carlos (gerente) - Semana actual
    { trabajador_id: '25fd5749-abcd-4bef-911c-cf8954e99012', fecha: '2025-01-13', hora_inicio: '08:00', hora_fin: '16:00', estado: 'completado', notas: 'Supervisión general' },
    { trabajador_id: '25fd5749-abcd-4bef-911c-cf8954e99012', fecha: '2025-01-14', hora_inicio: '08:00', hora_fin: '16:00', estado: 'completado', notas: 'Supervisión general' },
    { trabajador_id: '25fd5749-abcd-4bef-911c-cf8954e99012', fecha: '2025-01-15', hora_inicio: '08:00', hora_fin: '16:00', estado: 'completado', notas: 'Supervisión general' },
    { trabajador_id: '25fd5749-abcd-4bef-911c-cf8954e99012', fecha: '2025-01-16', hora_inicio: '08:00', hora_fin: '16:00', estado: 'activo', notas: 'Supervisión general' },
    { trabajador_id: '25fd5749-abcd-4bef-911c-cf8954e99012', fecha: '2025-01-17', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Supervisión general' },

    // Diego (cocinero) - Semana actual
    { trabajador_id: '0c722ac0-e26a-491c-9e3b-be6da497ce08', fecha: '2025-01-13', hora_inicio: '08:00', hora_fin: '16:00', estado: 'completado', notas: 'Preparación comidas' },
    { trabajador_id: '0c722ac0-e26a-491c-9e3b-be6da497ce08', fecha: '2025-01-14', hora_inicio: '08:00', hora_fin: '16:00', estado: 'completado', notas: 'Preparación comidas' },
    { trabajador_id: '0c722ac0-e26a-491c-9e3b-be6da497ce08', fecha: '2025-01-15', hora_inicio: '14:00', hora_fin: '22:00', estado: 'completado', notas: 'Cenas' },
    { trabajador_id: '0c722ac0-e26a-491c-9e3b-be6da497ce08', fecha: '2025-01-16', hora_inicio: '14:00', hora_fin: '22:00', estado: 'activo', notas: 'Cenas' },
    { trabajador_id: '0c722ac0-e26a-491c-9e3b-be6da497ce08', fecha: '2025-01-17', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Preparación comidas' },
    { trabajador_id: '0c722ac0-e26a-491c-9e3b-be6da497ce08', fecha: '2025-01-18', hora_inicio: '14:00', hora_fin: '22:00', estado: 'programado', notas: 'Cenas fin de semana' },

    // Pedro (cocinero) - Semana actual
    { trabajador_id: 'c4e278cb-991b-4b48-b624-683190a10ccc', fecha: '2025-01-13', hora_inicio: '14:00', hora_fin: '22:00', estado: 'completado', notas: 'Turno noche' },
    { trabajador_id: 'c4e278cb-991b-4b48-b624-683190a10ccc', fecha: '2025-01-14', hora_inicio: '14:00', hora_fin: '22:00', estado: 'completado', notas: 'Turno noche' },
    { trabajador_id: 'c4e278cb-991b-4b48-b624-683190a10ccc', fecha: '2025-01-15', hora_inicio: '08:00', hora_fin: '16:00', estado: 'completado', notas: 'Turno día' },
    { trabajador_id: 'c4e278cb-991b-4b48-b624-683190a10ccc', fecha: '2025-01-16', hora_inicio: '08:00', hora_fin: '16:00', estado: 'activo', notas: 'Turno día' },
    { trabajador_id: 'c4e278cb-991b-4b48-b624-683190a10ccc', fecha: '2025-01-17', hora_inicio: '14:00', hora_fin: '22:00', estado: 'programado', notas: 'Turno noche' },
    { trabajador_id: 'c4e278cb-991b-4b48-b624-683190a10ccc', fecha: '2025-01-19', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Turno domingo' },

    // Laura (ayudante_cocina) - Semana actual
    { trabajador_id: '52bbb97f-51a8-4a92-9edd-d9f8231b001b', fecha: '2025-01-13', hora_inicio: '09:00', hora_fin: '17:00', estado: 'completado', notas: 'Preparación ingredientes' },
    { trabajador_id: '52bbb97f-51a8-4a92-9edd-d9f8231b001b', fecha: '2025-01-15', hora_inicio: '09:00', hora_fin: '17:00', estado: 'completado', notas: 'Preparación ingredientes' },
    { trabajador_id: '52bbb97f-51a8-4a92-9edd-d9f8231b001b', fecha: '2025-01-16', hora_inicio: '15:00', hora_fin: '23:00', estado: 'activo', notas: 'Apoyo cenas' },
    { trabajador_id: '52bbb97f-51a8-4a92-9edd-d9f8231b001b', fecha: '2025-01-18', hora_inicio: '09:00', hora_fin: '17:00', estado: 'programado', notas: 'Preparación ingredientes' },
    { trabajador_id: '52bbb97f-51a8-4a92-9edd-d9f8231b001b', fecha: '2025-01-19', hora_inicio: '15:00', hora_fin: '23:00', estado: 'programado', notas: 'Apoyo cenas' },

    // Carmen (recepcionista) - Semana actual
    { trabajador_id: '2453b536-5e06-4184-816f-184568c6ab0c', fecha: '2025-01-13', hora_inicio: '10:00', hora_fin: '18:00', estado: 'completado', notas: 'Atención al cliente' },
    { trabajador_id: '2453b536-5e06-4184-816f-184568c6ab0c', fecha: '2025-01-14', hora_inicio: '10:00', hora_fin: '18:00', estado: 'completado', notas: 'Atención al cliente' },
    { trabajador_id: '2453b536-5e06-4184-816f-184568c6ab0c', fecha: '2025-01-15', hora_inicio: '10:00', hora_fin: '18:00', estado: 'completado', notas: 'Atención al cliente' },
    { trabajador_id: '2453b536-5e06-4184-816f-184568c6ab0c', fecha: '2025-01-16', hora_inicio: '10:00', hora_fin: '18:00', estado: 'activo', notas: 'Atención al cliente' },
    { trabajador_id: '2453b536-5e06-4184-816f-184568c6ab0c', fecha: '2025-01-17', hora_inicio: '10:00', hora_fin: '18:00', estado: 'programado', notas: 'Atención al cliente' },
    { trabajador_id: '2453b536-5e06-4184-816f-184568c6ab0c', fecha: '2025-01-18', hora_inicio: '10:00', hora_fin: '18:00', estado: 'programado', notas: 'Atención al cliente' },

    // Miguel (limpieza) - Semana actual
    { trabajador_id: '2b73c8fd-d452-4450-a711-1ae58d2749ca', fecha: '2025-01-14', hora_inicio: '07:00', hora_fin: '11:00', estado: 'completado', notas: 'Limpieza matinal' },
    { trabajador_id: '2b73c8fd-d452-4450-a711-1ae58d2749ca', fecha: '2025-01-15', hora_inicio: '07:00', hora_fin: '11:00', estado: 'completado', notas: 'Limpieza matinal' },
    { trabajador_id: '2b73c8fd-d452-4450-a711-1ae58d2749ca', fecha: '2025-01-16', hora_inicio: '07:00', hora_fin: '11:00', estado: 'activo', notas: 'Limpieza matinal' },
    { trabajador_id: '2b73c8fd-d452-4450-a711-1ae58d2749ca', fecha: '2025-01-17', hora_inicio: '07:00', hora_fin: '11:00', estado: 'programado', notas: 'Limpieza matinal' },
    { trabajador_id: '2b73c8fd-d452-4450-a711-1ae58d2749ca', fecha: '2025-01-19', hora_inicio: '07:00', hora_fin: '11:00', estado: 'programado', notas: 'Limpieza fin de semana' },

    // Próxima semana (20-26 enero)
    
    // Juan - Próxima semana
    { trabajador_id: '6b5883f4-703b-41a6-b30c-61acff942385', fecha: '2025-01-20', hora_inicio: '09:00', hora_fin: '17:00', estado: 'programado', notas: 'Turno de mañana' },
    { trabajador_id: '6b5883f4-703b-41a6-b30c-61acff942385', fecha: '2025-01-21', hora_inicio: '09:00', hora_fin: '17:00', estado: 'programado', notas: 'Turno de mañana' },
    { trabajador_id: '6b5883f4-703b-41a6-b30c-61acff942385', fecha: '2025-01-22', hora_inicio: '13:00', hora_fin: '21:00', estado: 'programado', notas: 'Turno de tarde' },
    { trabajador_id: '6b5883f4-703b-41a6-b30c-61acff942385', fecha: '2025-01-23', hora_inicio: '13:00', hora_fin: '21:00', estado: 'programado', notas: 'Turno de tarde' },
    { trabajador_id: '6b5883f4-703b-41a6-b30c-61acff942385', fecha: '2025-01-24', hora_inicio: '09:00', hora_fin: '17:00', estado: 'programado', notas: 'Turno de mañana' },

    // María - Próxima semana
    { trabajador_id: 'e3d44e33-9f80-4bee-866c-d7cdd2255218', fecha: '2025-01-20', hora_inicio: '13:00', hora_fin: '21:00', estado: 'programado', notas: 'Turno de tarde' },
    { trabajador_id: 'e3d44e33-9f80-4bee-866c-d7cdd2255218', fecha: '2025-01-21', hora_inicio: '13:00', hora_fin: '21:00', estado: 'programado', notas: 'Turno de tarde' },
    { trabajador_id: 'e3d44e33-9f80-4bee-866c-d7cdd2255218', fecha: '2025-01-22', hora_inicio: '09:00', hora_fin: '17:00', estado: 'programado', notas: 'Turno de mañana' },
    { trabajador_id: 'e3d44e33-9f80-4bee-866c-d7cdd2255218', fecha: '2025-01-23', hora_inicio: '09:00', hora_fin: '17:00', estado: 'programado', notas: 'Turno de mañana' },
    { trabajador_id: 'e3d44e33-9f80-4bee-866c-d7cdd2255218', fecha: '2025-01-25', hora_inicio: '13:00', hora_fin: '21:00', estado: 'programado', notas: 'Turno de tarde' },

    // Ana - Próxima semana
    { trabajador_id: '130fafdc-567e-4280-a5fa-b4eade02a489', fecha: '2025-01-20', hora_inicio: '10:00', hora_fin: '18:00', estado: 'programado', notas: 'Apoyo sala' },
    { trabajador_id: '130fafdc-567e-4280-a5fa-b4eade02a489', fecha: '2025-01-22', hora_inicio: '14:00', hora_fin: '22:00', estado: 'programado', notas: 'Apoyo noche' },
    { trabajador_id: '130fafdc-567e-4280-a5fa-b4eade02a489', fecha: '2025-01-24', hora_inicio: '10:00', hora_fin: '18:00', estado: 'programado', notas: 'Apoyo sala' },
    { trabajador_id: '130fafdc-567e-4280-a5fa-b4eade02a489', fecha: '2025-01-25', hora_inicio: '14:00', hora_fin: '22:00', estado: 'programado', notas: 'Apoyo fin de semana' },

    // Carlos - Próxima semana
    { trabajador_id: '25fd5749-abcd-4bef-911c-cf8954e99012', fecha: '2025-01-20', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Supervisión general' },
    { trabajador_id: '25fd5749-abcd-4bef-911c-cf8954e99012', fecha: '2025-01-21', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Supervisión general' },
    { trabajador_id: '25fd5749-abcd-4bef-911c-cf8954e99012', fecha: '2025-01-22', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Reunión con proveedores' },
    { trabajador_id: '25fd5749-abcd-4bef-911c-cf8954e99012', fecha: '2025-01-23', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Supervisión general' },
    { trabajador_id: '25fd5749-abcd-4bef-911c-cf8954e99012', fecha: '2025-01-24', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Supervisión general' },

    // Diego - Próxima semana
    { trabajador_id: '0c722ac0-e26a-491c-9e3b-be6da497ce08', fecha: '2025-01-20', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Preparación comidas' },
    { trabajador_id: '0c722ac0-e26a-491c-9e3b-be6da497ce08', fecha: '2025-01-21', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Preparación comidas' },
    { trabajador_id: '0c722ac0-e26a-491c-9e3b-be6da497ce08', fecha: '2025-01-22', hora_inicio: '14:00', hora_fin: '22:00', estado: 'programado', notas: 'Cenas' },
    { trabajador_id: '0c722ac0-e26a-491c-9e3b-be6da497ce08', fecha: '2025-01-23', hora_inicio: '14:00', hora_fin: '22:00', estado: 'programado', notas: 'Cenas' },
    { trabajador_id: '0c722ac0-e26a-491c-9e3b-be6da497ce08', fecha: '2025-01-25', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Preparación comidas' },

    // Pedro - Próxima semana
    { trabajador_id: 'c4e278cb-991b-4b48-b624-683190a10ccc', fecha: '2025-01-20', hora_inicio: '14:00', hora_fin: '22:00', estado: 'programado', notas: 'Turno noche' },
    { trabajador_id: 'c4e278cb-991b-4b48-b624-683190a10ccc', fecha: '2025-01-21', hora_inicio: '14:00', hora_fin: '22:00', estado: 'programado', notas: 'Turno noche' },
    { trabajador_id: 'c4e278cb-991b-4b48-b624-683190a10ccc', fecha: '2025-01-22', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Turno día' },
    { trabajador_id: 'c4e278cb-991b-4b48-b624-683190a10ccc', fecha: '2025-01-23', hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado', notas: 'Turno día' },
    { trabajador_id: 'c4e278cb-991b-4b48-b624-683190a10ccc', fecha: '2025-01-26', hora_inicio: '14:00', hora_fin: '22:00', estado: 'programado', notas: 'Turno noche' },

    // Laura - Próxima semana
    { trabajador_id: '52bbb97f-51a8-4a92-9edd-d9f8231b001b', fecha: '2025-01-20', hora_inicio: '09:00', hora_fin: '17:00', estado: 'programado', notas: 'Preparación ingredientes' },
    { trabajador_id: '52bbb97f-51a8-4a92-9edd-d9f8231b001b', fecha: '2025-01-22', hora_inicio: '09:00', hora_fin: '17:00', estado: 'programado', notas: 'Preparación ingredientes' },
    { trabajador_id: '52bbb97f-51a8-4a92-9edd-d9f8231b001b', fecha: '2025-01-24', hora_inicio: '15:00', hora_fin: '23:00', estado: 'programado', notas: 'Apoyo cenas' },
    { trabajador_id: '52bbb97f-51a8-4a92-9edd-d9f8231b001b', fecha: '2025-01-25', hora_inicio: '09:00', hora_fin: '17:00', estado: 'programado', notas: 'Preparación ingredientes' },

    // Carmen - Próxima semana
    { trabajador_id: '2453b536-5e06-4184-816f-184568c6ab0c', fecha: '2025-01-20', hora_inicio: '10:00', hora_fin: '18:00', estado: 'programado', notas: 'Atención al cliente' },
    { trabajador_id: '2453b536-5e06-4184-816f-184568c6ab0c', fecha: '2025-01-21', hora_inicio: '10:00', hora_fin: '18:00', estado: 'programado', notas: 'Atención al cliente' },
    { trabajador_id: '2453b536-5e06-4184-816f-184568c6ab0c', fecha: '2025-01-22', hora_inicio: '10:00', hora_fin: '18:00', estado: 'programado', notas: 'Atención al cliente' },
    { trabajador_id: '2453b536-5e06-4184-816f-184568c6ab0c', fecha: '2025-01-23', hora_inicio: '10:00', hora_fin: '18:00', estado: 'programado', notas: 'Atención al cliente' },
    { trabajador_id: '2453b536-5e06-4184-816f-184568c6ab0c', fecha: '2025-01-24', hora_inicio: '10:00', hora_fin: '18:00', estado: 'programado', notas: 'Atención al cliente' },
    { trabajador_id: '2453b536-5e06-4184-816f-184568c6ab0c', fecha: '2025-01-25', hora_inicio: '10:00', hora_fin: '18:00', estado: 'programado', notas: 'Atención al cliente' },

    // Miguel - Próxima semana
    { trabajador_id: '2b73c8fd-d452-4450-a711-1ae58d2749ca', fecha: '2025-01-21', hora_inicio: '07:00', hora_fin: '11:00', estado: 'programado', notas: 'Limpieza matinal' },
    { trabajador_id: '2b73c8fd-d452-4450-a711-1ae58d2749ca', fecha: '2025-01-22', hora_inicio: '07:00', hora_fin: '11:00', estado: 'programado', notas: 'Limpieza matinal' },
    { trabajador_id: '2b73c8fd-d452-4450-a711-1ae58d2749ca', fecha: '2025-01-23', hora_inicio: '07:00', hora_fin: '11:00', estado: 'programado', notas: 'Limpieza matinal' },
    { trabajador_id: '2b73c8fd-d452-4450-a711-1ae58d2749ca', fecha: '2025-01-24', hora_inicio: '07:00', hora_fin: '11:00', estado: 'programado', notas: 'Limpieza matinal' },
    { trabajador_id: '2b73c8fd-d452-4450-a711-1ae58d2749ca', fecha: '2025-01-26', hora_inicio: '07:00', hora_fin: '11:00', estado: 'programado', notas: 'Limpieza fin de semana' },
  ];

  const { data, error } = await supabase.from('turnos').insert(turnos);
  
  if (error) {
    console.error('Error al insertar turnos:', error);
    throw error;
  }
  
  return data;
};
