import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Los platos de la carta, en la forma mínima que necesita el menú del día (y
 * el menú y el botón «Échale un vistazo» de las novedades).
 *
 * Hook aparte de `usePlatos` a propósito:
 *  - `usePlatos` hace `select("*")` de las 128 filas y arrastra las mutaciones
 *    de la pantalla de carta. Aquí solo hace falta leer.
 *  - Sí se piden las columnas TRADUCIDAS (`nombre_en`, `descripcion_fr`, ...),
 *    que `usePlatos` no declara en su interfaz. Son la razón de ser de todo
 *    esto: al elegir un plato de la carta su traducción ya existe y no hay que
 *    volver a pedírsela al traductor automático.
 */
export interface PlatoDeCarta {
  id: string;
  nombre: string | null;
  nombre_en: string | null;
  nombre_fr: string | null;
  descripcion: string | null;
  descripcion_en: string | null;
  descripcion_fr: string | null;
  categoria: string | null;
  imagen_url: string | null;
  imagen_posicion_y: number | null;
  alergenos_oficiales: unknown;
  alergenos_inferidos: unknown;
  alergenos_notas: string | null;
  activado: boolean | null;
  /** Sale en la carta del restaurante. «En la carta» = `activado` y `restaurante`. */
  restaurante: boolean | null;
  orden: string | null;
}

const COLUMNAS = [
  "id",
  "nombre",
  "nombre_en",
  "nombre_fr",
  "descripcion",
  "descripcion_en",
  "descripcion_fr",
  "categoria",
  "imagen_url",
  "imagen_posicion_y",
  "alergenos_oficiales",
  "alergenos_inferidos",
  "alergenos_notas",
  "activado",
  "restaurante",
  "orden",
].join(", ");

/**
 * @param habilitado `false` evita la consulta entera. La pestaña de tapas monta
 * el mismo componente que la de menú y no tiene nada que buscar en la carta.
 */
export function usePlatosParaMenu(habilitado = true) {
  const { data, isLoading, error } = useQuery({
    enabled: habilitado,
    queryKey: ["platos-para-menu"],
    queryFn: async (): Promise<PlatoDeCarta[]> => {
      const { data, error } = await supabase
        .from("Platos")
        .select(COLUMNAS)
        .order("orden", { ascending: true })
        .order("id", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as PlatoDeCarta[];
    },
    // La carta cambia poco durante una sesión de edición del menú.
    staleTime: 5 * 60 * 1000,
  });

  return { platos: data ?? [], isLoading, error: error as Error | null };
}

/** Índice por id para resolver `platoId` sin recorrer las 128 filas cada vez. */
export const indexarPlatos = (platos: PlatoDeCarta[]): Map<string, PlatoDeCarta> =>
  new Map(platos.map((plato) => [plato.id, plato]));
