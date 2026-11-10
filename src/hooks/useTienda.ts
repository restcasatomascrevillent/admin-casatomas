import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ErrorNegocio } from "@/lib/mensaje-usuario";
import {
  type CambiosAjustesTienda,
  type ConfiguracionTienda,
  type VinoTiendaPanel,
  normalizarConfiguracionTienda,
} from "@/lib/tienda";

/**
 * Datos de Panel › Tienda (migración 20261103150000_tienda_vinos): la
 * configuración (fila única), los vinos de la carta y los cambios (ajustes y
 * poner/quitar vinos de la venta). Sin la migración aplicada la pantalla lo
 * dice en vez de fallar (`disponible: false`), como Super Admin › Servicios.
 */

export const CLAVE_TIENDA = ["tienda"] as const;
const CLAVE_CONFIG = [...CLAVE_TIENDA, "configuracion"] as const;
const CLAVE_VINOS = [...CLAVE_TIENDA, "vinos"] as const;

export function esSinMigracionTienda(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return ["42P01", "42883", "PGRST205", "PGRST202"].includes(e.code ?? "") ||
    (/configuracion_tienda|tienda_/.test(e.message ?? "") && /does not exist|could not find|schema cache/i.test(e.message ?? ""));
}

export type ResultadoConfiguracionTienda = { disponible: true; config: ConfiguracionTienda } | { disponible: false };

export async function cargarConfiguracionTienda(): Promise<ResultadoConfiguracionTienda> {
  const { data, error } = await supabase.from("configuracion_tienda").select("*").eq("id", true).maybeSingle();
  if (error) {
    if (esSinMigracionTienda(error)) return { disponible: false };
    throw error;
  }
  return { disponible: true, config: normalizarConfiguracionTienda(data as Record<string, unknown> | null) };
}

export function useConfiguracionTienda() {
  return useQuery({ queryKey: CLAVE_CONFIG, queryFn: cargarConfiguracionTienda });
}

/** Guarda Ajustes (nunca toca vinos_excluidos: eso va por `useMarcarVinosTienda`). */
export function useGuardarAjustesTienda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cambios: CambiosAjustesTienda) => {
      const { data, error } = await supabase.from("configuracion_tienda").update(cambios).eq("id", true).select("*");
      if (error) throw error;
      // La RLS no da error: simplemente no actualiza ninguna fila.
      if (!data || data.length === 0) {
        throw new ErrorNegocio("No se ha guardado: tu usuario no tiene permiso para cambiar la tienda.");
      }
      return normalizarConfiguracionTienda(data[0] as Record<string, unknown>);
    },
    onSuccess: (config) => {
      qc.setQueryData<ResultadoConfiguracionTienda>(CLAVE_CONFIG, { disponible: true, config });
    },
  });
}

/**
 * Interruptor «Mostrar Tienda en la web» de Gestor Web › Tienda (10/11/2026,
 * petición del dueño). Es la MISMA columna que «Tienda visible en la web» de
 * Tienda › Ajustes (`activa`), pero solo cambia esa: no pisa el descuento ni
 * los textos que otra persona pueda estar editando. Misma RLS que Ajustes
 * (`can_write_section('tienda')`). Se ve al momento (optimista) y se deshace
 * si falla. La web lo lee en vivo al cargar cada página: sin republicar.
 */
export function useCambiarTiendaVisible() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (activa: boolean) => {
      const { data, error } = await supabase.from("configuracion_tienda").update({ activa }).eq("id", true).select("*");
      if (error) throw error;
      // La RLS no da error: simplemente no actualiza ninguna fila.
      if (!data || data.length === 0) {
        throw new ErrorNegocio("No se ha guardado: tu usuario no tiene permiso para cambiar la tienda.");
      }
      return normalizarConfiguracionTienda(data[0] as Record<string, unknown>);
    },
    onMutate: async (activa) => {
      await qc.cancelQueries({ queryKey: CLAVE_CONFIG });
      const previo = qc.getQueryData<ResultadoConfiguracionTienda>(CLAVE_CONFIG);
      if (previo?.disponible) {
        qc.setQueryData<ResultadoConfiguracionTienda>(CLAVE_CONFIG, { disponible: true, config: { ...previo.config, activa } });
      }
      return { previo };
    },
    onError: (_e, _v, contexto) => {
      if (contexto?.previo) qc.setQueryData(CLAVE_CONFIG, contexto.previo);
    },
    onSuccess: (config) => {
      qc.setQueryData<ResultadoConfiguracionTienda>(CLAVE_CONFIG, { disponible: true, config });
    },
  });
}

/**
 * Pone (`aLaVenta: true`) o quita de la venta unos vinos. La RPC toca solo
 * esos ids, así que dos personas a la vez no se pisan. Se ve al momento
 * (optimista) y se deshace si falla.
 */
export function useMarcarVinosTienda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, aLaVenta }: { ids: string[]; aLaVenta: boolean }) => {
      const { data, error } = await supabase.rpc("tienda_marcar_vinos", { p_vino_ids: ids, p_a_la_venta: aLaVenta });
      if (error) throw error;
      return (data ?? []) as string[];
    },
    onMutate: async ({ ids, aLaVenta }) => {
      await qc.cancelQueries({ queryKey: CLAVE_CONFIG });
      const previo = qc.getQueryData<ResultadoConfiguracionTienda>(CLAVE_CONFIG);
      if (previo?.disponible) {
        const actuales = new Set(previo.config.vinos_excluidos);
        for (const id of ids) {
          if (aLaVenta) actuales.delete(id);
          else actuales.add(id);
        }
        qc.setQueryData<ResultadoConfiguracionTienda>(CLAVE_CONFIG, {
          disponible: true,
          config: { ...previo.config, vinos_excluidos: [...actuales].sort() },
        });
      }
      return { previo };
    },
    onError: (_e, _v, contexto) => {
      if (contexto?.previo) qc.setQueryData(CLAVE_CONFIG, contexto.previo);
    },
    onSuccess: (excluidos) => {
      const actual = qc.getQueryData<ResultadoConfiguracionTienda>(CLAVE_CONFIG);
      if (actual?.disponible) {
        qc.setQueryData<ResultadoConfiguracionTienda>(CLAVE_CONFIG, { disponible: true, config: { ...actual.config, vinos_excluidos: excluidos } });
      }
    },
  });
}

/** Vinos activos de la carta (la tienda decide luego cuáles salen). */
export async function cargarVinosTienda(): Promise<VinoTiendaPanel[]> {
  const vinos: VinoTiendaPanel[] = [];
  const pagina = 1000;
  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await supabase
      .from("Vinos")
      .select("id, nombre, categoria, precio_eur, activado, restaurante")
      .eq("activado", true)
      .order("categoria", { ascending: true })
      .order("nombre", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, desde + pagina - 1);
    if (error) throw error;
    vinos.push(...((data ?? []) as VinoTiendaPanel[]));
    if ((data?.length ?? 0) < pagina) break;
  }
  return vinos;
}

export function useVinosTienda() {
  return useQuery({ queryKey: CLAVE_VINOS, queryFn: cargarVinosTienda, staleTime: 60_000 });
}
