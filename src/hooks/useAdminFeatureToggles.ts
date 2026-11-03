import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

export interface AdminFeatureToggle {
  section_key: string;
  label: string;
  enabled: boolean;
  /** Último cambio (Control del Panel lo enseña). */
  updated_at?: string | null;
}

export function useAdminFeatureToggles() {
  const [toggles, setToggles] = useState<AdminFeatureToggle[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchToggles = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("admin_feature_toggles")
      .select("section_key, label, enabled, updated_at")
      .order("label", { ascending: true });

    if (!error && data) {
      setToggles(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchToggles();
  }, [fetchToggles]);

  const isEnabled = useCallback(
    (sectionKey: string) => {
      const toggle = toggles.find((t) => t.section_key === sectionKey);
      // Si aún no hay registro para la sección, se muestra por defecto.
      return toggle ? toggle.enabled : true;
    },
    [toggles]
  );

  const setEnabled = async (sectionKey: string, label: string, enabled: boolean) => {
    const { data: userData } = await supabase.auth.getUser();
    const updatedAt = new Date().toISOString();

    const { error } = await supabase.from("admin_feature_toggles").upsert(
      {
        section_key: sectionKey,
        label,
        enabled,
        updated_at: updatedAt,
        updated_by: userData.user?.id,
      },
      { onConflict: "section_key" }
    );

    if (error) {
      toast.error("Error al actualizar la funcionalidad: " + mensajeUsuario(error, "inténtalo de nuevo"));
      return false;
    }

    setToggles((prev) => {
      const exists = prev.some((t) => t.section_key === sectionKey);
      if (exists) {
        return prev.map((t) => (t.section_key === sectionKey ? { ...t, enabled, updated_at: updatedAt } : t));
      }
      return [...prev, { section_key: sectionKey, label, enabled, updated_at: updatedAt }];
    });

    toast.success(enabled ? "Funcionalidad activada" : "Funcionalidad desactivada");
    return true;
  };

  return { toggles, loading, isEnabled, setEnabled, refetch: fetchToggles };
}
