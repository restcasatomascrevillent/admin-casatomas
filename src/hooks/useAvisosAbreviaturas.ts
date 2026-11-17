// ============================================================================
//  Facturas › Cargar: abreviaturas nuevas por confirmar
// ----------------------------------------------------------------------------
//  La IA (clasificar-productos) propone a qué corresponde una abreviatura que
//  un proveedor usa por primera vez («LP» → Laurent-Perrier). Aquí se leen los
//  avisos pendientes y se resuelven con las RPC de la migración 20261209310000
//  (abreviaturas_avisos_pendientes / abreviaturas_resolver). El mismo aviso sale
//  en la campana (notificaciones_dashboard, tipo facturas_abreviatura).
// ============================================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface AvisoAbreviatura {
  id: string;
  proveedor_id: number;
  proveedor: string;
  abreviatura: string;
  propuesta: string;
  texto_linea: string | null;
  producto_id: number | null;
  producto: string | null;
  created_at: string;
}

export type AccionAbreviatura = "confirmar" | "corregir" | "descartar";

export const CLAVE_AVISOS_ABREVIATURAS = ["facturas", "abreviaturas_avisos"] as const;

// Las RPC nuevas no están en types.ts: se llaman sin tipado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC fuera de los tipos generados
const rpc = (nombre: string, args?: Record<string, unknown>) => (supabase as any).rpc(nombre, args) as Promise<{ data: unknown; error: { message: string } | null }>;

export function useAvisosAbreviaturas(activo: boolean) {
  return useQuery({
    queryKey: CLAVE_AVISOS_ABREVIATURAS,
    enabled: activo,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
    // null = la RPC no existe todavía (sin migración) o no hay permiso: la pantalla no pinta nada.
    queryFn: async (): Promise<AvisoAbreviatura[] | null> => {
      const { data, error } = await rpc("abreviaturas_avisos_pendientes");
      if (error) return null;
      return Array.isArray(data) ? (data as AvisoAbreviatura[]) : [];
    },
  });
}

export function useResolverAbreviatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; accion: AccionAbreviatura; expansion?: string }) => {
      const { data, error } = await rpc("abreviaturas_resolver", { p_aviso: v.id, p_accion: v.accion, p_expansion: v.expansion ?? null });
      if (error) throw new Error(error.message);
      return data as { estado?: string; expansion?: string; producto_renombrado?: boolean; nombre_producto?: string; motivo?: string; ya_resuelto?: boolean };
    },
    onSuccess: (r, v) => {
      if (v.accion === "descartar") toast.success("Descartada: no volverá a avisar de esta abreviatura");
      else if (r?.producto_renombrado) toast.success(`Guardada. El producto ahora es «${r.nombre_producto}»`);
      else toast.success("Abreviatura guardada");
      void qc.invalidateQueries({ queryKey: CLAVE_AVISOS_ABREVIATURAS });
      void qc.invalidateQueries({ queryKey: ["productos"] });
      void qc.invalidateQueries({ queryKey: ["notificaciones"] });
    },
    onError: (e: Error) => toast.error("No se ha podido guardar", { description: e.message }),
  });
}

// ── Abreviaturas aprendidas (20261209500000): lista con «No es» para quitar las falsas ──
export interface AbreviaturaAprendida {
  id: number;
  proveedor_id: number;
  proveedor: string;
  abreviatura: string;
  expansion: string;
  origen: "aprendida" | "manual" | string;
  veces: number;
  usable: boolean;
}

export const CLAVE_ABREVIATURAS_APRENDIDAS = ["facturas", "abreviaturas_aprendidas"] as const;

export function useAbreviaturasAprendidas(activo: boolean) {
  return useQuery({
    queryKey: CLAVE_ABREVIATURAS_APRENDIDAS,
    enabled: activo,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<AbreviaturaAprendida[]> => {
      const { data, error } = await rpc("abreviaturas_listar");
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? (data as AbreviaturaAprendida[]) : [];
    },
  });
}

export function useQuitarAbreviatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await rpc("abreviaturas_quitar", { p_id: id });
      if (error) throw new Error(error.message);
      return data as { quitada?: boolean };
    },
    onSuccess: () => {
      toast.success("Quitada: no se volverá a aprender");
      void qc.invalidateQueries({ queryKey: CLAVE_ABREVIATURAS_APRENDIDAS });
    },
    onError: (e: Error) => toast.error("No se ha podido quitar", { description: e.message }),
  });
}
