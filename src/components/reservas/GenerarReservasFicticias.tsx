import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const GenerarReservasFicticias = () => {
  const [generando, setGenerando] = useState(false);

  const generarReservas = async () => {
    setGenerando(true);
    try {
      // Obtener espacios disponibles
      const { data: espacios, error: espaciosError } = await supabase
        .from("espacios_reserva" as any)
        .select("id")
        .eq("activa", true)
        .limit(5);

      if (espaciosError) throw espaciosError;
      if (!espacios || espacios.length === 0) {
        toast.error("No hay espacios de reserva disponibles. Por favor, crea al menos un espacio primero.");
        return;
      }

      const reservasFicticias = [
        // Hoy
        { nombre: 'Carlos Ruiz', telefono: '612345001', email: 'carlos.ruiz@email.com', fecha_offset: 0, hora: '13:00', sala_id: (espacios as any)[0].id, numero_comensales: 4, estado: 'confirmada', notas_cliente: 'Mesa junto a la ventana si es posible' },
        { nombre: 'María González', telefono: '612345002', email: 'maria.gonzalez@email.com', fecha_offset: 0, hora: '14:30', sala_id: (espacios as any)[1 % espacios.length].id, numero_comensales: 2, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Juan Pérez', telefono: '612345003', email: 'juan.perez@email.com', fecha_offset: 0, hora: '20:00', sala_id: (espacios as any)[2 % espacios.length].id, numero_comensales: 6, estado: 'pendiente', notas_cliente: 'Cumpleaños, traeremos tarta' },
        { nombre: 'Ana Martín', telefono: '612345004', email: 'ana.martin@email.com', fecha_offset: 0, hora: '21:30', sala_id: (espacios as any)[3 % espacios.length].id, numero_comensales: 8, estado: 'confirmada', notas_cliente: 'Cena de empresa' },
        
        // Mañana
        { nombre: 'Pedro López', telefono: '612345005', email: 'pedro.lopez@email.com', fecha_offset: 1, hora: '13:30', sala_id: (espacios as any)[0].id, numero_comensales: 3, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Laura Sánchez', telefono: '612345006', email: 'laura.sanchez@email.com', fecha_offset: 1, hora: '14:00', sala_id: (espacios as any)[1 % espacios.length].id, numero_comensales: 5, estado: 'confirmada', notas_cliente: 'Preferimos terraza' },
        { nombre: 'Miguel Rodríguez', telefono: '612345007', email: 'miguel.rodriguez@email.com', fecha_offset: 1, hora: '20:30', sala_id: (espacios as any)[2 % espacios.length].id, numero_comensales: 4, estado: 'pendiente', notas_cliente: null },
        { nombre: 'Isabel Fernández', telefono: '612345008', email: 'isabel.fernandez@email.com', fecha_offset: 1, hora: '21:00', sala_id: (espacios as any)[3 % espacios.length].id, numero_comensales: 10, estado: 'cancelada', notas_cliente: 'Cancelado por el cliente' },
        
        // Próximos días
        { nombre: 'Antonio García', telefono: '612345009', email: 'antonio.garcia@email.com', fecha_offset: 2, hora: '13:00', sala_id: (espacios as any)[0].id, numero_comensales: 2, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Carmen Torres', telefono: '612345010', email: 'carmen.torres@email.com', fecha_offset: 2, hora: '14:30', sala_id: (espacios as any)[1 % espacios.length].id, numero_comensales: 6, estado: 'pendiente', notas_cliente: 'Alergia a frutos secos' },
        { nombre: 'Francisco Díaz', telefono: '612345011', email: 'francisco.diaz@email.com', fecha_offset: 3, hora: '20:00', sala_id: (espacios as any)[2 % espacios.length].id, numero_comensales: 4, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Lucía Moreno', telefono: '612345012', email: 'lucia.moreno@email.com', fecha_offset: 3, hora: '21:30', sala_id: (espacios as any)[3 % espacios.length].id, numero_comensales: 7, estado: 'confirmada', notas_cliente: 'Aniversario de boda' },
        { nombre: 'Roberto Jiménez', telefono: '612345013', email: 'roberto.jimenez@email.com', fecha_offset: 4, hora: '13:30', sala_id: (espacios as any)[0].id, numero_comensales: 3, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Elena Navarro', telefono: '612345014', email: 'elena.navarro@email.com', fecha_offset: 4, hora: '14:00', sala_id: (espacios as any)[1 % espacios.length].id, numero_comensales: 4, estado: 'pendiente', notas_cliente: null },
        
        // Fin de semana
        { nombre: 'José Ruiz', telefono: '612345015', email: 'jose.ruiz@email.com', fecha_offset: 5, hora: '13:00', sala_id: (espacios as any)[0].id, numero_comensales: 8, estado: 'confirmada', notas_cliente: 'Comida familiar' },
        { nombre: 'Teresa Vega', telefono: '612345016', email: 'teresa.vega@email.com', fecha_offset: 5, hora: '21:00', sala_id: (espacios as any)[1 % espacios.length].id, numero_comensales: 2, estado: 'confirmada', notas_cliente: 'Cena romántica' },
        { nombre: 'David Castro', telefono: '612345017', email: 'david.castro@email.com', fecha_offset: 6, hora: '14:00', sala_id: (espacios as any)[2 % espacios.length].id, numero_comensales: 12, estado: 'pendiente', notas_cliente: 'Reunión familiar grande' },
        { nombre: 'Sara Ortiz', telefono: '612345018', email: 'sara.ortiz@email.com', fecha_offset: 6, hora: '20:00', sala_id: (espacios as any)[3 % espacios.length].id, numero_comensales: 6, estado: 'confirmada', notas_cliente: null },
        
        // Próxima semana
        { nombre: 'Manuel Delgado', telefono: '612345019', email: 'manuel.delgado@email.com', fecha_offset: 7, hora: '13:30', sala_id: (espacios as any)[0].id, numero_comensales: 5, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Patricia Herrera', telefono: '612345020', email: 'patricia.herrera@email.com', fecha_offset: 8, hora: '21:00', sala_id: (espacios as any)[1 % espacios.length].id, numero_comensales: 3, estado: 'pendiente', notas_cliente: 'Aniversario' },
      ];

      // Calcular fechas y preparar datos
      const hoy = new Date();
      const reservasConFecha = reservasFicticias.map(r => {
        const fecha = new Date(hoy);
        fecha.setDate(fecha.getDate() + r.fecha_offset);
        const fechaStr = fecha.toISOString().split('T')[0];
        
        return {
          nombre: r.nombre,
          telefono: r.telefono,
          email: r.email,
          fecha: fechaStr,
          hora: r.hora,
          sala_id: r.sala_id,
          numero_comensales: r.numero_comensales,
          estado: r.estado,
          notas_cliente: r.notas_cliente,
        };
      });

      // Insertar reservas en bloques
      const { error: insertError } = await supabase
        .from("reservas" as any)
        .insert(reservasConFecha);

      if (insertError) throw insertError;

      toast.success(`✓ Se generaron ${reservasFicticias.length} reservas de prueba`);
    } catch (error: any) {
      console.error("Error generando reservas:", error);
      toast.error("Error al generar reservas: " + error.message);
    } finally {
      setGenerando(false);
    }
  };

  return (
    <Button
      onClick={generarReservas}
      disabled={generando}
      variant="outline"
      size="sm"
    >
      {generando ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Generando...
        </>
      ) : (
        "Generar Datos de Prueba"
      )}
    </Button>
  );
};
