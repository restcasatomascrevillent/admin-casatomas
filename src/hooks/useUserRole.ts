import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type AppRole = "admin" | "manager" | "staff";

export interface UserPermissions {
  section_key: string;
  can_view: boolean;
  can_edit: boolean;
}

export interface UserRoleData {
  role: AppRole | null;
  isAdmin: boolean;
  permissions: UserPermissions[];
  loading: boolean;
}

export const SECTIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "reservas", label: "Reservas" },
  { key: "espacios", label: "Espacios" },
  { key: "trabajadores", label: "Personal" },
  { key: "gestor_carta", label: "Gestor Carta" },
  { key: "gestion_web", label: "Gestión Web" },
  { key: "marketing", label: "Marketing" },
  { key: "facturas", label: "Facturas" },
  { key: "analisis", label: "Análisis" },
  { key: "touza", label: "Touza" },
  { key: "usuarios", label: "Usuarios" },
] as const;

export type SectionKey = typeof SECTIONS[number]["key"];

export function useUserRole(): UserRoleData {
  const { user } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [permissions, setPermissions] = useState<UserPermissions[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRole(null);
      setPermissions([]);
      setLoading(false);
      return;
    }

    const fetchRoleAndPermissions = async () => {
      setLoading(true);
      try {
        // Obtener rol
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (roleData) {
          setRole(roleData.role as AppRole);
        }

        // Obtener permisos
        const { data: permData } = await supabase
          .from("user_permissions")
          .select("section_key, can_view, can_edit")
          .eq("user_id", user.id);

        if (permData) {
          setPermissions(permData);
        }
      } catch (error) {
        console.error("Error fetching role/permissions:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchRoleAndPermissions();
  }, [user]);

  const isAdmin = role === "admin";

  return { role, isAdmin, permissions, loading };
}

export function useCanAccessSection(sectionKey: SectionKey, permissionType: "view" | "edit" = "view") {
  const { isAdmin, permissions, loading } = useUserRole();

  if (loading) return { canAccess: false, loading: true };
  
  if (isAdmin) return { canAccess: true, loading: false };

  const permission = permissions.find(p => p.section_key === sectionKey);
  
  if (!permission) return { canAccess: false, loading: false };

  const canAccess = permissionType === "view" ? permission.can_view : permission.can_edit;
  
  return { canAccess, loading: false };
}
