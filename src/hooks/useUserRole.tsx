import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { SUPER_ADMIN_EMAILS, isSuperAdmin as checkIsSuperAdmin } from "@/config/permissions";

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
  // "trabajadores" (Personal) retirada el 2026-09-23 (decisión del dueño).
  // Filas de user_permissions con section_key="trabajadores" que puedan
  // quedar en la BD se ignoran sin más: ningún componente busca ya esa key.
  { key: "gestor_carta", label: "Gestor Web · Carta" },
  { key: "gestion_web", label: "Gestor Web · Novedades, menús y tapas" },
  { key: "gestion_bot", label: "Gestor Web · Bot web" },
  { key: "marketing", label: "Newsletter" },
  { key: "facturas", label: "Facturas" },
  { key: "usuarios", label: "Usuarios" },
] as const;
// Nota: Ecommerce, Asistente Tel., Gestor Gasto, Reseñas Google, Plantillas
// Email, Tráfico web y Espacios se gestionan exclusivamente desde el Super Admin y ya
// no forman parte del Admin Panel normal.

export type SectionKey = typeof SECTIONS[number]["key"];

const UserRoleContext = createContext<UserRoleData | null>(null);

/**
 * Única consulta de rol/permisos para toda la app (2026-09-25).
 *
 * Mismo problema que useAuth: ProtectedRoute y AppSidebar llamaban cada uno
 * a su propio useUserRole(), así que cada carga de página disparaba DOS
 * consultas independientes a user_roles y user_permissions, con dos
 * `loading` que resolvían en momentos distintos — parte del lag y el
 * parpadeo al entrar. Ahora la consulta vive una sola vez aquí, en
 * UserRoleProvider, y useUserRole()/useCanAccessSection() solo leen ese
 * contexto.
 */
export function UserRoleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [permissions, setPermissions] = useState<UserPermissions[]>([]);
  const [loading, setLoading] = useState(true);

  const isSuperAdminUser = checkIsSuperAdmin(user?.email);

  useEffect(() => {
    if (!user) {
      setRole(null);
      setPermissions([]);
      setLoading(false);
      return;
    }

    // Si es super admin, acceso inmediato
    if (isSuperAdminUser) {
      setRole("admin");
      setLoading(false);
    }

    const fetchRoleAndPermissions = async () => {
      // Si no es super admin, mostramos loading
      if (!isSuperAdminUser) setLoading(true);

      try {
        // Obtener rol
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (roleData) {
          setRole(roleData.role as AppRole);
        } else if (isSuperAdminUser) {
          setRole("admin");
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
        if (!isSuperAdminUser) setLoading(false);
      }
    };

    fetchRoleAndPermissions();
  }, [user, isSuperAdminUser]);

  const isAdmin = role === "admin" || isSuperAdminUser;

  const value: UserRoleData = {
    role: isSuperAdminUser ? "admin" : role,
    isAdmin,
    permissions,
    loading,
  };

  return <UserRoleContext.Provider value={value}>{children}</UserRoleContext.Provider>;
}

export function useUserRole(): UserRoleData {
  const context = useContext(UserRoleContext);
  if (!context) {
    throw new Error("useUserRole debe usarse dentro de <UserRoleProvider>");
  }
  return context;
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
