import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database } from "lucide-react";

export const GenerarDatosFicticios = () => {
  const generarDatos = async () => {
    try {
      // Datos de trabajadores ficticios
      const trabajadores = [
        {
          nombre: 'Carlos',
          apellidos: 'Rodríguez García',
          telefono: '612345678',
          email: 'carlos.rodriguez@restaurante.com',
          puesto: 'gerente',
          fecha_contratacion: '2023-01-15',
          activo: true,
          salario_hora: 18.50,
          notas: 'Gerente principal con 10 años de experiencia'
        },
        {
          nombre: 'María',
          apellidos: 'González López',
          telefono: '623456789',
          email: 'maria.gonzalez@restaurante.com',
          puesto: 'camarero',
          fecha_contratacion: '2023-03-20',
          activo: true,
          salario_hora: 12.00,
          notas: 'Especializada en eventos'
        },
        {
          nombre: 'Juan',
          apellidos: 'Martínez Sánchez',
          telefono: '634567890',
          email: 'juan.martinez@restaurante.com',
          puesto: 'camarero',
          fecha_contratacion: '2023-06-10',
          activo: true,
          salario_hora: 11.50,
          notas: null
        },
        {
          nombre: 'Ana',
          apellidos: 'Fernández Ruiz',
          telefono: '645678901',
          email: 'ana.fernandez@restaurante.com',
          puesto: 'ayudante_camarero',
          fecha_contratacion: '2024-01-05',
          activo: true,
          salario_hora: 10.00,
          notas: 'En formación'
        },
        {
          nombre: 'Pedro',
          apellidos: 'López Torres',
          telefono: '656789012',
          email: 'pedro.lopez@restaurante.com',
          puesto: 'cocinero',
          fecha_contratacion: '2022-11-01',
          activo: true,
          salario_hora: 15.00,
          notas: 'Chef especializado en cocina mediterránea'
        },
        {
          nombre: 'Laura',
          apellidos: 'Jiménez Moreno',
          telefono: '667890123',
          email: 'laura.jimenez@restaurante.com',
          puesto: 'ayudante_cocina',
          fecha_contratacion: '2023-09-15',
          activo: true,
          salario_hora: 11.00,
          notas: null
        },
        {
          nombre: 'Diego',
          apellidos: 'Ruiz Navarro',
          telefono: '678901234',
          email: 'diego.ruiz@restaurante.com',
          puesto: 'cocinero',
          fecha_contratacion: '2023-02-28',
          activo: true,
          salario_hora: 14.50,
          notas: 'Especialidad en repostería'
        },
        {
          nombre: 'Carmen',
          apellidos: 'Sánchez Díaz',
          telefono: '689012345',
          email: null,
          puesto: 'recepcionista',
          fecha_contratacion: '2024-02-01',
          activo: true,
          salario_hora: 11.50,
          notas: 'Atiende reservas y recepción'
        },
        {
          nombre: 'Miguel',
          apellidos: 'Torres Romero',
          telefono: '690123456',
          email: null,
          puesto: 'limpieza',
          fecha_contratacion: '2023-05-10',
          activo: true,
          salario_hora: 10.50,
          notas: 'Turno de mañana'
        },
        {
          nombre: 'Isabel',
          apellidos: 'Moreno Castro',
          telefono: '601234567',
          email: null,
          puesto: 'ayudante_camarero',
          fecha_contratacion: '2023-12-01',
          activo: false,
          salario_hora: 10.00,
          notas: 'Baja temporal por maternidad'
        }
      ];

      // Insertar trabajadores
      const { data: trabajadoresCreados, error: errorTrabajadores } = await supabase
        .from('trabajadores' as any)
        .insert(trabajadores)
        .select();

      if (errorTrabajadores) throw errorTrabajadores;

      // Generar turnos para hoy y los próximos 7 días
      const turnos = [];
      const hoy = new Date();
      
      for (let i = 0; i < 7; i++) {
        const fecha = new Date(hoy);
        fecha.setDate(hoy.getDate() + i);
        const fechaStr = fecha.toISOString().split('T')[0];

        // Turno de mañana (9:00 - 17:00)
        if (trabajadoresCreados && trabajadoresCreados[0]) {
          turnos.push({
            trabajador_id: (trabajadoresCreados[1] as any).id, // María (camarero)
            fecha: fechaStr,
            hora_inicio: '09:00',
            hora_fin: '17:00',
            estado: i === 0 ? 'activo' : 'programado',
            notas: 'Turno de mañana - Sala principal'
          });
        }

        if (trabajadoresCreados && trabajadoresCreados[2]) {
          turnos.push({
            trabajador_id: (trabajadoresCreados[2] as any).id, // Juan (camarero)
            fecha: fechaStr,
            hora_inicio: '09:00',
            hora_fin: '17:00',
            estado: i === 0 ? 'activo' : 'programado',
            notas: 'Turno de mañana - Terraza'
          });
        }

        // Turno de tarde (17:00 - 23:30)
        if (trabajadoresCreados && trabajadoresCreados[1]) {
          turnos.push({
            trabajador_id: (trabajadoresCreados[3] as any).id, // Ana (ayudante)
            fecha: fechaStr,
            hora_inicio: '17:00',
            hora_fin: '23:30',
            estado: i === 0 ? 'activo' : 'programado',
            notas: 'Turno de tarde'
          });
        }

        // Cocineros (todo el día)
        if (trabajadoresCreados && trabajadoresCreados[4]) {
          turnos.push({
            trabajador_id: (trabajadoresCreados[4] as any).id, // Pedro (cocinero)
            fecha: fechaStr,
            hora_inicio: '10:00',
            hora_fin: '18:00',
            estado: i === 0 ? 'activo' : 'programado',
            notas: 'Turno de cocina principal'
          });
        }

        if (trabajadoresCreados && trabajadoresCreados[6]) {
          turnos.push({
            trabajador_id: (trabajadoresCreados[6] as any).id, // Diego (cocinero)
            fecha: fechaStr,
            hora_inicio: '18:00',
            hora_fin: '00:00',
            estado: i === 0 ? 'activo' : 'programado',
            notas: 'Turno de cocina nocturno'
          });
        }
      }

      const { error: errorTurnos } = await supabase
        .from('turnos' as any)
        .insert(turnos);

      if (errorTurnos) throw errorTurnos;

      toast.success(`¡Datos generados! ${trabajadoresCreados?.length} trabajadores y ${turnos.length} turnos creados`);
    } catch (error: any) {
      console.error('Error generando datos:', error);
      toast.error('Error al generar datos: ' + error.message);
    }
  };

  return (
    <Button onClick={generarDatos} variant="outline" className="gap-2">
      <Database className="h-4 w-4" />
      Generar Datos de Prueba
    </Button>
  );
};
