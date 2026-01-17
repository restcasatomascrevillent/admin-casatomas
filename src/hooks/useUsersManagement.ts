import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole, AppRole, SECTIONS } from "./useUserRole";
import { toast } from "sonner";

export interface ManagedUser {
  id: string;
  email: string;
  display_name: string | null;
  role: AppRole | null;
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

  const fetchUsers = async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Obtener usuarios desde auth.users mediante edge function
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      let authUsersMap = new Map<string, { email: string; display_name: string | null }>();
      
      if (token) {
        try {
          const response = await supabase.functions.invoke("list-users", {
            headers: { Authorization: `Bearer ${token}` },
          });
          
          if (response.data?.users) {
            response.data.users.forEach((u: { id: string; email: string; display_name: string | null }) => {
              authUsersMap.set(u.id, { email: u.email, display_name: u.display_name });
            });
          }
        } catch (e) {
          console.error("Error fetching auth users:", e);
        }
      }

      // Obtener roles
      const { data: rolesData, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role, created_at");

      if (rolesError) throw rolesError;

      // Obtener todos los permisos
      const { data: permissionsData, error: permError } = await supabase
        .from("user_permissions")
        .select("user_id, section_key, can_view, can_edit");

      if (permError) throw permError;

      // Agrupar por usuario
      const userMap = new Map<string, ManagedUser>();

      rolesData?.forEach((r) => {
        const authUser = authUsersMap.get(r.user_id);
        userMap.set(r.user_id, {
          id: r.user_id,
          email: authUser?.email || "",
          display_name: authUser?.display_name || null,
          role: r.role as AppRole,
          created_at: r.created_at,
          permissions: [],
        });
      });

      permissionsData?.forEach((p) => {
        const user = userMap.get(p.user_id);
        if (user) {
          user.permissions.push({
            section_key: p.section_key,
            can_view: p.can_view,
            can_edit: p.can_edit,
          });
        }
      });

      const usersArray = Array.from(userMap.values());
      
      setUsers(usersArray);
    } catch (error) {
      console.error("Error fetching users:", error);
      toast.error("Error al cargar usuarios");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [isAdmin]);

  const updateUserRole = async (userId: string, newRole: AppRole) => {
    try {
      const { error } = await supabase
        .from("user_roles")
        .upsert({ user_id: userId, role: newRole }, { onConflict: "user_id,role" });

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
            can_view: canView,
            can_edit: canEdit,
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
      await supabase
        .from("user_permissions")
        .delete()
        .eq("user_id", userId);

      // Insertar nuevos permisos
      const { error } = await supabase
        .from("user_permissions")
        .insert(
          permissions.map((p) => ({
            user_id: userId,
            section_key: p.section_key,
            can_view: p.can_view,
            can_edit: p.can_edit,
          }))
        );

      if (error) throw error;

      toast.success("Permisos actualizados");
      fetchUsers();
    } catch (error) {
      console.error("Error setting permissions:", error);
      toast.error("Error al establecer permisos");
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
        .insert({ user_id: userId, role });

      if (error) throw error;

      // Asignar permisos por defecto según rol
      const defaultPermissions = SECTIONS.map((s) => ({
        user_id: userId,
        section_key: s.key,
        can_view: role === "manager" || s.key === "dashboard",
        can_edit: false,
      }));

      await supabase.from("user_permissions").insert(defaultPermissions);

      return true;
    } catch (error) {
      console.error("Error assigning role:", error);
      return false;
    }
  };

  const deleteUser = async (userId: string) => {
    try {
      // Eliminar rol (los permisos se eliminan en cascada)
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId);

      if (error) throw error;

      toast.success("Usuario eliminado del sistema de permisos");
      fetchUsers();
    } catch (error) {
      console.error("Error deleting user:", error);
      toast.error("Error al eliminar usuario");
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
    inviteUser,
    assignRoleToNewUser,
    deleteUser,
  };
}
