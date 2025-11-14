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
        .limit(5);

      if (espaciosError) throw espaciosError;
      if (!espacios || espacios.length === 0) {
        toast.error("No hay espacios de reserva disponibles");
        return;
      }

      const reservasFicticias = [
        // Hoy
        { nombre: 'Carlos Ruiz', telefono: '612345001', email: 'carlos.ruiz@email.com', fecha_offset: 0, hora: '13:00', espacio_id: (espacios as any)[0].id, numero_comensales: 4, numero_mesas: 1, estado: 'confirmada', notas_cliente: 'Mesa junto a la ventana si es posible' },
        { nombre: 'María González', telefono: '612345002', email: 'maria.gonzalez@email.com', fecha_offset: 0, hora: '14:30', espacio_id: (espacios as any)[1].id, numero_comensales: 2, numero_mesas: 1, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Juan Pérez', telefono: '612345003', email: 'juan.perez@email.com', fecha_offset: 0, hora: '20:00', espacio_id: (espacios as any)[2].id, numero_comensales: 6, numero_mesas: 2, estado: 'pendiente', notas_cliente: 'Cumpleaños, traeremos tarta' },
        { nombre: 'Ana Martín', telefono: '612345004', email: 'ana.martin@email.com', fecha_offset: 0, hora: '21:30', espacio_id: (espacios as any)[3].id, numero_comensales: 8, numero_mesas: 2, estado: 'confirmada', notas_cliente: 'Cena de empresa' },
        
        // Mañana
        { nombre: 'Pedro López', telefono: '612345005', email: 'pedro.lopez@email.com', fecha_offset: 1, hora: '13:30', espacio_id: (espacios as any)[0].id, numero_comensales: 3, numero_mesas: 1, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Laura Sánchez', telefono: '612345006', email: 'laura.sanchez@email.com', fecha_offset: 1, hora: '14:00', espacio_id: (espacios as any)[1].id, numero_comensales: 5, numero_mesas: 1, estado: 'confirmada', notas_cliente: 'Preferimos terraza' },
        { nombre: 'Miguel Rodríguez', telefono: '612345007', email: 'miguel.rodriguez@email.com', fecha_offset: 1, hora: '20:30', espacio_id: (espacios as any)[2].id, numero_comensales: 4, numero_mesas: 1, estado: 'pendiente', notas_cliente: null },
        { nombre: 'Isabel Fernández', telefono: '612345008', email: 'isabel.fernandez@email.com', fecha_offset: 1, hora: '21:00', espacio_id: (espacios as any)[3].id, numero_comensales: 10, numero_mesas: 3, estado: 'cancelada', notas_cliente: 'Cancelado por el cliente' },
        
        // Próximos días
        { nombre: 'Antonio García', telefono: '612345009', email: 'antonio.garcia@email.com', fecha_offset: 2, hora: '13:00', espacio_id: (espacios as any)[0].id, numero_comensales: 2, numero_mesas: 1, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Carmen Torres', telefono: '612345010', email: 'carmen.torres@email.com', fecha_offset: 2, hora: '14:30', espacio_id: (espacios as any)[1].id, numero_comensales: 6, numero_mesas: 2, estado: 'pendiente', notas_cliente: 'Alergia a frutos secos' },
        { nombre: 'Francisco Díaz', telefono: '612345011', email: 'francisco.diaz@email.com', fecha_offset: 3, hora: '20:00', espacio_id: (espacios as any)[2].id, numero_comensales: 4, numero_mesas: 1, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Lucía Moreno', telefono: '612345012', email: 'lucia.moreno@email.com', fecha_offset: 3, hora: '21:30', espacio_id: (espacios as any)[3].id, numero_comensales: 7, numero_mesas: 2, estado: 'confirmada', notas_cliente: 'Aniversario de boda' },
        { nombre: 'Roberto Jiménez', telefono: '612345013', email: 'roberto.jimenez@email.com', fecha_offset: 4, hora: '13:30', espacio_id: (espacios as any)[0].id, numero_comensales: 3, numero_mesas: 1, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Elena Navarro', telefono: '612345014', email: 'elena.navarro@email.com', fecha_offset: 4, hora: '14:00', espacio_id: (espacios as any)[1].id, numero_comensales: 4, numero_mesas: 1, estado: 'pendiente', notas_cliente: null },
        
        // Fin de semana
        { nombre: 'José Ruiz', telefono: '612345015', email: 'jose.ruiz@email.com', fecha_offset: 5, hora: '13:00', espacio_id: (espacios as any)[0].id, numero_comensales: 8, numero_mesas: 2, estado: 'confirmada', notas_cliente: 'Comida familiar' },
        { nombre: 'Teresa Romero', telefono: '612345016', email: 'teresa.romero@email.com', fecha_offset: 5, hora: '14:30', espacio_id: (espacios as any)[1].id, numero_comensales: 5, numero_mesas: 1, estado: 'confirmada', notas_cliente: null },
        { nombre: 'David Santos', telefono: '612345017', email: 'david.santos@email.com', fecha_offset: 5, hora: '20:00', espacio_id: (espacios as any)[2].id, numero_comensales: 2, numero_mesas: 1, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Raquel Iglesias', telefono: '612345018', email: 'raquel.iglesias@email.com', fecha_offset: 5, hora: '21:00', espacio_id: (espacios as any)[3].id, numero_comensales: 6, numero_mesas: 2, estado: 'confirmada', notas_cliente: 'Mesa tranquila por favor' },
        { nombre: 'Alberto Castro', telefono: '612345019', email: 'alberto.castro@email.com', fecha_offset: 6, hora: '13:30', espacio_id: (espacios as any)[0].id, numero_comensales: 4, numero_mesas: 1, estado: 'pendiente', notas_cliente: null },
        { nombre: 'Cristina Vargas', telefono: '612345020', email: 'cristina.vargas@email.com', fecha_offset: 6, hora: '14:00', espacio_id: (espacios as any)[1].id, numero_comensales: 3, numero_mesas: 1, estado: 'confirmada', notas_cliente: null },
        
        // Próxima semana
        { nombre: 'Sergio Ortiz', telefono: '612345021', email: 'sergio.ortiz@email.com', fecha_offset: 7, hora: '20:30', espacio_id: (espacios as any)[2].id, numero_comensales: 5, numero_mesas: 1, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Mónica Delgado', telefono: '612345022', email: 'monica.delgado@email.com', fecha_offset: 7, hora: '21:30', espacio_id: (espacios as any)[3].id, numero_comensales: 9, numero_mesas: 3, estado: 'confirmada', notas_cliente: 'Evento corporativo' },
        { nombre: 'Jorge Vega', telefono: '612345023', email: 'jorge.vega@email.com', fecha_offset: 8, hora: '13:00', espacio_id: (espacios as any)[0].id, numero_comensales: 2, numero_mesas: 1, estado: 'pendiente', notas_cliente: null },
        { nombre: 'Patricia Serrano', telefono: '612345024', email: 'patricia.serrano@email.com', fecha_offset: 8, hora: '14:30', espacio_id: (espacios as any)[1].id, numero_comensales: 4, numero_mesas: 1, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Ángel Blanco', telefono: '612345025', email: 'angel.blanco@email.com', fecha_offset: 9, hora: '20:00', espacio_id: (espacios as any)[2].id, numero_comensales: 6, numero_mesas: 2, estado: 'confirmada', notas_cliente: 'Vegetarianos' },
        { nombre: 'Silvia Suárez', telefono: '612345026', email: 'silvia.suarez@email.com', fecha_offset: 9, hora: '21:00', espacio_id: (espacios as any)[3].id, numero_comensales: 3, numero_mesas: 1, estado: 'cancelada', notas_cliente: null },
        { nombre: 'Pablo Ramos', telefono: '612345027', email: 'pablo.ramos@email.com', fecha_offset: 10, hora: '13:30', espacio_id: (espacios as any)[0].id, numero_comensales: 7, numero_mesas: 2, estado: 'confirmada', notas_cliente: 'Primera vez en el restaurante' },
        { nombre: 'Beatriz Gil', telefono: '612345028', email: 'beatriz.gil@email.com', fecha_offset: 10, hora: '14:00', espacio_id: (espacios as any)[1].id, numero_comensales: 4, numero_mesas: 1, estado: 'pendiente', notas_cliente: null },
        { nombre: 'Ramón Méndez', telefono: '612345029', email: 'ramon.mendez@email.com', fecha_offset: 11, hora: '20:30', espacio_id: (espacios as any)[2].id, numero_comensales: 5, numero_mesas: 1, estado: 'confirmada', notas_cliente: null },
        { nombre: 'Nuria Cruz', telefono: '612345030', email: 'nuria.cruz@email.com', fecha_offset: 11, hora: '21:30', espacio_id: (espacios as any)[3].id, numero_comensales: 8, numero_mesas: 2, estado: 'confirmada', notas_cliente: 'Cena romántica' },
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
          espacio_id: r.espacio_id,
          numero_comensales: r.numero_comensales,
          numero_mesas: r.numero_mesas,
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
