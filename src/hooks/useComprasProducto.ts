// Compras de un producto y líneas de un documento, para «Comparar facturas» y
// el tooltip de la gráfica de precio de Análisis (15/11/2026). Ver
// src/lib/facturas/comprasProducto.ts.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { COLUMNAS_DOC, COLUMNAS_LINEA, aCompras, aLinea, type CompraProducto, type LineaDocumento, type ProductoBuscado } from "@/lib/facturas/comprasProducto";

const LIMITE = 500;

/** Todas las líneas del producto (por id de producto o, si no lo tiene, por la línea normalizada), con su documento. */
export function useComprasProducto(p: ProductoBuscado | null) {
  const clave = p ? (p.productoId !== null ? `id:${p.productoId}` : p.nombreNormalizado ? `n:${p.nombreNormalizado}` : null) : null;
  return useQuery({
    queryKey: ["facturas-compras-producto", clave],
    enabled: clave !== null,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<CompraProducto[]> => {
      let q = supabase.from("productos_factura").select(`${COLUMNAS_LINEA}, facturas!inner(${COLUMNAS_DOC})`);
      q = p!.productoId !== null ? q.eq("producto_id", p!.productoId) : q.eq("nombre_normalizado", p!.nombreNormalizado as string);
      const { data, error } = await q.order("id", { ascending: false }).limit(LIMITE);
      if (error) throw error;
      return aCompras(data);
    },
  });
}

/** Las líneas de un documento (todas). */
export function useLineasDocumento(facturaId: number | null) {
  return useQuery({
    queryKey: ["facturas-lineas-documento", facturaId],
    enabled: facturaId !== null,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<LineaDocumento[]> => {
      const { data, error } = await supabase.from("productos_factura").select(COLUMNAS_LINEA).eq("factura_id", facturaId as number).limit(LIMITE);
      if (error) throw error;
      return ((data ?? []) as unknown[]).map(aLinea).filter((l): l is LineaDocumento => l !== null);
    },
  });
}
