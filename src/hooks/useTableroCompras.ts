// Datos del tablero de Facturas › Análisis: UNA llamada a la RPC
// `tablero_compras` (migración 20261105150000) con todos los bloques.
// react-query guarda cada periodo/local 5 minutos: cambiar de «Año» a «Mes» y
// volver no vuelve a pedir nada.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esErrorRpcInexistente } from "@/lib/facturas/preguntasRapidas";
import { normalizarTablero, type TableroCompras } from "@/lib/facturas/tableroCompras";

export const TEXTO_TABLERO_SIN_MIGRACION =
  "El tablero aún no está activado en esta base de datos: falta aplicar la migración 20261105150000_tablero_compras.";

/** supabase.rpc sin los tipos generados (la RPC no está en types.ts, que se mantiene a mano). */
async function rpc(funcion: string, args: Record<string, unknown>) {
  const llamar = supabase.rpc as unknown as (
    this: typeof supabase,
    fn: string,
    a?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  return llamar.call(supabase, funcion, args);
}

export function useTableroCompras(desde: string | null, hasta: string | null, local: "casa_tomas" | "touza" | null) {
  return useQuery({
    queryKey: ["tablero-compras", desde, hasta, local],
    staleTime: 5 * 60_000,
    // Al cambiar de periodo o local se queda el tablero anterior hasta que llega el nuevo (sin parpadeo).
    placeholderData: (anterior) => anterior,
    retry: (n, e) => !(e instanceof Error && e.message === TEXTO_TABLERO_SIN_MIGRACION) && n < 1,
    queryFn: async (): Promise<TableroCompras> => {
      const { data, error } = await rpc("tablero_compras", { p_desde: desde, p_hasta: hasta, p_local: local });
      if (esErrorRpcInexistente(error)) throw new Error(TEXTO_TABLERO_SIN_MIGRACION);
      if (error) throw new Error(error.message || "No se ha podido cargar el tablero");
      return normalizarTablero(data);
    },
  });
}

/** Productos comprados cuyo nombre contiene el texto (para el buscador de «Precio de un producto»). */
export function useBuscarProductosComprados(texto: string) {
  const q = texto.trim();
  return useQuery({
    queryKey: ["tablero-compras", "buscar-producto", q.toLowerCase()],
    enabled: q.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await rpc("buscar_productos_texto_agente", { p_texto: q, p_limite: 60 });
      if (error) throw new Error(error.message || "No se ha podido buscar");
      const vistos = new Map<string, string>();
      for (const fila of Array.isArray(data) ? data : []) {
        const nombre = typeof (fila as { producto?: unknown }).producto === "string" ? (fila as { producto: string }).producto.trim() : "";
        const clave = nombre.toLowerCase();
        if (nombre && !vistos.has(clave)) vistos.set(clave, nombre);
      }
      return [...vistos.values()].slice(0, 12);
    },
  });
}

/** Serie de precio de un producto por proveedor (la misma RPC que la ficha de producto y la IA). */
export function useSeriePrecioProducto(producto: string | null) {
  return useQuery({
    queryKey: ["tablero-compras", "serie-precio", producto],
    enabled: !!producto,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<unknown> => {
      const { data, error } = await rpc("serie_precios_agente", { p_texto: producto, p_desde: null, p_hasta: null, p_unidad: null });
      if (error) throw new Error(error.message || "No se ha podido leer el precio");
      return data;
    },
  });
}
