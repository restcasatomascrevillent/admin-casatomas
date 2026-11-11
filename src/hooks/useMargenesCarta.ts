// Datos de «Análisis general › Márgenes de carta» (migración
// 20261115200000_analisis_margenes_carta). Una sola RPC con todo (~0,3 s);
// las ediciones invalidan esa consulta.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  normalizarCompras,
  normalizarMargenes,
  normalizarProductos,
  type ConfigMargenes,
  type UnidadEscandallo,
} from "@/lib/analisis/margenesCarta";

async function rpc(funcion: string, args?: Record<string, unknown>) {
  const llamar = supabase.rpc as unknown as (
    this: typeof supabase,
    fn: string,
    a?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  const { data, error } = await llamar.call(supabase, funcion, args);
  if (error) {
    if (/margenes_/.test(error.message ?? "") && /could not find|does not exist|schema cache/i.test(error.message ?? "")) {
      throw new Error("Falta aplicar en Supabase la migración 20261115200000_analisis_margenes_carta.");
    }
    throw new Error(error.message || "No se ha podido consultar");
  }
  return data;
}

export const CLAVE_MARGENES = ["analisis", "margenes-carta"] as const;

export function useMargenesCarta() {
  return useQuery({
    queryKey: CLAVE_MARGENES,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => normalizarMargenes(await rpc("margenes_carta", { p_hoy: null })),
  });
}

export function useComprasProducto(productoId: number | null) {
  return useQuery({
    queryKey: ["analisis", "margenes-compras", productoId],
    enabled: productoId !== null,
    staleTime: 5 * 60_000,
    queryFn: async () => normalizarCompras(await rpc("margenes_compras_producto", { p_producto_id: productoId, p_limite: 20 })),
  });
}

export function useBuscarProductos(texto: string) {
  const t = texto.trim();
  return useQuery({
    queryKey: ["analisis", "margenes-buscar", t.toLowerCase()],
    enabled: t.length >= 2,
    staleTime: 60_000,
    queryFn: async () => normalizarProductos(await rpc("margenes_buscar_productos", { p_texto: t, p_limite: 20 })),
  });
}

export interface IngredienteEditado {
  productoId: number;
  cantidad: number;
  unidad: UnidadEscandallo;
  nota: string | null;
}

export function useEdicionMargenes() {
  const qc = useQueryClient();
  const refrescar = () => qc.invalidateQueries({ queryKey: CLAVE_MARGENES });
  const escandallo = useMutation({
    mutationFn: ({ platoId, ingredientes }: { platoId: string; ingredientes: IngredienteEditado[] }) =>
      rpc("margenes_guardar_escandallo", {
        p_plato_id: platoId,
        p_ingredientes: ingredientes.map((i) => ({ producto_id: i.productoId, cantidad: i.cantidad, unidad: i.unidad, nota: i.nota })),
      }),
    onSuccess: refrescar,
  });
  const vino = useMutation({
    mutationFn: ({ vinoId, productoId }: { vinoId: string; productoId: number | null }) =>
      rpc("margenes_guardar_vino", { p_vino_id: vinoId, p_producto_id: productoId, p_nota: null }),
    onSuccess: refrescar,
  });
  const revisado = useMutation({
    mutationFn: ({ tipo, id, valor }: { tipo: "plato" | "vino"; id: string; valor: boolean }) =>
      rpc("margenes_marcar_revisado", { p_tipo: tipo, p_articulo_id: id, p_revisado: valor }),
    onSuccess: refrescar,
  });
  const config = useMutation({
    mutationFn: (c: Partial<ConfigMargenes>) =>
      rpc("margenes_guardar_config", {
        p: {
          coste_max_plato_pct: c.costeMaxPlatoPct,
          multiplicador_min_vino: c.multiplicadorMinVino,
          multiplicador_min_peso: c.multiplicadorMinPeso,
          multiplicador_min_tienda: c.multiplicadorMinTienda,
          subida_coste_pct: c.subidaCostePct,
          iva_pct: c.ivaPct,
          iva_tienda_pct: c.ivaTiendaPct,
          dias_referencia: c.diasReferencia,
        },
      }),
    onSuccess: refrescar,
  });
  return { escandallo, vino, revisado, config };
}
