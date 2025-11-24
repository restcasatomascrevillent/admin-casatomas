import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "./useAuth";

export interface WidgetConfig {
  id: string;
  nombre: string;
  activo: boolean;
  orden: number;
}

export interface DashboardConfig {
  id: string;
  nombre_vista: string;
  widgets_activos: string[];
  orden_widgets: string[];
  is_default: boolean;
}

export function useDashboardConfig() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: configs } = useQuery({
    queryKey: ["dashboard-config", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("dashboard_config")
        .select("*")
        .eq("user_id", user.id)
        .order("is_default", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  const { data: activeConfig } = useQuery({
    queryKey: ["active-dashboard-config", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("dashboard_config")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_default", true)
        .single();
      return data;
    },
    enabled: !!user,
  });

  const saveConfig = useMutation({
    mutationFn: async ({ nombre, widgets, orden }: { nombre: string; widgets: string[]; orden: string[] }) => {
      if (!user) throw new Error("No user");
      
      const { data, error } = await supabase
        .from("dashboard_config")
        .upsert({
          user_id: user.id,
          nombre_vista: nombre,
          widgets_activos: widgets,
          orden_widgets: orden,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-config"] });
      toast.success("Configuración guardada");
    },
    onError: () => {
      toast.error("Error al guardar configuración");
    },
  });

  const setDefaultConfig = useMutation({
    mutationFn: async (configId: string) => {
      if (!user) throw new Error("No user");
      
      // Quitar default de todas
      await supabase
        .from("dashboard_config")
        .update({ is_default: false })
        .eq("user_id", user.id);

      // Poner esta como default
      const { error } = await supabase
        .from("dashboard_config")
        .update({ is_default: true })
        .eq("id", configId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-config"] });
      queryClient.invalidateQueries({ queryKey: ["active-dashboard-config"] });
      toast.success("Vista predeterminada actualizada");
    },
  });

  const deleteConfig = useMutation({
    mutationFn: async (configId: string) => {
      const { error } = await supabase
        .from("dashboard_config")
        .delete()
        .eq("id", configId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-config"] });
      toast.success("Vista eliminada");
    },
  });

  return {
    configs,
    activeConfig,
    saveConfig,
    setDefaultConfig,
    deleteConfig,
  };
}
