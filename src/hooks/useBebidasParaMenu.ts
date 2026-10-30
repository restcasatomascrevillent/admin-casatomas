import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { bebidaElegibleParaMenu, type BebidaParaMenu, type VinoParaMenu } from "@/lib/menu-novedad";
import { paginarConsulta, type RespuestaLote } from "@/lib/reservas/paginarConsulta";

/**
 * Los vinos y las bebidas de la carta, en la forma mínima que necesita el
 * maridaje y la cata de las novedades (historia 4093221d, E5).
 *
 * Hook aparte de `useVinos` y `useBebidas` por lo mismo que `usePlatosParaMenu`:
 * aquellos hacen `select("*")` de TODA la tabla (también lo desactivado) y
 * arrastran las mutaciones de la pantalla de carta. Aquí solo se lee lo que
 * está «en la carta» (`activado` AND `restaurante`) y solo las columnas que
 * copian `lineaDesdeVino` y `lineaDesdeBebida`, con los nombres traducidos.
 */
export interface VinoDeCarta extends VinoParaMenu {
  nombre_en: string | null;
  nombre_fr: string | null;
  categoria: string | null;
  alergenos_oficiales: unknown;
  activado: boolean | null;
  restaurante: boolean | null;
}

/** `Bebidas` no tiene alérgenos: los sulfitos se marcan a mano (ADR-9). */
export interface BebidaDeCarta extends BebidaParaMenu {
  nombre_en: string | null;
  nombre_fr: string | null;
  categoria: string | null;
  activado: boolean | null;
  restaurante: boolean | null;
}

export const COLUMNAS_VINOS = "id, nombre, nombre_en, nombre_fr, categoria, alergenos_oficiales, activado, restaurante";
export const COLUMNAS_BEBIDAS = "id, nombre, nombre_en, nombre_fr, categoria, activado, restaurante";

interface BebidasParaMenu {
  vinos: VinoDeCarta[];
  bebidas: BebidaDeCarta[];
  /** Hay más vinos que el tope de `paginarConsulta` (10.000): faltan los últimos. */
  truncado: boolean;
}

/**
 * Vinos supera de largo a Platos y PostgREST corta cada respuesta a 1000 filas
 * sin avisar: se lee por lotes. Con menos de 1000 es UNA petición (el primer
 * lote ya trae el recuento y no hace falta otra).
 */
async function leerVinos(signal: AbortSignal | undefined) {
  return paginarConsulta<VinoDeCarta>(
    (primera, ultima, contar) => {
      let consulta = supabase
        .from("Vinos")
        .select(COLUMNAS_VINOS, contar ? { count: "exact" } : undefined)
        .eq("activado", true)
        .eq("restaurante", true)
        .order("orden", { ascending: true })
        // Desempate: sin una columna única, entre dos lotes se repiten o se saltan vinos.
        .order("id", { ascending: true })
        .range(primera, ultima);
      if (signal) consulta = consulta.abortSignal(signal);
      return consulta as unknown as PromiseLike<RespuestaLote<VinoDeCarta>>;
    },
    { clave: (vino) => vino.id, signal },
  );
}

async function leerBebidas(signal: AbortSignal | undefined): Promise<BebidaDeCarta[]> {
  let consulta = supabase
    .from("Bebidas")
    .select(COLUMNAS_BEBIDAS)
    .eq("activado", true)
    .eq("restaurante", true)
    .order("orden", { ascending: true })
    .order("id", { ascending: true });
  if (signal) consulta = consulta.abortSignal(signal);
  const { data, error } = await consulta;
  if (error) throw error;
  return (data ?? []) as unknown as BebidaDeCarta[];
}

/**
 * @param habilitado `false` evita las dos consultas (p. ej. mientras el menú no
 * tiene maridaje ni es una cata).
 */
export function useBebidasParaMenu(habilitado = true) {
  const { data, isLoading, error } = useQuery({
    enabled: habilitado,
    queryKey: ["bebidas-para-menu"],
    queryFn: async ({ signal }): Promise<BebidasParaMenu> => {
      const [vinos, bebidas] = await Promise.all([leerVinos(signal), leerBebidas(signal)]);
      // El filtro de la BBDD ya deja solo lo que está en la carta; aquí se
      // quitan además las filas sin nombre (R7), que no se pueden copiar.
      return {
        vinos: vinos.filas.filter(bebidaElegibleParaMenu),
        bebidas: bebidas.filter(bebidaElegibleParaMenu),
        truncado: vinos.truncado,
      };
    },
    // La carta cambia poco durante una sesión de edición del menú.
    staleTime: 5 * 60 * 1000,
  });

  return {
    vinos: data?.vinos ?? [],
    bebidas: data?.bebidas ?? [],
    truncado: data?.truncado ?? false,
    isLoading: habilitado && isLoading,
    error: error as Error | null,
  };
}
