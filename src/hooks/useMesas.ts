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
 * Mesas de un espacio (o de todos si no se pasa `espacioId`). El `select("*")`
 * trae también `is_merged` y `activa`, que hacen falta para el aforo.
 *
 * OJO con sumar `capacidad` para calcular aforo: HAY QUE EXCLUIR LAS FILAS
 * FUSIONADAS (`is_merged = true`). Al fusionar, el editor de plano intenta
 * borrar las filas originales pero lo hace sin comprobar el error del DELETE
 * (`EditorPlanoEspacio.tsx`, líneas ~551 y ~583), y supabase-js RESUELVE en vez
 * de rechazar cuando RLS o una clave ajena lo impiden: el borrado puede fallar
 * en silencio y dejar vivas la unión Y sus originales. Sumarlas todas cuenta
 * las mismas sillas dos veces (en producción, 2026-09-27: el Salón decía 64
 * plazas cuando tiene 36; la Terraza decía 12 sin tener ni una mesa real).
 * La cuenta buena vive en `src/lib/reservas/aforoMesas.ts` — no la repitas a
 * mano.
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

/**
 * NOMBRE DE MESA REPETIDO: traduce el choque del índice único a algo legible.
 *
 * El número de mesa vive en `mesas.nombre` (un `text`; no hay columna `numero` y
 * no se va a crear). El índice único parcial `uq_mesas_espacio_nombre_real`
 * —sobre `(espacio_id, lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g')))`
 * con `where coalesce(is_merged, false) = false and coalesce(activa, true) =
 * true`— es la ÚNICA garantía real de que no se repita: la validación de
 * cliente se queda obsoleta en cuanto hay dos pestañas abiertas o dos usuarios
 * a la vez, y en producción ya hay DOS mesas "9" en el Salón por no tenerlo.
 *
 * Postgres devuelve `23505` (unique_violation) con el nombre del índice en el
 * mensaje. Sin esto, el usuario veía un "Error al crear/actualizar mesa" opaco y
 * no tenía forma de saber que el problema era el número repetido. Lo usan los DOS
 * caminos que escriben el nombre: `useCrearMesa` (el alta del editor de plano) y
 * `useActualizarMesa` (el renombrado de la tarjeta de Configuración).
 */
const esNumeroDeMesaRepetido = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  const texto = [e.message, e.details].filter((t) => typeof t === "string").join(" ");
  // El nombre del índice es la señal inequívoca; el código 23505 sobre `mesas`
  // solo puede venir de este índice o de la clave primaria (un choque de UUID,
  // que no pasa), así que vale como red de seguridad si el mensaje no lo trae.
  return /uq_mesas_espacio_nombre_real/i.test(texto) || e.code === "23505";
};

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
      // El alta es por donde entra el choque en la práctica: el editor de plano
      // crea mesas desde tres sitios (panel lateral, dibujando en el lienzo y el
      // alta en rango de hasta 40 de golpe, que inserta una a una y para en el
      // primer fallo). El texto está redactado para que también se entienda leído
      // en medio de un lote: dice que ESA mesa no se creó, sin dar por hecho que
      // fuera la única.
      toast.error(
        esNumeroDeMesaRepetido(error)
          ? "Ya hay una mesa con ese número en este espacio: esa mesa no se ha creado. Usa otro número."
          : "Error al crear mesa",
      );
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
      toast.error(
        esNumeroDeMesaRepetido(error)
          ? "Ya hay una mesa con ese número en este espacio. Usa otro número."
          : "Error al actualizar mesa",
      );
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
