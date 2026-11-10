import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface PlanoEspacio {
  id: string;
  espacio_id: string;
  ancho: number;
  alto: number;
  ancho_metros: number | null;
  alto_metros: number | null;
  pixels_per_meter: number | null;
  metros_cuadrados: number | null;
  configuracion: Record<string, any>;
  created_at: string;
  updated_at: string;
}

/**
 * Saca el mensaje real de un error de Supabase para poder enseñarlo.
 *
 * Los `onError` de este módulo avisaban con un texto genérico ("Error al
 * guardar plano") y dejaban la causa únicamente en `console.error`, así que
 * quien usaba la app no llegaba a ver nunca por qué había fallado.
 */
function detalleError(error: unknown): string | undefined {
  if (error && typeof error === "object" && "message" in error) {
    const mensaje = (error as { message?: unknown }).message;
    if (typeof mensaje === "string" && mensaje.trim()) return mensaje;
  }
  return undefined;
}

/**
 * Los planos cambian poco (09/11/2026, «Hoy» con mala cobertura): 5 min sin volver a pedirlos. Lo que se
 * guarda en ESTE dispositivo invalida `["planos_espacio"]` y se relee al momento.
 */
export const FRESCURA_PLANOS_MS = 5 * 60_000;

/**
 * TODOS los planos en UNA lectura, repartidos en la caché por sala (`["planos_espacio", espacioId]`, la
 * clave de `usePlanoEspacio`). Para precargar «Hoy» (`lib/reservas/precargaHoy.ts`): el plano de la sala
 * ya está cuando se elige, sin esperar a saber cuál es. Solo rellena las que no tienen datos o están viejas.
 */
export async function precargarPlanosEspacio(qc: QueryClient): Promise<void> {
  const { data, error } = await supabase.from("planos_espacio").select("*");
  if (error || !data) return;
  const ahora = Date.now();
  for (const plano of data as unknown as PlanoEspacio[]) {
    const clave = ["planos_espacio", plano.espacio_id];
    const estado = qc.getQueryState(clave);
    if (estado?.data !== undefined && ahora - estado.dataUpdatedAt < FRESCURA_PLANOS_MS) continue;
    qc.setQueryData(clave, plano);
  }
}

export function usePlanoEspacio(espacioId?: string) {
  return useQuery({
    queryKey: ["planos_espacio", espacioId],
    staleTime: FRESCURA_PLANOS_MS,
    queryFn: async () => {
      if (!espacioId) return null;

      const { data, error } = await supabase
        .from("planos_espacio")
        .select("*")
        .eq("espacio_id", espacioId)
        .maybeSingle();

      if (error) throw error;
      return data as PlanoEspacio | null;
    },
    enabled: !!espacioId,
  });
}

export function useCrearPlano() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (plano: Partial<PlanoEspacio> & { espacio_id: string }) => {
      const { data, error } = await supabase
        .from("planos_espacio")
        .insert(plano)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planos_espacio"] });
    },
    onError: (error) => {
      toast.error("Error al crear plano", { description: detalleError(error) });
      console.error(error);
    },
  });
}

export function useActualizarPlano() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PlanoEspacio> & { id: string }) => {
      const { data, error } = await supabase
        .from("planos_espacio")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planos_espacio"] });
    },
    onError: (error) => {
      toast.error("Error al actualizar plano", { description: detalleError(error) });
      console.error(error);
    },
  });
}

export function useCrearOActualizarPlano() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (plano: Partial<PlanoEspacio> & { espacio_id: string }) => {
      // UNA escritura atómica en vez de SELECT sonda + rama INSERT/UPDATE.
      //
      // `planos_espacio.espacio_id` es UNIQUE desde la migración inicial
      // (20251207090324: `espacio_id UUID NOT NULL REFERENCES
      // espacios_reserva(id) ON DELETE CASCADE UNIQUE`), así que es Postgres
      // quien resuelve el conflicto: INSERT ... ON CONFLICT (espacio_id) DO
      // UPDATE. No hace falta migración para esto.
      //
      // Lo que cierra respecto a la sonda anterior:
      //
      //  1. La sonda DESCARTABA su `{ error }`. Si el SELECT fallaba —o una
      //     política de RLS escondía la fila— `existing` salía vacío, se caía
      //     por la rama del INSERT y lo que veía el usuario era un 23505 de
      //     clave duplicada: un error que no contaba nada de lo que había
      //     pasado de verdad y que mandaba a investigar filas duplicadas que
      //     no podían existir (la columna es UNIQUE).
      //
      //  2. Carrera viva: dos pestañas guardando el mismo espacio leían las
      //     dos "no existe" entre el SELECT y el INSERT, y la segunda se comía
      //     el 23505. Con ON CONFLICT la segunda actualiza y ya está.
      //
      // `onConflict` lleva el nombre de la COLUMNA —es lo que PostgREST pone
      // en el parámetro `on_conflict`—, no el de la constraint
      // (`planos_espacio_espacio_id_key`).
      //
      // Sobre el payload parcial: al pasar UN objeto (no un array), PostgREST
      // arma la lista de columnas con las claves de ese objeto, así que el DO
      // UPDATE toca SOLO esas columnas y el resto se queda como estaba —
      // exactamente lo mismo que hacía el UPDATE de antes. El `defaultToNull`
      // que rellenaría con NULL las columnas ausentes solo existe para upserts
      // en lote; la propia firma de supabase-js no lo admite para un objeto
      // suelto, así que aquí no hay nada que machacar.
      const { data, error } = await supabase
        .from("planos_espacio")
        .upsert(plano, { onConflict: "espacio_id" })
        .select()
        .single();

      if (error) {
        // `.single()` ya convierte "cero filas" en error, así que esto no
        // puede colarse en silencio. Pero si el upsert NO fue rechazado y aun
        // así no vuelve ninguna fila, lo que ha pasado es que la escritura
        // entró y la fila no se puede releer (lo normal: una política de
        // SELECT que la esconde). El mensaje de PostgREST para ese caso
        // ("JSON object requested, multiple (or no) rows returned") suena a
        // problema de datos y manda a mirar donde no es, así que se reetiqueta
        // conservando el original en `cause`.
        //
        // Mismo criterio que en `EditorPlanoEspacio` (2c3f9ea / 1f1d06d): ante
        // la duda, pesimista — un guardado que no se ha podido confirmar no se
        // da por bueno.
        if (error.code === "PGRST116") {
          throw Object.assign(
            new Error(
              "El plano se escribió pero no se pudo releer para confirmarlo; " +
                "lo habitual es que RLS esté escondiendo la fila. No se da por guardado.",
            ),
            { code: error.code, cause: error },
          );
        }
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planos_espacio"] });
    },
    onError: (error) => {
      toast.error("Error al guardar plano", { description: detalleError(error) });
      console.error(error);
    },
  });
}
