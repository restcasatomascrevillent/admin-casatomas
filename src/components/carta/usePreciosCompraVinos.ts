import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { preciosPorVino, type PrecioCompraVino } from "./precioCompraVino";

const VACIO: ReadonlyMap<string, PrecioCompraVino> = new Map();

// La tabla no está en los tipos generados de Supabase: cliente sin tipar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = () => (supabase as any).from("vinos_precio_compra");

/**
 * Precio de compra de cada vino (vinos_precio_compra, migración 20261222140000), solo para quien
 * puede EDITAR la carta: sin ese permiso ni se pide (y la RLS tampoco devolvería nada). La tabla ya
 * está calculada: leerla no cruza facturas. Si falla (migración sin aplicar), la carta sigue igual,
 * sin «Compra».
 */
export function usePreciosCompraVinos(puedeEditar: boolean): ReadonlyMap<string, PrecioCompraVino> {
  const { data } = useQuery({
    queryKey: ["vinos-precio-compra"],
    enabled: puedeEditar,
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await tabla().select("*").limit(5000);
      if (error) {
        console.warn("[carta] sin precios de compra de los vinos (¿migración sin aplicar?)", error.message);
        return VACIO;
      }
      return preciosPorVino((data ?? []) as Record<string, unknown>[]);
    },
  });
  return puedeEditar ? (data ?? VACIO) : VACIO;
}
