import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Wand2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const AsignarAreasAutomaticamente = () => {
  const [asignando, setAsignando] = useState(false);
  const queryClient = useQueryClient();

  const asignarAreas = async () => {
    try {
      setAsignando(true);

      // Obtener todas las áreas de trabajo
      const { data: areas, error: areasError } = await supabase
        .from("areas_trabajo")
        .select("*");

      if (areasError) throw areasError;
      if (!areas || areas.length === 0) {
        toast.error("No hay áreas de trabajo creadas");
        return;
      }

      // Crear mapa de áreas por nombre
      const areasMap = {
        cocina: areas.find(a => a.nombre === "Cocina Principal")?.id,
        barra: areas.find(a => a.nombre === "Barra")?.id,
        comedor: areas.find(a => a.nombre === "Comedor")?.id,
        terraza: areas.find(a => a.nombre === "Terraza")?.id,
      };

      // Obtener turnos con información del trabajador
      const { data: turnos, error: turnosError } = await supabase
        .from("vista_turnos_con_areas")
        .select("*");

      if (turnosError) throw turnosError;
      if (!turnos || turnos.length === 0) {
        toast.error("No hay turnos para asignar");
        return;
      }

      // Definir reglas de asignación según puesto
      const reglasPuesto: Record<string, string[]> = {
        cocinero: [areasMap.cocina].filter(Boolean) as string[],
        ayudante_cocina: [areasMap.cocina].filter(Boolean) as string[],
        camarero: [areasMap.comedor, areasMap.terraza].filter(Boolean) as string[],
        ayudante_camarero: [areasMap.comedor, areasMap.terraza].filter(Boolean) as string[],
        recepcionista: [areasMap.comedor].filter(Boolean) as string[],
        gerente: Object.values(areasMap).filter(Boolean) as string[],
        limpieza: Object.values(areasMap).filter(Boolean) as string[],
      };

      let asignacionesCreadas = 0;

      // Para cada turno, asignar áreas según el puesto
      for (const turno of turnos) {
        if (!turno.id || !turno.puesto) continue;

        const areasParaAsignar = reglasPuesto[turno.puesto] || [];
        
        if (areasParaAsignar.length === 0) continue;

        // Eliminar asignaciones existentes para este turno
        await supabase
          .from("asignaciones_area")
          .delete()
          .eq("turno_id", turno.id);

        // Crear nuevas asignaciones
        const asignaciones = areasParaAsignar.map(area_id => ({
          turno_id: turno.id,
          area_id: area_id,
        }));

        const { error: insertError } = await supabase
          .from("asignaciones_area")
          .insert(asignaciones);

        if (!insertError) {
          asignacionesCreadas += asignaciones.length;
        }
      }

      toast.success(`Se crearon ${asignacionesCreadas} asignaciones automáticas`);
      queryClient.invalidateQueries({ queryKey: ["turnos"] });
      queryClient.invalidateQueries({ queryKey: ["vista_turnos_completa"] });
      queryClient.invalidateQueries({ queryKey: ["vista_turnos_con_areas"] });
    } catch (error: any) {
      console.error("Error al asignar áreas:", error);
      toast.error("Error al asignar áreas: " + error.message);
    } finally {
      setAsignando(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={asignarAreas}
      disabled={asignando}
    >
      {asignando ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Asignando...
        </>
      ) : (
        <>
          <Wand2 className="mr-2 h-4 w-4" />
          Auto-asignar Áreas
        </>
      )}
    </Button>
  );
};
