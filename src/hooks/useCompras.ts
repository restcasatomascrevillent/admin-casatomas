// ============================================================================
//  Facturas › Compras — lecturas de las fichas (RPC de solo lectura, sin IA)
// ----------------------------------------------------------------------------
//  · serie_precios_agente(p_texto)   → gráfica de la ficha de producto
//  · ficha_proveedor_agente(p_texto) → ficha de proveedor
//  · variacion_precios_agente        → chip «Subieron de precio»
//  Las tres existen desde la migración 20261008120000 (ya aplicada). Si
//  faltara, el error se enseña en la ficha sin romper el resto de la pantalla.
// ============================================================================
import { useQuery } from "@tanstack/react-query";
import { llamarRpcSupabase, leerUmbralSubidaPrecio } from "@/hooks/usePreguntasRapidas";
import { argsSeriePrecios, UMBRAL_SUBIDA_POR_DEFECTO } from "@/lib/facturas/preguntasRapidas";
import { nombresConSubida, normalizarFichaProveedor } from "@/lib/facturas/compras";

export const CLAVE_COMPRAS = "compras";

/** Serie de precio de un producto del catálogo (toda la historia, todas las unidades). */
export const useSeriePrecioProducto = (nombre: string | null) =>
  useQuery({
    queryKey: [CLAVE_COMPRAS, "serie-precio", nombre],
    enabled: !!nombre,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<unknown> => llamarRpcSupabase("serie_precios_agente", argsSeriePrecios({ producto: nombre as string })),
  });

/** Ficha de un proveedor (qué le compras, cada cuánto, último pedido). */
export const useFichaProveedor = (nombre: string | null) =>
  useQuery({
    queryKey: [CLAVE_COMPRAS, "ficha-proveedor", nombre],
    enabled: !!nombre,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => normalizarFichaProveedor(await llamarRpcSupabase("ficha_proveedor_agente", { p_texto: nombre })),
  });

/**
 * Productos cuya última compra es más cara que su precio de referencia
 * (umbral de Productos › Avisos de precio). Nombres normalizados.
 */
export const useProductosConSubida = (activo: boolean) =>
  useQuery({
    queryKey: [CLAVE_COMPRAS, "subidas"],
    enabled: activo,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<Set<string>> => {
      const umbral = (await leerUmbralSubidaPrecio()) ?? UMBRAL_SUBIDA_POR_DEFECTO;
      const datos = await llamarRpcSupabase("variacion_precios_agente", {
        p_desde: null,
        p_hasta: null,
        p_umbral_pct: umbral,
        p_categoria: null,
        p_producto: null,
        p_limite: 50,
        p_sentido: "subidas",
      });
      return nombresConSubida(datos);
    },
  });
