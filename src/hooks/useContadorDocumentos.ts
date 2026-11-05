// Contador de la pestaña «Compras» (facturas + albaranes) SIN descargar los
// documentos: un `count` de cabeceras. Así abrir Facturas en «Análisis» no
// pide la lista entera de Compras (con sus líneas) solo para pintar un número.
// La clave cuelga de ['facturas']: lo que invalide la lista refresca el número.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useContadorDocumentos() {
  return useQuery({
    queryKey: ["facturas", "contador-pestana"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase.from("facturas").select("id", { count: "exact", head: true }).in("tipo", ["factura", "albaran"]);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}
