import { useState } from "react";
import { SECTIONS, AppRole } from "@/hooks/useUserRole";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRolePresets, UserRolePreset } from "@/hooks/useUserRolePresets";
import { ConfigurarRolesModal } from "@/components/usuarios/ConfigurarRolesModal";

const EDITABLE_SECTIONS = SECTIONS.filter((section) => section.key !== "usuarios");
const MANUAL_OPTION = "manual";
const PRESET_OPTION_PREFIX = "preset:";

const DEFAULT_STAFF_PERMISSIONS = EDITABLE_SECTIONS.map((section) => ({
  section_key: section.key,
  can_view: section.key === "dashboard",
  can_edit: false,
}));

export function InvitarUsuario() {
  const { presets, loading: presetsLoading, createPreset, updatePreset, deletePreset } = useUserRolePresets();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("staff");
  const [loading, setLoading] = useState(false);
  const [selectedAccessConfig, setSelectedAccessConfig] = useState(MANUAL_OPTION);
  const [permissions, setPermissions] = useState<
    { section_key: string; can_view: boolean; can_edit: boolean }[]
  >(DEFAULT_STAFF_PERMISSIONS);

  const applyPermissions = (incomingPermissions: { section_key: string; can_view: boolean; can_edit: boolean }[]) => {
    setPermissions(
      EDITABLE_SECTIONS.map((section) => {
        const existing = incomingPermissions.find((permission) => permission.section_key === section.key);
        return {
          section_key: section.key,
          can_view: existing?.can_edit ? true : (existing?.can_view ?? false),
          can_edit: false,
        };
      })
    );
  };

  const handlePermissionChange = (sectionKey: string, value: boolean) => {
    if (selectedAccessConfig.startsWith(PRESET_OPTION_PREFIX)) {
      setSelectedAccessConfig(MANUAL_OPTION);
    }

    setPermissions((prev) =>
      prev.map((p) =>
        p.section_key === sectionKey
          ? {
              ...p,
              can_view: value,
              can_edit: false,
            }
          : p
      )
    );
  };

  const applyPreset = (preset: UserRolePreset) => {
    setSelectedAccessConfig(`${PRESET_OPTION_PREFIX}${preset.id}`);
    setRole(preset.base_role);
    applyPermissions(preset.permissions);
  };

  const handleCreatePresetOnly = async (
    name: string,
    baseRole: "manager" | "staff",
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
    baseRole: "manager" | "staff",
    presetPermissions: { section_key: string; can_view: boolean; can_edit: boolean }[]
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
    
    if (!username || !password) {
      toast.error("Nombre de usuario y contraseña son requeridos");
      return;
    }

    // Validate username format
    const usernameRegex = /^[a-zA-Z0-9._]+$/;
    if (!usernameRegex.test(username)) {
      toast.error("El nombre de usuario solo puede contener letras, números, puntos y guiones bajos");
      return;
    }

    if (password.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
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
      }>("admin-create-user", {
        body: {
          username,
          password,
          role,
          permissions,
        },
      });

      if (error) {
        throw new Error(error.message || "Error al crear el usuario");
      }

      if (!data?.success) {
        throw new Error(data?.error || "Error al crear el usuario");
      }

      toast.success("Usuario creado correctamente");
      window.dispatchEvent(new Event("users-management-refresh"));
      
      // Reset form
      setUsername("");
      setPassword("");
      setRole("staff");
      setSelectedAccessConfig(MANUAL_OPTION);
      setPermissions(DEFAULT_STAFF_PERMISSIONS);
    } catch (error: unknown) {
      console.error("Error creating user:", error);
      const message = error instanceof Error ? error.message : "Error al crear el usuario";
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
            placeholder="Mínimo 6 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Configuración de acceso</Label>
          <ConfigurarRolesModal
            currentPermissions={permissions}
            presets={presets}
            presetsLoading={presetsLoading}
            onCreatePreset={handleCreatePresetOnly}
            onUpdatePreset={handleUpdatePresetOnly}
            onDeletePreset={handleDeletePresetOnly}
          />
        </div>
        <Select value={selectedAccessConfig} onValueChange={handleAccessConfigChange} disabled={presetsLoading}>
          <SelectTrigger className="w-full md:w-[360px]">
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

      <div className="space-y-2">
        <Label>Permisos por Sección</Label>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sección</TableHead>
                <TableHead className="text-center w-24">Acceso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EDITABLE_SECTIONS.map((section) => {
                const perm = permissions.find((p) => p.section_key === section.key);
                return (
                  <TableRow key={section.key}>
                    <TableCell className="font-medium">{section.label}</TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={perm?.can_view ?? false}
                        onCheckedChange={(checked) => handlePermissionChange(section.key, checked as boolean)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <Button type="submit" disabled={loading} className="w-full md:w-auto">
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
