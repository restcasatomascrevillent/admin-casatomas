import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const GenerarAreasFicticias = () => {
  const [generando, setGenerando] = useState(false);
  const queryClient = useQueryClient();

  const generarAreas = async () => {
    try {
      setGenerando(true);
      
      const areas = [
        {
          nombre: "Cocina Principal",
          descripcion: "Área principal de preparación de alimentos",
          tipo: "cocina",
          activa: true
        },
        {
          nombre: "Barra",
          descripcion: "Área de servicio de bebidas y tapas",
          tipo: "barra",
          activa: true
        },
        {
          nombre: "Comedor",
          descripcion: "Sala principal de atención a comensales",
          tipo: "salon",
          activa: true
        },
        {
          nombre: "Terraza",
          descripcion: "Área exterior de servicio",
          tipo: "salon",
          activa: true
        }
      ];

      const { error } = await supabase
        .from("areas_trabajo")
        .insert(areas);

      if (error) throw error;

      toast.success("Áreas de trabajo creadas correctamente");
      queryClient.invalidateQueries({ queryKey: ["areas-trabajo"] });
    } catch (error: any) {
      console.error("Error al generar áreas:", error);
      toast.error("Error al generar áreas: " + error.message);
    } finally {
      setGenerando(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={generarAreas}
      disabled={generando}
    >
      {generando ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Generando...
        </>
      ) : (
        <>
          <MapPin className="mr-2 h-4 w-4" />
          Generar Áreas
        </>
      )}
    </Button>
  );
};
