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

// IDs de trabajadores activos
const TRABAJADORES = {
  CARLOS_GERENTE: '25fd5749-abcd-4bef-911c-cf8954e99012',
  MARIA_CAMARERA: 'e3d44e33-9f80-4bee-866c-d7cdd2255218',
  JUAN_CAMARERO: '6b5883f4-703b-41a6-b30c-61acff942385',
  PEDRO_COCINERO: 'c4e278cb-991b-4b48-b624-683190a10ccc',
  DIEGO_COCINERO: '0c722ac0-e26a-491c-9e3b-be6da497ce08',
  LAURA_AYUDANTE_COCINA: '52bbb97f-51a8-4a92-9edd-d9f8231b001b',
  ANA_AYUDANTE_CAMARERO: '130fafdc-567e-4280-a5fa-b4eade02a489',
  CARMEN_RECEPCIONISTA: '2453b536-5e06-4184-816f-184568c6ab0c',
  MIGUEL_LIMPIEZA: '2b73c8fd-d452-4450-a711-1ae58d2749ca',
};

// Días festivos especiales (restaurante cerrado o horario reducido)
const FESTIVOS_CERRADO = [
  '2025-12-25', // Navidad
  '2026-01-01', // Año Nuevo
];

const formatDate = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

const getDayOfWeek = (date: Date): number => {
  return date.getDay(); // 0 = domingo, 1 = lunes, ..., 6 = sábado
};

const getWeekNumber = (date: Date): number => {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const diff = date.getTime() - startOfYear.getTime();
  return Math.ceil(diff / (7 * 24 * 60 * 60 * 1000));
};

export const generarTurnosDiciembreEnero = async () => {
  const turnos: TurnoInsert[] = [];
  
  // Período: 1 diciembre 2025 - 31 enero 2026
  const fechaInicio = new Date('2025-12-01');
  const fechaFin = new Date('2026-01-31');
  
  for (let fecha = new Date(fechaInicio); fecha <= fechaFin; fecha.setDate(fecha.getDate() + 1)) {
    const fechaStr = formatDate(fecha);
    const diaSemana = getDayOfWeek(fecha);
    const semana = getWeekNumber(fecha);
    const esSemanaImpar = semana % 2 === 1;
    
    // Saltar días festivos cerrados
    if (FESTIVOS_CERRADO.includes(fechaStr)) {
      continue;
    }
    
    // === GERENTE (Carlos) - Lunes a Viernes 08:00-16:00 ===
    if (diaSemana >= 1 && diaSemana <= 5) {
      turnos.push({
        trabajador_id: TRABAJADORES.CARLOS_GERENTE,
        fecha: fechaStr,
        hora_inicio: '08:00',
        hora_fin: '16:00',
        estado: 'programado',
        notas: 'Supervisión general'
      });
    }
    
    // === COCINEROS (Pedro y Diego) - Rotación ===
    // Semanas impares: Pedro mañana (08-16), Diego tarde (14-22)
    // Semanas pares: Diego mañana (08-16), Pedro tarde (14-22)
    if (diaSemana >= 1 && diaSemana <= 6) { // Lunes a sábado
      if (esSemanaImpar) {
        // Pedro turno mañana
        turnos.push({
          trabajador_id: TRABAJADORES.PEDRO_COCINERO,
          fecha: fechaStr,
          hora_inicio: '08:00',
          hora_fin: '16:00',
          estado: 'programado',
          notas: 'Preparación comidas'
        });
        // Diego turno tarde
        turnos.push({
          trabajador_id: TRABAJADORES.DIEGO_COCINERO,
          fecha: fechaStr,
          hora_inicio: '14:00',
          hora_fin: '22:00',
          estado: 'programado',
          notas: 'Servicio cenas'
        });
      } else {
        // Diego turno mañana
        turnos.push({
          trabajador_id: TRABAJADORES.DIEGO_COCINERO,
          fecha: fechaStr,
          hora_inicio: '08:00',
          hora_fin: '16:00',
          estado: 'programado',
          notas: 'Preparación comidas'
        });
        // Pedro turno tarde
        turnos.push({
          trabajador_id: TRABAJADORES.PEDRO_COCINERO,
          fecha: fechaStr,
          hora_inicio: '14:00',
          hora_fin: '22:00',
          estado: 'programado',
          notas: 'Servicio cenas'
        });
      }
    }
    // Domingos: solo un cocinero (alternando)
    if (diaSemana === 0) {
      turnos.push({
        trabajador_id: esSemanaImpar ? TRABAJADORES.PEDRO_COCINERO : TRABAJADORES.DIEGO_COCINERO,
        fecha: fechaStr,
        hora_inicio: '10:00',
        hora_fin: '18:00',
        estado: 'programado',
        notas: 'Turno domingo'
      });
    }
    
    // === CAMAREROS (María y Juan) - Rotación ===
    // Semanas impares: María mañana (10-18), Juan tarde (14-22)
    // Semanas pares: Juan mañana (10-18), María tarde (14-22)
    if (diaSemana >= 1 && diaSemana <= 6) { // Lunes a sábado
      if (esSemanaImpar) {
        // María turno mañana
        turnos.push({
          trabajador_id: TRABAJADORES.MARIA_CAMARERA,
          fecha: fechaStr,
          hora_inicio: '10:00',
          hora_fin: '18:00',
          estado: 'programado',
          notas: 'Servicio comidas'
        });
        // Juan turno tarde
        turnos.push({
          trabajador_id: TRABAJADORES.JUAN_CAMARERO,
          fecha: fechaStr,
          hora_inicio: '14:00',
          hora_fin: '22:00',
          estado: 'programado',
          notas: 'Servicio cenas'
        });
      } else {
        // Juan turno mañana
        turnos.push({
          trabajador_id: TRABAJADORES.JUAN_CAMARERO,
          fecha: fechaStr,
          hora_inicio: '10:00',
          hora_fin: '18:00',
          estado: 'programado',
          notas: 'Servicio comidas'
        });
        // María turno tarde
        turnos.push({
          trabajador_id: TRABAJADORES.MARIA_CAMARERA,
          fecha: fechaStr,
          hora_inicio: '14:00',
          hora_fin: '22:00',
          estado: 'programado',
          notas: 'Servicio cenas'
        });
      }
    }
    // Domingos: solo un camarero (alternando)
    if (diaSemana === 0) {
      turnos.push({
        trabajador_id: esSemanaImpar ? TRABAJADORES.MARIA_CAMARERA : TRABAJADORES.JUAN_CAMARERO,
        fecha: fechaStr,
        hora_inicio: '11:00',
        hora_fin: '19:00',
        estado: 'programado',
        notas: 'Turno domingo'
      });
    }
    
    // === AYUDANTE COCINA (Laura) - 5 días/semana ===
    // Lunes, miércoles, viernes: mañana (09-17)
    // Martes, jueves: tarde (15-23)
    if (diaSemana === 1 || diaSemana === 3 || diaSemana === 5) {
      turnos.push({
        trabajador_id: TRABAJADORES.LAURA_AYUDANTE_COCINA,
        fecha: fechaStr,
        hora_inicio: '09:00',
        hora_fin: '17:00',
        estado: 'programado',
        notas: 'Preparación ingredientes'
      });
    } else if (diaSemana === 2 || diaSemana === 4) {
      turnos.push({
        trabajador_id: TRABAJADORES.LAURA_AYUDANTE_COCINA,
        fecha: fechaStr,
        hora_inicio: '15:00',
        hora_fin: '23:00',
        estado: 'programado',
        notas: 'Apoyo cenas'
      });
    }
    
    // === AYUDANTE CAMARERO (Ana) - 5 días/semana ===
    // Lunes, miércoles, viernes: mañana (11-19)
    // Martes, sábado: tarde (14-22)
    if (diaSemana === 1 || diaSemana === 3 || diaSemana === 5) {
      turnos.push({
        trabajador_id: TRABAJADORES.ANA_AYUDANTE_CAMARERO,
        fecha: fechaStr,
        hora_inicio: '11:00',
        hora_fin: '19:00',
        estado: 'programado',
        notas: 'Apoyo sala'
      });
    } else if (diaSemana === 2 || diaSemana === 6) {
      turnos.push({
        trabajador_id: TRABAJADORES.ANA_AYUDANTE_CAMARERO,
        fecha: fechaStr,
        hora_inicio: '14:00',
        hora_fin: '22:00',
        estado: 'programado',
        notas: 'Apoyo noche'
      });
    }
    
    // === RECEPCIONISTA (Carmen) - Lunes a Sábado 10:00-18:00 ===
    if (diaSemana >= 1 && diaSemana <= 6) {
      turnos.push({
        trabajador_id: TRABAJADORES.CARMEN_RECEPCIONISTA,
        fecha: fechaStr,
        hora_inicio: '10:00',
        hora_fin: '18:00',
        estado: 'programado',
        notas: 'Atención al cliente'
      });
    }
    
    // === LIMPIEZA (Miguel) - 4 días/semana (Lun, Mié, Vie, Sáb) 07:00-11:00 ===
    if (diaSemana === 1 || diaSemana === 3 || diaSemana === 5 || diaSemana === 6) {
      turnos.push({
        trabajador_id: TRABAJADORES.MIGUEL_LIMPIEZA,
        fecha: fechaStr,
        hora_inicio: '07:00',
        hora_fin: '11:00',
        estado: 'programado',
        notas: diaSemana === 6 ? 'Limpieza fin de semana' : 'Limpieza matinal'
      });
    }
  }
  
  console.log(`Generando ${turnos.length} turnos para diciembre 2025 y enero 2026...`);
  
  // Insertar en lotes de 100 para evitar límites
  const batchSize = 100;
  let insertedCount = 0;
  
  for (let i = 0; i < turnos.length; i += batchSize) {
    const batch = turnos.slice(i, i + batchSize);
    const { error } = await supabase.from('turnos').insert(batch);
    
    if (error) {
      console.error(`Error al insertar lote ${i / batchSize + 1}:`, error);
      throw error;
    }
    
    insertedCount += batch.length;
    console.log(`Insertados ${insertedCount}/${turnos.length} turnos...`);
  }
  
  console.log('Turnos generados exitosamente');
  return { total: turnos.length };
};

// Mantener la función anterior por compatibilidad
export const generarTurnosManualmente = generarTurnosDiciembreEnero;
