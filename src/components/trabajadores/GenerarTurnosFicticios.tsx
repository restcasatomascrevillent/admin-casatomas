import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { generarTurnosDiciembreEnero } from "@/scripts/generarTurnos";

export const GenerarTurnosFicticios = () => {
  const [generando, setGenerando] = useState(false);
  const queryClient = useQueryClient();

  const generarTurnos = async () => {
    try {
      setGenerando(true);
      const resultado = await generarTurnosDiciembreEnero();
      toast.success(`${resultado.total} turnos generados para Dic 2025 - Ene 2026`);
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
          Generando turnos...
        </>
      ) : (
        <>
          <Calendar className="mr-2 h-4 w-4" />
          Generar Turnos Dic-Ene
        </>
      )}
    </Button>
  );
};
