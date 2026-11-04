import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import { QUERY_KEY_CONFIGURACION_WEB, useConfiguracionWeb } from "@/hooks/useConfiguracionWeb";

// ----------------------------------------------------------------------------
// «Vota tu vino favorito y entra en el sorteo» (04/11/2026, petición del dueño).
// El interruptor es configuracion_web.encuesta_vinos_activa (lo cambia quien
// escribe en «Gestor carta», con la RLS de siempre de la tabla) y los votos van
// en votos_vino_favorito (migración 20261104141000). La web lee el interruptor
// cada vez que se abre la carta de vinos: no hace falta republicarla.
// ----------------------------------------------------------------------------

export type VotoVino = Pick<Tables<"votos_vino_favorito">, "id" | "vino_id" | "vino_nombre" | "nombre" | "contacto" | "idioma" | "created_at">;

export const QUERY_KEY_VOTOS_VINO = ["votosVinoFavorito"] as const;

export interface RecuentoVino {
  vino: string;
  votos: number;
}

/** Votos por vino, de más a menos (empate: por nombre). */
export function recuentoPorVino(votos: readonly Pick<VotoVino, "vino_nombre">[]): RecuentoVino[] {
  const cuenta = new Map<string, number>();
  for (const v of votos) cuenta.set(v.vino_nombre, (cuenta.get(v.vino_nombre) ?? 0) + 1);
  return [...cuenta]
    .map(([vino, n]) => ({ vino, votos: n }))
    .sort((a, b) => b.votos - a.votos || a.vino.localeCompare(b.vino, "es"));
}

/** Ganador del sorteo entre todos los participantes, al azar (crypto si existe). */
export function sortearGanador<T>(participantes: readonly T[], azar: () => number = aleatorio): T | null {
  if (participantes.length === 0) return null;
  return participantes[Math.min(participantes.length - 1, Math.floor(azar() * participantes.length))];
}

function aleatorio(): number {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 2 ** 32;
  }
  return Math.random();
}

/** CSV para descargar la lista de participantes (separador «;», como espera Excel en español). */
export function participantesCsv(votos: readonly VotoVino[]): string {
  const celda = (t: string) => `"${t.replace(/"/g, '""')}"`;
  const filas = votos.map((v) =>
    [new Date(v.created_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }), v.nombre, v.contacto, v.vino_nombre, v.idioma]
      .map((t) => celda(String(t)))
      .join(";"),
  );
  return ["Fecha;Nombre;Contacto;Vino;Idioma", ...filas].join("\n");
}

export function useEncuestaVinos({ cargarVotos }: { cargarVotos: boolean }) {
  const queryClient = useQueryClient();
  const { config, isLoading: cargandoConfig, isError: errorConfig } = useConfiguracionWeb();

  const disponible = typeof config?.encuesta_vinos_activa === "boolean";
  const activa = config?.encuesta_vinos_activa === true;

  const votos = useQuery({
    queryKey: QUERY_KEY_VOTOS_VINO,
    enabled: cargarVotos && disponible,
    queryFn: async (): Promise<VotoVino[]> => {
      const { data, error } = await supabase
        .from("votos_vino_favorito")
        .select("id, vino_id, vino_nombre, nombre, contacto, idioma, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const cambiarActiva = useMutation({
    mutationFn: async (valor: boolean) => {
      const { data, error } = await supabase
        .from("configuracion_web")
        .update({ encuesta_vinos_activa: valor })
        .eq("id", true)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      // Sin fila devuelta = la RLS no dejó (sin «Gestor carta» con editar).
      if (!data) throw new Error("No tienes permiso para cambiar la carta de la web.");
    },
    onSuccess: (_d, valor) => {
      toast.success(valor ? "Votación abierta: ya sale en la carta de vinos de la web" : "Votación cerrada: ya no sale en la web");
    },
    onError: (error: Error) => toast.error("No se pudo cambiar la votación", { description: mensajeUsuario(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY_CONFIGURACION_WEB }),
  });

  const vaciar = useMutation({
    mutationFn: async () => {
      // PostgREST no deja un DELETE sin filtro: este abarca todas las filas.
      const { error } = await supabase.from("votos_vino_favorito").delete().gte("created_at", "1970-01-01");
      if (error) throw error;
    },
    onSuccess: () => toast.success("Votación vaciada: empieza de cero"),
    onError: (error: Error) => toast.error("No se pudieron borrar los votos", { description: mensajeUsuario(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY_VOTOS_VINO }),
  });

  return {
    activa,
    disponible,
    cargando: cargandoConfig,
    error: errorConfig,
    cambiarActiva,
    votos,
    vaciar,
  };
}
