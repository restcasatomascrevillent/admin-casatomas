import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole, AppRole, SECTIONS } from "./useUserRole";
import { SECCIONES_CONFIGURABLES } from "@/components/usuarios/permisosSecciones";
import { toast } from "sonner";

/** Secciones que gestiona el diálogo «Permisos»: el guardado no toca ninguna otra. */
const SECCIONES_DEL_DIALOGO = new Set<string>(SECCIONES_CONFIGURABLES.map((s) => s.key));

const etiquetaSeccion = (clave: string) => SECCIONES_CONFIGURABLES.find((s) => s.key === clave)?.label ?? clave;

/**
 * ¿Lo ha rechazado la BD (código de Postgres o de PostgREST)? Entonces la escritura no se
 * ha aplicado. Sin código (se cae la red, error desconocido) pudo llegar a aplicarse.
 */
const esRechazoDeLaBd = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^(PGRST\d+|[0-9A-Z]{5})$/.test(code);
};

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
            // Editar implica ver. can_edit se escribe tal cual (hasta el
            // 2026-10-01 se forzaba a false y la edición no se podía dar desde
            // el panel). Solo un super admin puede escribir aquí (RLS).
            can_view: canEdit ? true : canView,
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

  /**
   * Guarda el diálogo «Permisos» sin transacción y sin dejar NUNCA al usuario con
   * menos permisos de los que tenía (2026-10-01). Hasta entonces se borraban TODAS
   * sus filas y se reinsertaban solo las del diálogo: se perdían las secciones que
   * el diálogo no gestiona (gestion_bot, asistente_telefonico…) y, si el insert
   * fallaba tras el borrado, se quedaba sin ningún permiso. Ahora:
   *   1. UPSERT (clave única user_id + section_key) de las secciones del diálogo
   *      que quedan con «Ver». Es un solo INSERT … ON CONFLICT: entra todo o nada.
   *   2. DESPUÉS, DELETE solo de las secciones del diálogo que se han desmarcado, y se
   *      relee: con RLS un DELETE denegado no da error, borra 0 filas.
   * Si falla 1 no se borra nada; si falla 2, sobran permisos un rato, nunca faltan. Solo
   * devuelve true si todo ha quedado como se pidió.
   * Las secciones que no son del diálogo (SECCIONES_CONFIGURABLES) no se tocan.
   *
   * «Puede editar» solo lo escribe quien puede concederlo (un super admin, como la
   * RLS). Si no, no se manda `can_edit` (se queda el que hay; una fila nueva nace
   * sin edición) ni se borra una fila con edición.
   */
  const setAllPermissions = async (
    userId: string,
    permissions: { section_key: string; can_view: boolean; can_edit: boolean }[],
    { puedeConcederEdicion }: { puedeConcederEdicion: boolean }
  ): Promise<boolean> => {
    const delDialogo = permissions.filter((p) => SECCIONES_DEL_DIALOGO.has(p.section_key));
    // Editar implica ver.
    const marcadas = delDialogo.filter((p) => p.can_view || p.can_edit);
    const desmarcadas = delDialogo.filter((p) => !p.can_view && !p.can_edit).map((p) => p.section_key);
    const ahora = new Date().toISOString();

    try {
      if (marcadas.length > 0) {
        const { error } = await supabase.from("user_permissions").upsert(
          marcadas.map((p) => ({
            user_id: userId,
            section_key: p.section_key,
            can_view: true,
            ...(puedeConcederEdicion ? { can_edit: Boolean(p.can_edit) } : {}),
            updated_at: ahora,
          })),
          { onConflict: "user_id,section_key" }
        );
        if (error) throw error;
      }
    } catch (error) {
      console.error("Error setting permissions:", error);
      const description = (error as { message?: string })?.message || undefined;
      if (esRechazoDeLaBd(error)) {
        toast.error("No se han guardado los permisos: no se ha cambiado nada", { description });
      } else {
        // Pudo aplicarse antes de perder la respuesta: se relee la lista.
        toast.error("Puede que no se haya guardado: revisa cómo han quedado los permisos", { description });
        fetchUsers();
      }
      return false;
    }

    try {
      if (desmarcadas.length > 0) {
        let borrado = supabase
          .from("user_permissions")
          .delete()
          .eq("user_id", userId)
          .in("section_key", desmarcadas);
        if (!puedeConcederEdicion) borrado = borrado.eq("can_edit", false);
        const { error } = await borrado;
        if (error) throw error;
        // Un DELETE que la RLS no deja hacer NO da error: borra 0 filas. Se relee lo
        // desmarcado para no dar por quitado lo que sigue dando acceso.
        const { data: releidas, error: errorRelectura } = await supabase
          .from("user_permissions")
          .select("section_key, can_view, can_edit")
          .eq("user_id", userId)
          .in("section_key", desmarcadas);
        if (errorRelectura) throw errorRelectura;
        const siguen = (releidas ?? []).filter((f) => f.can_view || f.can_edit);
        if (siguen.length > 0) {
          throw new Error(`Siguen activos: ${siguen.map((f) => etiquetaSeccion(f.section_key)).join(", ")}.`);
        }
      }
    } catch (error) {
      console.error("Error removing unchecked permissions:", error);
      toast.error("No se han podido quitar algunos permisos: vuelve a guardar", {
        description: (error as { message?: string })?.message || undefined,
      });
      fetchUsers();
      return false;
    }

    toast.success("Permisos actualizados");
    fetchUsers();
    return true;
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

      // Asignar permisos por defecto según rol. Un usuario nuevo empieza SIN
      // edición en ninguna sección: la da después un super admin en «Permisos».
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
