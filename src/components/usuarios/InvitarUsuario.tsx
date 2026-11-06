import { useState } from "react";
import { AppRole } from "@/hooks/useUserRole";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mensajeErrorUsuarios } from "@/lib/errores-usuarios";
import { useUserRolePresets, UserRolePreset, PresetBaseRole } from "@/hooks/useUserRolePresets";
import { ConfigurarRolesModal } from "@/components/usuarios/ConfigurarRolesModal";
import { TablaPermisosSecciones } from "@/components/usuarios/TablaPermisosSecciones";
import {
  cambiarEditar,
  cambiarVer,
  permisosParaEditar,
  rolAlGuardar,
  sinEdicion,
  type PermisoSeccion,
} from "@/components/usuarios/permisosSecciones";

const MANUAL_OPTION = "manual";
const PRESET_OPTION_PREFIX = "preset:";

// Un usuario nuevo empieza viendo solo el Dashboard y SIN edición en ninguna sección.
const DEFAULT_STAFF_PERMISSIONS: PermisoSeccion[] = permisosParaEditar([
  { section_key: "dashboard", can_view: true, can_edit: false },
]);

interface InvitarUsuarioProps {
  onSuccess?: () => void;
  /** Solo en el área de Super Admin: permite marcar el usuario nuevo como
   * super admin nada más crearlo. */
  allowSuperAdmin?: boolean;
}

export function InvitarUsuario({ onSuccess, allowSuperAdmin = false }: InvitarUsuarioProps) {
  // El alta va por la Edge Function admin-create-user, que escribe los permisos
  // con la service role y la puede llamar cualquier admin. Por eso la regla
  // «solo un super admin concede edición» (la de la RLS de user_permissions) se
  // aplica aquí: quien no es super admin crea usuarios sin edición, como antes.
  const { isSuperAdmin } = useSuperAdmin();
  const { presets, loading: presetsLoading, createPreset, updatePreset, deletePreset } = useUserRolePresets();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("staff");
  const [loading, setLoading] = useState(false);
  const [selectedAccessConfig, setSelectedAccessConfig] = useState(MANUAL_OPTION);
  const [createAsSuperAdmin, setCreateAsSuperAdmin] = useState(false);
  const [permissions, setPermissions] = useState<PermisoSeccion[]>(DEFAULT_STAFF_PERMISSIONS);

  const applyPermissions = (incomingPermissions: PermisoSeccion[]) => {
    const permisos = permisosParaEditar(incomingPermissions);
    setPermissions(isSuperAdmin ? permisos : sinEdicion(permisos));
  };

  const handleVerChange = (sectionKey: string, value: boolean) => {
    if (selectedAccessConfig.startsWith(PRESET_OPTION_PREFIX)) {
      setSelectedAccessConfig(MANUAL_OPTION);
    }
    // Quitar «Ver» quita también «Puede editar».
    setPermissions((prev) => cambiarVer(prev, sectionKey, value));
  };

  const handleEditarChange = (sectionKey: string, value: boolean) => {
    if (!isSuperAdmin) return;
    if (selectedAccessConfig.startsWith(PRESET_OPTION_PREFIX)) {
      setSelectedAccessConfig(MANUAL_OPTION);
    }
    setPermissions((prev) => cambiarEditar(prev, sectionKey, value));
  };

  const applyPreset = (preset: UserRolePreset) => {
    setSelectedAccessConfig(`${PRESET_OPTION_PREFIX}${preset.id}`);
    setRole(preset.base_role);
    applyPermissions(preset.permissions);
  };

  const handleCreatePresetOnly = async (
    name: string,
    baseRole: PresetBaseRole,
    presetPermissions: { section_key: string; can_view: boolean; can_edit: boolean }[]
  ) => {
    const createdPreset = await createPreset(name, baseRole, presetPermissions);
    if (createdPreset) {
      setSelectedAccessConfig(MANUAL_OPTION);
      setRole("staff");
      setPermissions(DEFAULT_STAFF_PERMISSIONS);
    }
    return createdPreset;
  };

  const handleDeletePresetOnly = async (presetId: string) => {
    const deleted = await deletePreset(presetId);
    if (!deleted) return false;

    if (selectedAccessConfig === `${PRESET_OPTION_PREFIX}${presetId}`) {
      setSelectedAccessConfig(MANUAL_OPTION);
      setRole("staff");
      setPermissions(DEFAULT_STAFF_PERMISSIONS);
    }
    return true;
  };

  const handleUpdatePresetOnly = async (
    presetId: string,
    name: string,
    baseRole: PresetBaseRole,
    presetPermissions: PermisoSeccion[]
  ) => {
    const updatedPreset = await updatePreset(presetId, name, baseRole, presetPermissions);
    if (!updatedPreset) return null;

    if (selectedAccessConfig === `${PRESET_OPTION_PREFIX}${presetId}`) {
      applyPreset(updatedPreset);
    }

    return updatedPreset;
  };

  const handleAccessConfigChange = (value: string) => {
    setSelectedAccessConfig(value);
    if (value === MANUAL_OPTION) {
      setRole("staff");
      setPermissions(DEFAULT_STAFF_PERMISSIONS);
      return;
    }
    if (!value.startsWith(PRESET_OPTION_PREFIX)) return;

    const presetId = value.replace(PRESET_OPTION_PREFIX, "");
    const selectedPreset = presets.find((preset) => preset.id === presetId);
    if (!selectedPreset) return;

    applyPreset(selectedPreset);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const nombreNormalizado = username.trim();
    
    if (!nombreNormalizado || !password) {
      toast.error("Nombre de usuario y contraseña son requeridos");
      return;
    }

    // Validate username format
    const usernameRegex = /^[a-zA-Z0-9._]+$/;
    if (!usernameRegex.test(nombreNormalizado) || nombreNormalizado.length > 64 || nombreNormalizado.startsWith(".") || nombreNormalizado.endsWith(".") || nombreNormalizado.includes("..")) {
      toast.error("El nombre de usuario solo puede contener letras, números, puntos y guiones bajos");
      return;
    }

    if (password.length < 10) {
      toast.error("La contraseña debe tener al menos 10 caracteres");
      return;
    }

    setLoading(true);
    try {
      // Get current session for authorization
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Debes estar autenticado para crear usuarios");
        return;
      }

      const { data, error } = await supabase.functions.invoke<{
        success?: boolean;
        error?: string;
        userId?: string;
      }>("admin-create-user", {
        body: {
          username: nombreNormalizado,
          password,
          // El rol sigue a los permisos (06/11/2026): el del preconfigurado elegido o el
          // que corresponde a lo marcado a mano (rolAlGuardar).
          role: rolAlGuardar(
            isSuperAdmin ? permissions : sinEdicion(permissions),
            presets,
            selectedAccessConfig.startsWith(PRESET_OPTION_PREFIX) ? selectedAccessConfig.slice(PRESET_OPTION_PREFIX.length) : null,
          ),
          // La función respeta el can_edit que le llega: solo un super admin lo envía.
          permissions: isSuperAdmin ? permissions : sinEdicion(permissions),
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.success) {
        throw new Error(data?.error || "Error al crear el usuario");
      }

      let avisoSuperAdmin: string | null = null;
      if (createAsSuperAdmin && allowSuperAdmin && isSuperAdmin && data.userId) {
        const { data: superAdminData, error: superAdminError } = await supabase.functions.invoke<{
          success?: boolean;
          error?: string;
        }>("admin-set-super-admin", {
          body: { userId: data.userId, makeSuperAdmin: true },
        });

        if (superAdminError || !superAdminData?.success) {
          avisoSuperAdmin = "Usuario creado, pero no se pudo dar acceso de super admin: " +
            (superAdminData?.error || await mensajeErrorUsuarios(superAdminError, "Vuelve a intentarlo desde la lista de usuarios."));
        }
      }

      if (avisoSuperAdmin) toast.error(avisoSuperAdmin);
      else toast.success("Usuario creado correctamente");
      window.dispatchEvent(new Event("users-management-refresh"));

      // Reset form
      setUsername("");
      setPassword("");
      setRole("staff");
      setSelectedAccessConfig(MANUAL_OPTION);
      setPermissions(DEFAULT_STAFF_PERMISSIONS);
      setCreateAsSuperAdmin(false);
      onSuccess?.();
    } catch (error: unknown) {
      console.error("Error creating user:", error);
      const message = await mensajeErrorUsuarios(error, "Error al crear el usuario");
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="username">Nombre de Usuario</Label>
          <Input
            id="username"
            type="text"
            placeholder="ej: maria.garcia"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            maxLength={64}
            // En la tablet el teclado pondría la primera letra en mayúscula y
            // corregiría el nombre: el usuario es minúsculas, sin corrector.
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="next"
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">
            Solo letras, números, puntos y guiones bajos
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            placeholder="Mínimo 10 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            className="h-11"
          />
        </div>
      </div>

      {allowSuperAdmin && isSuperAdmin && (
        <div className="flex min-h-11 items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <Checkbox
            id="create-as-super-admin"
            checked={createAsSuperAdmin}
            onCheckedChange={(checked) => setCreateAsSuperAdmin(checked as boolean)}
          />
          <Label htmlFor="create-as-super-admin" className="cursor-pointer py-1 font-normal">
            Crear como Super Admin (acceso total; la configuración de permisos de abajo no aplica)
          </Label>
        </div>
      )}

      <div className={`space-y-2 ${createAsSuperAdmin ? "opacity-50 pointer-events-none" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Configuración de acceso</Label>
          <ConfigurarRolesModal
            currentPermissions={permissions}
            presets={presets}
            presetsLoading={presetsLoading}
            onCreatePreset={handleCreatePresetOnly}
            onUpdatePreset={handleUpdatePresetOnly}
            onDeletePreset={handleDeletePresetOnly}
            puedeConcederEdicion={isSuperAdmin}
          />
        </div>
        <Select value={selectedAccessConfig} onValueChange={handleAccessConfigChange} disabled={presetsLoading}>
          <SelectTrigger className="h-11 w-full md:w-[360px]">
            <SelectValue placeholder={presetsLoading ? "Cargando roles..." : "Sin rol preconfigurado"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={MANUAL_OPTION}>Configuración manual</SelectItem>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={`${PRESET_OPTION_PREFIX}${preset.id}`}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          Usa una opción manual o una preconfiguración en un único desplegable.
        </p>
      </div>

      <div className={`space-y-2 ${createAsSuperAdmin ? "opacity-50 pointer-events-none" : ""}`}>
        <Label>Permisos por Sección</Label>
        <TablaPermisosSecciones
          permisos={permissions}
          onCambiarVer={handleVerChange}
          onCambiarEditar={handleEditarChange}
          puedeConcederEdicion={isSuperAdmin}
        />
      </div>

      <Button type="submit" disabled={loading} className="h-11 w-full px-6 md:w-auto">
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Creando usuario...
          </>
        ) : (
          <>
            <UserPlus className="h-4 w-4 mr-2" />
            Crear Usuario
          </>
        )}
      </Button>
    </form>
  );
}
