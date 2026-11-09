import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { filaParaGuardar, type FilaParker, type OrigenParker, type ResultadoParker } from "./parker";

const CLAVE = ["vinos-puntuacion-parker"] as const;

// La tabla no está en los tipos generados de Supabase: cliente sin tipar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = () => (supabase as any).from("vinos_puntuacion_parker");

/**
 * Puntuaciones Parker con fuente de todos los vinos (vinos_puntuacion_parker).
 * Si la tabla aún no existe (migración sin aplicar), devuelve [] sin romper la
 * carta. Guardar/confirmar/borrar refrescan también los vinos: la base de
 * datos recalcula lo que enseña la web.
 */
export function usePuntuacionesParker() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: CLAVE,
    queryFn: async (): Promise<FilaParker[]> => {
      const { data, error } = await tabla().select("*").order("anada", { ascending: false, nullsFirst: false }).limit(2000);
      if (error) {
        console.warn("[parker] sin tabla de puntuaciones (¿migración sin aplicar?)", error.message);
        return [];
      }
      return (data ?? []) as FilaParker[];
    },
    staleTime: 60_000,
  });

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: CLAVE });
    queryClient.invalidateQueries({ queryKey: ["vinos"] });
  };

  const guardar = useMutation({
    mutationFn: async ({ vinoId, resultado, origen }: { vinoId: string; resultado: ResultadoParker; origen: OrigenParker }) => {
      const { error } = await tabla().upsert(filaParaGuardar(vinoId, resultado, origen), { onConflict: "vino_id,clave_anada" });
      if (error) throw error;
    },
    onSuccess: refrescar,
    onError: (e) => toast.error("No se pudo guardar la puntuación Parker", { description: e instanceof Error ? e.message : undefined }),
  });

  const confirmar = useMutation({
    mutationFn: async (fila: FilaParker) => {
      const nota = [fila.notas, "Confirmada a mano desde el panel."].filter(Boolean).join(" ");
      const { error } = await tabla().update({ estado: "verificada", motivo: null, notas: nota.slice(0, 2000) }).eq("id", fila.id);
      if (error) throw error;
    },
    onSuccess: () => {
      refrescar();
      toast.success("Puntuación confirmada. Sale en la web si es de la añada que se sirve.");
    },
    onError: (e) => toast.error("No se pudo confirmar", { description: e instanceof Error ? e.message : undefined }),
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tabla().delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refrescar,
    onError: (e) => toast.error("No se pudo descartar", { description: e instanceof Error ? e.message : undefined }),
  });

  const porVino = (vinoId: string | null | undefined) => (vinoId ? (data ?? []).filter((f) => f.vino_id === vinoId) : []);

  return { filas: data ?? [], isLoading, porVino, guardar, confirmar, borrar };
}
