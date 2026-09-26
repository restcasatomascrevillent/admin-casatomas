import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole, AppRole, SECTIONS } from "./useUserRole";
import { toast } from "sonner";

export interface ManagedUser {
  id: string;
  email: string;
  display_name: string | null;
  role: AppRole | null;
  is_super_admin: boolean;
  created_at: string;
  permissions: {
    section_key: string;
    can_view: boolean;
    can_edit: boolean;
  }[];
}

export function useUsersManagement() {
  const { isAdmin } = useUserRole();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);

  const extractFunctionErrorMessage = async (error: unknown, fallbackMessage: string) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "context" in error &&
      (error as { context?: unknown }).context instanceof Response
    ) {
      try {
        const payload = await (error as { context: Response }).context.clone().json() as { error?: string };
        if (payload?.error) return payload.error;
      } catch {
        // ignore parse errors and fallback below
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallbackMessage;
  };

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) {
      setUsers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Obtener usuarios desde auth.users mediante edge function
      const authUsersMap = new Map<
        string,
        { email: string; display_name: string | null; created_at: string }
      >();

      try {
        const response = await supabase.functions.invoke<{
          users: Array<{ id: string; email: string | null; display_name: string | null; created_at: string }>;
        }>("list-users");

        if (response.error) {
          throw response.error;
        }

        if (response.data?.users) {
          response.data.users.forEach((u) => {
            authUsersMap.set(u.id, {
              email: u.email ?? "",
              display_name: u.display_name,
              created_at: u.created_at,
            });
          });
        }
      } catch (e) {
        console.error("Error fetching auth users:", e);

        const status =
          typeof e === "object" &&
          e !== null &&
          "context" in e &&
          (e as { context?: unknown }).context instanceof Response
            ? (e as { context: Response }).context.status
            : null;

        if (status === 401 || status === 403) {
          await supabase.auth.signOut({ scope: "local" });
          throw new Error("Tu sesión ha expirado. Inicia sesión de nuevo.");
        }
      }

      const [
        { data: rolesData, error: rolesError },
        { data: permissionsData, error: permError },
        { data: superAdminsData, error: superAdminsError },
      ] = await Promise.all([
        supabase.from("user_roles").select("user_id, role, created_at"),
        supabase.from("user_permissions").select("user_id, section_key, can_view, can_edit"),
        supabase.from("super_admins").select("user_id"),
      ]);

      if (rolesError) throw rolesError;
      if (permError) throw permError;
      if (superAdminsError) throw superAdminsError;

      const superAdminIds = new Set(
        (superAdminsData ?? []).map((s) => s.user_id).filter((id): id is string => !!id)
      );

      const userMap = new Map<string, ManagedUser>();

      authUsersMap.forEach((authUser, userId) => {
        userMap.set(userId, {
          id: userId,
          email: authUser.email,
          display_name: authUser.display_name,
          role: null,
          is_super_admin: superAdminIds.has(userId),
          created_at: authUser.created_at,
          permissions: [],
        });
      });

      rolesData?.forEach((r) => {
        const existing = userMap.get(r.user_id);
        if (existing) {
          existing.role = r.role as AppRole;
          if (!existing.created_at && r.created_at) {
            existing.created_at = r.created_at;
          }
          return;
        }

        userMap.set(r.user_id, {
          id: r.user_id,
          email: "",
          display_name: null,
          role: r.role as AppRole,
          is_super_admin: superAdminIds.has(r.user_id),
          created_at: r.created_at || "",
          permissions: [],
        });
      });

      permissionsData?.forEach((p) => {
        let user = userMap.get(p.user_id);
        if (!user) {
          user = {
            id: p.user_id,
            email: "",
            display_name: null,
            role: null,
            is_super_admin: superAdminIds.has(p.user_id),
            created_at: "",
            permissions: [],
          };
          userMap.set(p.user_id, user);
        }

        const canEdit = Boolean(p.can_edit);
        const canView = Boolean(p.can_view) || canEdit;

        user.permissions.push({
          section_key: p.section_key,
          can_view: canView,
          can_edit: canEdit,
        });
      });

      const usersArray = Array.from(userMap.values()).sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeB - timeA;
      });

      setUsers(usersArray);
    } catch (error) {
      console.error("Error fetching users:", error);
      toast.error("Error al cargar usuarios");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const updateUserRole = async (userId: string, newRole: AppRole) => {
    try {
      const { error } = await supabase
        .from("user_roles")
        .upsert({ user_id: userId, role: newRole }, { onConflict: "user_id" });

      if (error) throw error;

      toast.success("Rol actualizado correctamente");
      fetchUsers();
    } catch (error) {
      console.error("Error updating role:", error);
      toast.error("Error al actualizar el rol");
    }
  };

  const updateUserPermission = async (
    userId: string,
    sectionKey: string,
    canView: boolean,
    canEdit: boolean
  ) => {
    try {
      const { error } = await supabase
        .from("user_permissions")
        .upsert(
          {
            user_id: userId,
            section_key: sectionKey,
            can_view: canEdit ? true : canView,
            can_edit: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,section_key" }
        );

      if (error) throw error;

      toast.success("Permiso actualizado");
      fetchUsers();
    } catch (error) {
      console.error("Error updating permission:", error);
      toast.error("Error al actualizar el permiso");
    }
  };

  const setAllPermissions = async (userId: string, permissions: { section_key: string; can_view: boolean; can_edit: boolean }[]) => {
    try {
      // Primero eliminar permisos existentes
      const { error: deleteError } = await supabase
        .from("user_permissions")
        .delete()
        .eq("user_id", userId);
      if (deleteError) throw deleteError;

      const normalizedPermissions = permissions.map((p) => ({
        user_id: userId,
        section_key: p.section_key,
        can_view: p.can_edit ? true : p.can_view,
        can_edit: false,
      }));

      if (normalizedPermissions.length > 0) {
        const { error } = await supabase
          .from("user_permissions")
          .insert(normalizedPermissions);

        if (error) throw error;
      }

      toast.success("Permisos actualizados");
      fetchUsers();
    } catch (error) {
      console.error("Error setting permissions:", error);
      toast.error("Error al establecer permisos");
    }
  };

  const updateUserPassword = async (userId: string, password: string) => {
    try {
      const { data, error } = await supabase.functions.invoke<{ success?: boolean; error?: string }>(
        "admin-update-user-password",
        {
          body: { userId, password },
        }
      );

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "No se pudo actualizar la contraseña");

      toast.success("Contraseña actualizada correctamente");
      return true;
    } catch (error) {
      console.error("Error updating password:", error);
      const message = await extractFunctionErrorMessage(error, "Error al actualizar la contraseña");
      toast.error(message);
      return false;
    }
  };

  const setSuperAdmin = async (userId: string, makeSuperAdmin: boolean) => {
    try {
      const { data, error } = await supabase.functions.invoke<{ success?: boolean; error?: string }>(
        "admin-set-super-admin",
        {
          body: { userId, makeSuperAdmin },
        }
      );

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "No se pudo actualizar el acceso de super admin");

      toast.success(
        makeSuperAdmin ? "Usuario añadido como super admin" : "Acceso de super admin revocado"
      );
      fetchUsers();
      return true;
    } catch (error) {
      console.error("Error updating super admin status:", error);
      const message = await extractFunctionErrorMessage(error, "Error al actualizar el acceso de super admin");
      toast.error(message);
      return false;
    }
  };

  const inviteUser = async (email: string, role: AppRole, permissions: { section_key: string; can_view: boolean; can_edit: boolean }[]) => {
    try {
      // Crear usuario mediante Supabase Auth Admin (requiere service role key)
      // Por ahora, el admin puede registrar usuarios manualmente
      toast.info("El usuario debe registrarse con este email: " + email);
      
      // Guardamos la configuración pendiente para cuando el usuario se registre
      // Esto requeriría una tabla adicional o un trigger
      
      return true;
    } catch (error) {
      console.error("Error inviting user:", error);
      toast.error("Error al invitar usuario");
      return false;
    }
  };

  const assignRoleToNewUser = async (userId: string, role: AppRole = "staff") => {
    try {
      const { error } = await supabase
        .from("user_roles")
        .upsert({ user_id: userId, role }, { onConflict: "user_id" });

      if (error) throw error;

      // Asignar permisos por defecto según rol
      const defaultPermissions = SECTIONS.map((s) => ({
        user_id: userId,
        section_key: s.key,
        can_view: role === "manager" || s.key === "dashboard",
        can_edit: false,
      }));

      const { error: permissionsError } = await supabase.from("user_permissions").upsert(defaultPermissions, {
        onConflict: "user_id,section_key",
      });
      if (permissionsError) throw permissionsError;

      return true;
    } catch (error) {
      console.error("Error assigning role:", error);
      return false;
    }
  };

  const deleteUser = async (userId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke<{ success?: boolean; error?: string }>(
        "admin-delete-user",
        {
          body: { userId },
        }
      );

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "No se pudo eliminar el usuario");

      toast.success("Usuario eliminado correctamente");
      fetchUsers();
    } catch (error) {
      console.error("Error deleting user:", error);
      toast.error(error instanceof Error ? error.message : "Error al eliminar usuario");
    }
  };

  return {
    users,
    loading,
    isAdmin,
    fetchUsers,
    updateUserRole,
    updateUserPermission,
    setAllPermissions,
    updateUserPassword,
    setSuperAdmin,
    inviteUser,
    assignRoleToNewUser,
    deleteUser,
  };
}
