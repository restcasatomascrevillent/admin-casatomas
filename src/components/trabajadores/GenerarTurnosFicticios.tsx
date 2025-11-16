import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export const GenerarTurnosFicticios = () => {
  const [generando, setGenerando] = useState(false);
  const queryClient = useQueryClient();

  const generarTurnos = async () => {
    try {
      setGenerando(true);

      // Obtener trabajadores activos
      const { data: trabajadores, error: errorTrabajadores } = await supabase
        .from("trabajadores")
        .select("id, nombre, apellidos, puesto")
        .eq("activo", true);

      if (errorTrabajadores) throw errorTrabajadores;
      if (!trabajadores || trabajadores.length === 0) {
        toast.error("No hay trabajadores activos en el sistema");
        return;
      }

      // Generar turnos para esta semana y la próxima
      const turnos = [];
      const fechaActual = new Date();
      
      // Configuración de horarios por puesto
      const horariosPorPuesto: Record<string, Array<{ inicio: string; fin: string; nota: string }>> = {
        gerente: [
          { inicio: "08:00", fin: "16:00", nota: "Supervisión general" },
        ],
        camarero: [
          { inicio: "09:00", fin: "17:00", nota: "Turno de mañana" },
          { inicio: "13:00", fin: "21:00", nota: "Turno de tarde" },
        ],
        ayudante_camarero: [
          { inicio: "10:00", fin: "18:00", nota: "Apoyo sala" },
          { inicio: "14:00", fin: "22:00", nota: "Apoyo noche" },
        ],
        cocinero: [
          { inicio: "08:00", fin: "16:00", nota: "Preparación comidas" },
          { inicio: "14:00", fin: "22:00", nota: "Cenas" },
        ],
        ayudante_cocina: [
          { inicio: "09:00", fin: "17:00", nota: "Preparación ingredientes" },
          { inicio: "15:00", fin: "23:00", nota: "Apoyo cenas" },
        ],
        recepcionista: [
          { inicio: "10:00", fin: "18:00", nota: "Atención al cliente" },
        ],
        limpieza: [
          { inicio: "07:00", fin: "11:00", nota: "Limpieza matinal" },
          { inicio: "23:00", fin: "02:00", nota: "Limpieza nocturna" },
        ],
      };

      // Estados con probabilidades
      const estados = ["programado", "activo", "completado"];
      const getEstado = (diasAtras: number) => {
        if (diasAtras > 2) return "completado";
        if (diasAtras === 0) return "activo";
        return "programado";
      };

      // Generar turnos para los próximos 14 días
      for (let i = -3; i < 14; i++) {
        const fecha = new Date(fechaActual);
        fecha.setDate(fecha.getDate() + i);
        const fechaStr = fecha.toISOString().split("T")[0];

        for (const trabajador of trabajadores) {
          const horarios = horariosPorPuesto[trabajador.puesto] || horariosPorPuesto.camarero;
          
          // No todos los días para cada trabajador
          const trabajaHoy = Math.random() > 0.3; // 70% probabilidad de trabajar
          
          if (trabajaHoy) {
            const horario = horarios[Math.floor(Math.random() * horarios.length)];
            const estado = getEstado(-i);

            turnos.push({
              trabajador_id: trabajador.id,
              fecha: fechaStr,
              hora_inicio: horario.inicio,
              hora_fin: horario.fin,
              estado: estado,
              notas: horario.nota,
            });
          }
        }
      }

      // Insertar turnos en lotes
      const batchSize = 50;
      for (let i = 0; i < turnos.length; i += batchSize) {
        const batch = turnos.slice(i, i + batchSize);
        const { error } = await supabase.from("turnos").insert(batch);
        if (error) throw error;
      }

      toast.success(`${turnos.length} turnos generados correctamente`);
      queryClient.invalidateQueries({ queryKey: ["turnos"] });
      queryClient.invalidateQueries({ queryKey: ["vista_turnos_completa"] });
    } catch (error: any) {
      console.error("Error al generar turnos:", error);
      toast.error("Error al generar turnos: " + error.message);
    } finally {
      setGenerando(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={generarTurnos}
      disabled={generando}
    >
      {generando ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Generando...
        </>
      ) : (
        <>
          <Calendar className="mr-2 h-4 w-4" />
          Generar Turnos
        </>
      )}
    </Button>
  );
};
