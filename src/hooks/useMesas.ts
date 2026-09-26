import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Json } from "@/integrations/supabase/types";

export interface OriginalMesaData {
  id: string;
  nombre: string;
  capacidad: number;
  forma: "rectangular" | "circular";
  ancho: number;
  alto: number;
}

export interface Mesa {
  id: string;
  espacio_id: string;
  nombre: string;
  capacidad: number;
  forma: string;
  ancho: number;
  alto: number;
  pos_x: number;
  pos_y: number;
  rotacion: number;
  activa: boolean;
  is_merged: boolean;
  original_mesas: OriginalMesaData[] | null;
  etiqueta: string | null;
  created_at: string;
  updated_at: string;
}

export interface MesaInput {
  espacio_id: string;
  nombre: string;
  capacidad?: number;
  forma?: string;
  ancho?: number;
  alto?: number;
  pos_x?: number;
  pos_y?: number;
  rotacion?: number;
  activa?: boolean;
  is_merged?: boolean;
  original_mesas?: Json | null;
  etiqueta?: string | null;
}

export interface OpcionesMesas {
  /**
   * Trae TAMBIÉN las mesas desactivadas (`activa = false`). Por defecto `false`:
   * el plano y el canvas solo quieren las mesas que están en uso.
   *
   * Lo necesita la gestión de mesas de Configuración (`GestionMesasEspacios`):
   * allí una mesa desactivada tiene que seguir viéndose para poder reactivarla
   * o borrarla — si no saliera, quedaría inaccesible desde la interfaz.
   */
  incluirInactivas?: boolean;
  /**
   * Permite montar el hook sin lanzar la consulta (mismas reglas de los hooks
   * de React: no se puede llamar condicionalmente). `EspacioForm` lo usa para
   * no pedir mesas cuando se está CREANDO un espacio que aún no existe.
   */
  habilitado?: boolean;
}

/**
 * Mesas de un espacio (o de todos si no se pasa `espacioId`).
 *
 * OJO con sumar `capacidad` para calcular aforo: cuando el editor de plano
 * fusiona mesas BORRA las filas originales y crea una sola fila con
 * `is_merged = true` y la capacidad combinada (ver `EditorPlanoEspacio.tsx`,
 * sobre la línea 183). Por eso sumar todas las mesas activas NO duplica
 * plazas y no hay que excluir `is_merged`. La cuenta vive en
 * `src/lib/reservas/aforoMesas.ts`, no la repitas a mano.
 */
export function useMesas(espacioId?: string, opciones?: OpcionesMesas) {
  const incluirInactivas = opciones?.incluirInactivas === true;
  const habilitado = opciones?.habilitado !== false;

  return useQuery({
    // La clave lleva `incluirInactivas` para que las dos variantes no se pisen
    // en la caché (si compartieran clave, la pantalla de gestión podría acabar
    // leyendo el resultado filtrado del plano, o al revés). Todas empiezan por
    // "mesas", así que un `invalidateQueries({ queryKey: ["mesas"] })` sigue
    // invalidando ambas por prefijo.
    queryKey: incluirInactivas
      ? ["mesas", espacioId ?? "todos", "con-inactivas"]
      : espacioId
        ? ["mesas", espacioId]
        : ["mesas"],
    enabled: habilitado,
    queryFn: async () => {
      let query = supabase
        .from("mesas")
        .select("*")
        .order("nombre");

      if (!incluirInactivas) {
        query = query.eq("activa", true);
      }

      if (espacioId) {
        query = query.eq("espacio_id", espacioId);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Convertir original_mesas de Json a OriginalMesaData[]
      return (data || []).map(mesa => ({
        ...mesa,
        original_mesas: mesa.original_mesas as unknown as OriginalMesaData[] | null,
      })) as Mesa[];
    },
    staleTime: 0, // Siempre considerar datos como stale para refetch
  });
}

export function useCrearMesa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mesa: MesaInput) => {
      const { data, error } = await supabase
        .from("mesas")
        .insert(mesa)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
    },
    onError: (error) => {
      toast.error("Error al crear mesa");
      console.error(error);
    },
  });
}

export function useActualizarMesa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Mesa> & { id: string }) => {
      // Convertir original_mesas a Json para Supabase
      const dbUpdates = {
        ...updates,
        original_mesas: updates.original_mesas as unknown as Json | null,
      };
      const { data, error } = await supabase
        .from("mesas")
        .update(dbUpdates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
    },
    onError: (error) => {
      toast.error("Error al actualizar mesa");
      console.error(error);
    },
  });
}

export function useActualizarMesasSilent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mesas: Array<Partial<Mesa> & { id: string }>) => {
      const updates = mesas.map(({ id, ...data }) => {
        // Convertir original_mesas a Json para Supabase
        const dbData = {
          ...data,
          original_mesas: data.original_mesas as unknown as Json | null,
        };
        return supabase.from("mesas").update(dbData).eq("id", id);
      });
      const results = await Promise.all(updates);
      // Promise.all no rechaza si Supabase devuelve { error } dentro de una respuesta
      // resuelta con éxito (no lanza) — sin este check, un fallo de update pasaba
      // desapercibido y el llamador creía que la posición/fusión se había guardado.
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
    },
  });
}

export function useEliminarMesa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("mesas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
      toast.success("Mesa eliminada correctamente");
    },
    onError: (error) => {
      toast.error("Error al eliminar mesa");
      console.error(error);
    },
  });
}
