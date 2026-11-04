/**
 * Datos y acciones de las publicaciones programadas (TanStack Query):
 *  - useCalendarioInstagram(desde, hasta): programaciones pendientes /
 *    publicándose / con error y piezas publicadas del rango (RLS: sección
 *    marketing). Se refresca cada minuto (el panel usa sondeo, no realtime).
 *  - useProgramacionDePieza(piezaId): la programación vigente de una pieza.
 *  - useAccionesProgramacion(): programar, reprogramar y cancelar por RPC
 *    (instagram_programar, instagram_reprogramar,
 *    instagram_cancelar_programacion), que validan en el servidor.
 * Las tablas aún no están en `types.ts` (se actualiza a mano): cliente sin tipos.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { PiezaResumen, ProgramacionConPieza } from "./logica";

const sb = supabase as unknown as SupabaseClient;

export const CLAVE_PROGRAMACION = ["instagram_programaciones"] as const;
/** Misma clave que el historial de piezas (usePiezasInstagram): se invalida al publicar/programar. */
const CLAVE_PIEZAS = ["instagram_piezas"] as const;

const COLUMNAS_PIEZA = "id,marca,formato,plantilla,datos,imagen_ruta,updated_at,estado,permalink,media_id,publicada_at";
const COLUMNAS_PROGRAMACION =
  "id,pieza_id,marca,programada_para,estado,intentos,siguiente_intento_at,ultimo_intento_at,ultimo_error,contenedor_id,media_id,permalink,publicada_at,created_at,updated_at";

export interface ProgramacionInstagram extends ProgramacionConPieza {
  siguiente_intento_at: string;
  ultimo_intento_at: string | null;
  media_id: string | null;
  publicada_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conflicto {
  id: string;
  piezaId: string;
  programadaPara: string;
}

export type RespuestaProgramar =
  | { ok: true; accion: "programada" | "reprogramada"; programacion: ProgramacionInstagram; conflictos: Conflicto[] }
  | { ok: false; requiereConfirmacion: true; conflictos: Conflicto[] };

/** Mensaje legible de un error de PostgREST/RPC (el de la excepción SQL). */
export function mensajeError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    const m = (e as { message: string }).message;
    if (/Could not find the function|PGRST202/i.test(m)) return "Falta aplicar la migración de publicaciones programadas en este Supabase";
    return m;
  }
  return "No se pudo completar la acción";
}

export function useCalendarioInstagram(desde: Date, hasta: Date, opciones: { activo?: boolean } = {}) {
  return useQuery({
    queryKey: [...CLAVE_PROGRAMACION, "calendario", desde.toISOString(), hasta.toISOString()],
    enabled: opciones.activo ?? true,
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ programaciones: ProgramacionInstagram[]; publicadas: PiezaResumen[] }> => {
      const [prog, pub] = await Promise.all([
        sb
          .from("instagram_programaciones")
          .select(`${COLUMNAS_PROGRAMACION},pieza:instagram_piezas(${COLUMNAS_PIEZA})`)
          .in("estado", ["programada", "publicando", "error"])
          .gte("programada_para", desde.toISOString())
          .lt("programada_para", hasta.toISOString())
          .order("programada_para", { ascending: true })
          .limit(500),
        sb
          .from("instagram_piezas")
          .select(COLUMNAS_PIEZA)
          .not("publicada_at", "is", null)
          .gte("publicada_at", desde.toISOString())
          .lt("publicada_at", hasta.toISOString())
          .order("publicada_at", { ascending: true })
          .limit(500),
      ]);
      if (prog.error) throw prog.error;
      if (pub.error) throw pub.error;
      return {
        programaciones: (prog.data ?? []) as unknown as ProgramacionInstagram[],
        publicadas: (pub.data ?? []) as unknown as PiezaResumen[],
      };
    },
  });
}

/** Programación vigente (pendiente, publicándose o con error) de una pieza; null si no hay. */
export function useProgramacionDePieza(piezaId: string | null | undefined) {
  return useQuery({
    queryKey: [...CLAVE_PROGRAMACION, "pieza", piezaId ?? ""],
    enabled: Boolean(piezaId),
    queryFn: async (): Promise<ProgramacionInstagram | null> => {
      const { data, error } = await sb
        .from("instagram_programaciones")
        .select(COLUMNAS_PROGRAMACION)
        .eq("pieza_id", piezaId as string)
        .in("estado", ["programada", "publicando", "error"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] as unknown as ProgramacionInstagram) ?? null;
    },
  });
}

export interface EntradaProgramar {
  /** Pieza a programar (crea, o mueve su programación pendiente). */
  piezaId?: string | null;
  /** Programación concreta a mover (también una con error). Tiene prioridad sobre piezaId. */
  programacionId?: string | null;
  instante: Date;
  /** true = programar aunque haya otra de la misma marca a ±30 min. */
  confirmarConflicto?: boolean;
}

export function useAccionesProgramacion() {
  const qc = useQueryClient();
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: CLAVE_PROGRAMACION });
    void qc.invalidateQueries({ queryKey: CLAVE_PIEZAS });
  };

  const programar = useMutation({
    mutationFn: async (e: EntradaProgramar): Promise<RespuestaProgramar> => {
      const confirmar = Boolean(e.confirmarConflicto);
      const { data, error } = e.programacionId
        ? await sb.rpc("instagram_reprogramar", { p_id: e.programacionId, p_para: e.instante.toISOString(), p_confirmar_conflicto: confirmar })
        : await sb.rpc("instagram_programar", { p_pieza_id: e.piezaId, p_para: e.instante.toISOString(), p_confirmar_conflicto: confirmar });
      if (error) throw new Error(mensajeError(error));
      return data as RespuestaProgramar;
    },
    onSuccess: (r) => {
      if (r.ok) refrescar();
    },
  });

  const cancelar = useMutation({
    mutationFn: async (programacionId: string): Promise<ProgramacionInstagram> => {
      const { data, error } = await sb.rpc("instagram_cancelar_programacion", { p_id: programacionId });
      if (error) throw new Error(mensajeError(error));
      return (data as { programacion: ProgramacionInstagram }).programacion;
    },
    onSuccess: refrescar,
  });

  return { programar, cancelar };
}
