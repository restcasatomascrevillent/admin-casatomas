import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useSuperAdmin } from "./useSuperAdmin";
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
  { key: "marketing", label: "Newsletter" },
  { key: "cheques", label: "Cheques regalo" },
  { key: "facturas", label: "Facturas" },
  { key: "usuarios", label: "Usuarios" },
] as const;
// Nota: Ecommerce, Asistente Tel., Gestor Gasto, Reseñas Google, Plantillas
// Email, Tráfico web, Espacios y Bot Web se gestionan exclusivamente desde el
// Super Admin y ya no forman parte del Admin Panel normal.

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
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [permissions, setPermissions] = useState<UserPermissions[]>([]);
  const [loading, setLoading] = useState(true);

  // Se depende de valores primitivos (id, email), NO del objeto `user`:
  // supabase-js re-emite SIGNED_IN / TOKEN_REFRESHED al volver a la app y eso
  // no debe relanzar la consulta ni poner loading=true (desmontaría la página
  // protegida, con sus formularios y diálogos). Un usuario distinto sí cambia
  // el id y recarga rol y permisos.
  const userId = user?.id ?? null;
  const isSuperAdminUser = checkIsSuperAdmin(user?.email);

  useEffect(() => {
    // Espera a que useAuth resuelva del todo antes de decidir nada. Sin este
    // guard, en el instante en que `user` todavía es null (useAuth sigue
    // validando la sesión) este efecto ya resolvía loading=false; cuando
    // `user` llegaba un instante después, había un render en el que TANTO
    // authLoading como este loading leían false a la vez → se veía el
    // contenido de la página → y acto seguido este efecto volvía a poner
    // loading=true para pedir el rol → aparecía el spinner encima. Ese
    // "página y luego spinner" era exactamente esta carrera.
    if (authLoading) return;

    if (!userId) {
      setRole(null);
      setPermissions([]);
      setLoading(false);
      return;
    }

    let isMounted = true;

    // Este efecto solo corre al cargar o al cambiar de usuario (nunca en un
    // refresco de token), así que es seguro descartar lo del usuario anterior.
    setRole(null);
    setPermissions([]);

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
          .eq("user_id", userId)
          .single();
        if (!isMounted) return;

        if (roleData) {
          setRole(roleData.role as AppRole);
        } else if (isSuperAdminUser) {
          setRole("admin");
        }

        // Obtener permisos
        const { data: permData } = await supabase
          .from("user_permissions")
          .select("section_key, can_view, can_edit")
          .eq("user_id", userId);
        if (!isMounted) return;

        if (permData) {
          setPermissions(permData);
        }
      } catch (error) {
        console.error("Error fetching role/permissions:", error);
      } finally {
        if (isMounted && !isSuperAdminUser) setLoading(false);
      }
    };

    fetchRoleAndPermissions();

    return () => {
      isMounted = false;
    };
  }, [userId, authLoading, isSuperAdminUser]);

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
  const { permissions, loading } = useUserRole();
  const { isSuperAdmin, loading: superAdminLoading } = useSuperAdmin();

  if (loading || superAdminLoading) return { canAccess: false, loading: true };

  // Ser "admin" ya no da acceso automático a todo (2026-09-26): un admin solo
  // ve lo que le marquen sus permisos, igual que un manager o un staff. El
  // único acceso incondicional es el de super admin (tabla super_admins),
  // igual que en has_section_permission() del lado de la base de datos.
  if (isSuperAdmin) return { canAccess: true, loading: false };

  const permission = permissions.find(p => p.section_key === sectionKey);

  if (!permission) return { canAccess: false, loading: false };

  const canAccess = permissionType === "view" ? permission.can_view : permission.can_edit;

  return { canAccess, loading: false };
}

