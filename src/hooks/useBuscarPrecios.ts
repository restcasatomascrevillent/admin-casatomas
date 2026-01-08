import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ResultadoBusqueda {
  content: string;
  citations: string[];
  query: string;
  timestamp: string;
}

export function useBuscarPrecios() {
  const [isLoading, setIsLoading] = useState(false);
  const [resultado, setResultado] = useState<ResultadoBusqueda | null>(null);
  const { toast } = useToast();

  const buscarPrecios = async (query: string) => {
    if (!query.trim()) {
      toast({
        title: "Error",
        description: "Introduce un término de búsqueda",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setResultado(null);

    try {
      const { data, error } = await supabase.functions.invoke("buscar-precios-mercado", {
        body: { query: query.trim() },
      });

      if (error) {
        throw error;
      }

      if (data.error) {
        throw new Error(data.error);
      }

      setResultado(data);
    } catch (error) {
      console.error("Error buscando precios:", error);
      toast({
        title: "Error al buscar precios",
        description: error instanceof Error ? error.message : "Error desconocido",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const limpiarResultado = () => {
    setResultado(null);
  };

  return {
    buscarPrecios,
    limpiarResultado,
    isLoading,
    resultado,
  };
}
