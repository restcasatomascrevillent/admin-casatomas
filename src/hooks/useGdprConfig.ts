import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface GdprConfig {
  id: string;
  tabla: string;
  dias_retencion: number;
  accion: "eliminar" | "anonimizar";
  campos_anonimizar: string[] | null;
  activo: boolean;
  descripcion: string | null;
  created_at: string;
  updated_at: string;
}

export interface GdprAuditLog {
  id: string;
  accion: string;
  tabla: string;
  registros_afectados: number;
  detalles: Record<string, unknown> | null;
  ejecutado_por: string;
  created_at: string;
}

// Hook para obtener configuración GDPR
export function useGdprConfig() {
  return useQuery({
    queryKey: ["gdpr-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gdpr_config")
        .select("*")
        .order("tabla");

      if (error) throw error;
      return data as GdprConfig[];
    },
  });
}

// Hook para obtener log de auditoría GDPR
export function useGdprAuditLog(limit: number = 50) {
  return useQuery({
    queryKey: ["gdpr-audit-log", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gdpr_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as GdprAuditLog[];
    },
  });
}

// Hook para actualizar configuración GDPR
export function useActualizarGdprConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: Partial<GdprConfig> & { id: string }) => {
      const { id, ...updates } = config;
      const { data, error } = await supabase
        .from("gdpr_config")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gdpr-config"] });
      toast.success("Configuración GDPR actualizada");
    },
    onError: (error) => {
      toast.error(`Error al actualizar: ${error.message}`);
    },
  });
}

// Hook para ejecutar limpieza GDPR manualmente
export function useEjecutarLimpiezaGdpr() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .rpc("ejecutar_limpieza_gdpr");

      if (error) throw error;
      return data as { tabla: string; accion: string; registros_procesados: number }[];
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["gdpr-audit-log"] });
      const totalProcesados = data?.reduce((acc, r) => acc + r.registros_procesados, 0) || 0;
      if (totalProcesados > 0) {
        toast.success(`Limpieza GDPR completada: ${totalProcesados} registros procesados`);
      } else {
        toast.info("No hay registros que procesar en este momento");
      }
    },
    onError: (error) => {
      toast.error(`Error en limpieza GDPR: ${error.message}`);
    },
  });
}
