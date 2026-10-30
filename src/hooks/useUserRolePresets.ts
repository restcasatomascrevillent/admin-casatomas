import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

export type PresetBaseRole = "admin" | "manager" | "staff";

export interface RolePresetPermission {
  section_key: string;
  can_view: boolean;
  can_edit: boolean;
}

export interface UserRolePreset {
  id: string;
  name: string;
  base_role: PresetBaseRole;
  permissions: RolePresetPermission[];
  created_at: string;
  updated_at: string;
}

// Las plantillas guardan también «Puede editar» (2026-10-01; antes se forzaba
// can_edit: false al leer y al escribir, y aplicar una plantilla quitaba la
// edición). Editar implica ver. Las plantillas ya guardadas tienen can_edit =
// false, así que para ellas nada cambia. Aplicarlas sigue sujeto a quién puede
// conceder edición (solo un super admin): ver ListaUsuarios / InvitarUsuario.
const normalizePermissions = (permissions: RolePresetPermission[]): RolePresetPermission[] =>
  permissions.map((permission) => {
    const canEdit = Boolean(permission.can_edit);
    return {
      section_key: permission.section_key,
      can_view: canEdit || Boolean(permission.can_view),
      can_edit: canEdit,
    };
  });

const parsePermissions = (value: unknown): RolePresetPermission[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const sectionKey = typeof record.section_key === "string" ? record.section_key : "";
      const canEdit = Boolean(record.can_edit);
      const canView = Boolean(record.can_view) || canEdit;

      if (!sectionKey) return null;

      return {
        section_key: sectionKey,
        can_view: canView,
        can_edit: canEdit,
      };
    })
    .filter((item): item is RolePresetPermission => item !== null);
};

export function useUserRolePresets() {
  const [presets, setPresets] = useState<UserRolePreset[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_role_presets")
        .select("id, name, base_role, permissions, created_at, updated_at")
        .order("name", { ascending: true });

      if (error) throw error;

      const mappedPresets: UserRolePreset[] = (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        base_role: row.base_role as PresetBaseRole,
        permissions: parsePermissions(row.permissions),
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));

      setPresets(mappedPresets);
    } catch (error) {
      console.error("Error fetching role presets:", error);
      toast.error("Error al cargar roles preconfigurados");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPresets();
  }, [fetchPresets]);

  const createPreset = async (
    name: string,
    baseRole: PresetBaseRole,
    permissions: RolePresetPermission[]
  ): Promise<UserRolePreset | null> => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      toast.error("El nombre del rol es obligatorio");
      return null;
    }

    try {
      const normalizedPermissions = normalizePermissions(permissions);
      const { data, error } = await supabase
        .from("user_role_presets")
        .insert({
          name: normalizedName,
          base_role: baseRole,
          permissions: normalizedPermissions as unknown as import('@/integrations/supabase/types').Json,
        })
        .select("id, name, base_role, permissions, created_at, updated_at")
        .single();

      if (error) throw error;

      const createdPreset: UserRolePreset = {
        id: data.id,
        name: data.name,
        base_role: data.base_role as PresetBaseRole,
        permissions: parsePermissions(data.permissions),
        created_at: data.created_at,
        updated_at: data.updated_at,
      };

      setPresets((prev) => [...prev, createdPreset].sort((a, b) => a.name.localeCompare(b.name, "es")));
      toast.success("Rol preconfigurado guardado");
      return createdPreset;
    } catch (error) {
      console.error("Error creating role preset:", error);
      const message = mensajeUsuario(error, "Error al crear el rol preconfigurado");
      toast.error(message);
      return null;
    }
  };

  const deletePreset = async (presetId: string) => {
    try {
      const { error } = await supabase.from("user_role_presets").delete().eq("id", presetId);
      if (error) throw error;

      setPresets((prev) => prev.filter((preset) => preset.id !== presetId));
      toast.success("Rol preconfigurado eliminado");
      return true;
    } catch (error) {
      console.error("Error deleting role preset:", error);
      toast.error("Error al eliminar el rol preconfigurado");
      return false;
    }
  };

  const updatePreset = async (
    presetId: string,
    name: string,
    baseRole: PresetBaseRole,
    permissions: RolePresetPermission[]
  ): Promise<UserRolePreset | null> => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      toast.error("El nombre del rol es obligatorio");
      return null;
    }

    try {
      const normalizedPermissions = normalizePermissions(permissions);
      const { data, error } = await supabase
        .from("user_role_presets")
        .update({
          name: normalizedName,
          base_role: baseRole,
          permissions: normalizedPermissions as unknown as import('@/integrations/supabase/types').Json,
        })
        .eq("id", presetId)
        .select("id, name, base_role, permissions, created_at, updated_at")
        .single();

      if (error) throw error;

      const updatedPreset: UserRolePreset = {
        id: data.id,
        name: data.name,
        base_role: data.base_role as PresetBaseRole,
        permissions: parsePermissions(data.permissions),
        created_at: data.created_at,
        updated_at: data.updated_at,
      };

      setPresets((prev) =>
        prev
          .map((preset) => (preset.id === updatedPreset.id ? updatedPreset : preset))
          .sort((a, b) => a.name.localeCompare(b.name, "es"))
      );

      toast.success("Rol preconfigurado actualizado");
      return updatedPreset;
    } catch (error) {
      console.error("Error updating role preset:", error);
      const message = mensajeUsuario(error, "Error al actualizar el rol preconfigurado");
      toast.error(message);
      return null;
    }
  };

  return {
    presets,
    loading,
    fetchPresets,
    createPreset,
    updatePreset,
    deletePreset,
  };
}
