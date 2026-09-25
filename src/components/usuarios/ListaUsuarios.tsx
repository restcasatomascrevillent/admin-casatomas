import { useEffect, useState } from "react";
import { useUsersManagement, ManagedUser } from "@/hooks/useUsersManagement";
import { SECTIONS, AppRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Settings, Shield, ShieldCheck, User, Trash2, Key } from "lucide-react";
import { useUserRolePresets, UserRolePreset } from "@/hooks/useUserRolePresets";
import { ConfigurarRolesModal } from "@/components/usuarios/ConfigurarRolesModal";
import { toast } from "sonner";

const ROLE_LABELS: Record<AppRole, { label: string; color: string }> = {
  admin: { label: "Administrador", color: "bg-red-500" },
  manager: { label: "Manager", color: "bg-blue-500" },
  staff: { label: "Staff", color: "bg-gray-500" },
};

export function ListaUsuarios() {
  const {
    users,
    loading,
    updateUserRole,
    setAllPermissions,
    updateUserPassword,
    deleteUser,
    fetchUsers,
  } = useUsersManagement();
  const { presets, loading: presetsLoading, createPreset, updatePreset, deletePreset } = useUserRolePresets();
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<
    { section_key: string; can_view: boolean; can_edit: boolean }[]
  >([]);
  const [selectedPresetId, setSelectedPresetId] = useState("manual");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordTargetUser, setPasswordTargetUser] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const editableSections = SECTIONS.filter((s) => s.key !== "usuarios");

  const getUserDisplayName = (user: ManagedUser | null) => {
    if (!user) return "usuario";
    if (user.display_name) return user.display_name;
    if (user.email?.endsWith("@staff.local")) {
      return user.email.replace("@staff.local", "");
    }
    return user.email || `${user.id.slice(0, 8)}...`;
  };

  const openPermissionsDialog = (user: ManagedUser) => {
    setSelectedUser(user);
    // Inicializar con permisos existentes o defaults
    const perms = editableSections.map((s) => {
      const existing = user.permissions.find((p) => p.section_key === s.key);
      return {
        section_key: s.key,
        can_view: existing?.can_view ?? false,
        can_edit: false,
      };
    });
    setEditingPermissions(perms);
    setSelectedPresetId("manual");
  };

  const handlePermissionChange = (sectionKey: string, value: boolean) => {
    if (selectedPresetId !== "manual") {
      setSelectedPresetId("manual");
    }

    setEditingPermissions((prev) =>
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

  const savePermissions = async () => {
    if (!selectedUser) return;
    await setAllPermissions(selectedUser.id, editingPermissions);
    if (selectedPresetId !== "manual") {
      const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
      if (selectedPreset) {
        await updateUserRole(selectedUser.id, selectedPreset.base_role);
      }
    }
    setSelectedUser(null);
    setSelectedPresetId("manual");
  };

  const handleDeleteUser = async (userId: string) => {
    if (confirm("¿Estás seguro de eliminar este usuario del sistema de permisos?")) {
      await deleteUser(userId);
    }
  };

  const openPasswordDialog = (user: ManagedUser) => {
    setPasswordTargetUser(user);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordDialogOpen(true);
  };

  const closePasswordDialog = () => {
    if (updatingPassword) return;
    setPasswordDialogOpen(false);
    setPasswordTargetUser(null);
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleChangePassword = async () => {
    if (!passwordTargetUser) return;

    if (newPassword.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Las contraseñas no coinciden");
      return;
    }

    setUpdatingPassword(true);
    const updated = await updateUserPassword(passwordTargetUser.id, newPassword);
    setUpdatingPassword(false);

    if (updated) {
      closePasswordDialog();
    }
  };

  const applyPresetToEditing = (selectedPreset: UserRolePreset) => {
    setSelectedPresetId(selectedPreset.id);
    setEditingPermissions(
      editableSections.map((section) => {
        const existing = selectedPreset.permissions.find(
          (permission) => permission.section_key === section.key
        );
        return {
          section_key: section.key,
          can_view: existing?.can_edit ? true : (existing?.can_view ?? false),
          can_edit: false,
        };
      })
    );
  };

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (presetId === "manual") return;

    const selectedPreset = presets.find((preset) => preset.id === presetId);
    if (!selectedPreset) return;

    applyPresetToEditing(selectedPreset);
  };

  const handleDeletePresetOnly = async (presetId: string) => {
    const deleted = await deletePreset(presetId);
    if (!deleted) return false;

    if (selectedPresetId === presetId) {
      setSelectedPresetId("manual");
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

    if (selectedPresetId === presetId) {
      applyPresetToEditing(updatedPreset);
    }

    return updatedPreset;
  };

  useEffect(() => {
    const handleRefresh = () => {
      void fetchUsers();
    };

    window.addEventListener("users-management-refresh", handleRefresh);
    return () => window.removeEventListener("users-management-refresh", handleRefresh);
  }, [fetchUsers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No hay usuarios registrados con roles asignados</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Usuario</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Accesos</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const roleInfo = user.role ? ROLE_LABELS[user.role] : null;
            const accessCount = user.permissions.filter((p) => p.can_view).length;

            return (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {user.role === "admin" ? (
                      <ShieldCheck className="h-4 w-4 text-red-500" />
                    ) : (
                      <User className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div className="flex flex-col items-start">
                      <span className="font-medium">{getUserDisplayName(user)}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {user.role === "admin" ? (
                    <Badge className={roleInfo?.color}>{roleInfo?.label}</Badge>
                  ) : (
                    <Badge variant="outline">Acceso por permisos</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {user.role === "admin" ? (
                    <span className="text-sm text-muted-foreground">Acceso completo</span>
                  ) : (
                    <div className="flex gap-2">
                      <Badge variant="outline">{accessCount} secciones</Badge>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {user.role !== "admin" && (
                      <>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openPermissionsDialog(user)}
                            >
                              <Settings className="h-4 w-4 mr-1" />
                              Permisos
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90vh] overflow-hidden p-4 sm:p-6">
                            <DialogHeader className="pr-6">
                              <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                                <Shield className="h-5 w-5" />
                                Permisos de {getUserDisplayName(selectedUser)}
                              </DialogTitle>
                              <DialogDescription>
                                Configura a qué secciones tiene acceso este usuario
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-2 sm:py-4">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <Label className="text-sm font-medium">Rol preconfigurado</Label>
                                  <ConfigurarRolesModal
                                    currentPermissions={editingPermissions}
                                    presets={presets}
                                    presetsLoading={presetsLoading}
                                    onCreatePreset={createPreset}
                                    onUpdatePreset={handleUpdatePresetOnly}
                                    onDeletePreset={handleDeletePresetOnly}
                                  />
                                </div>
                                <Select
                                  value={selectedPresetId}
                                  onValueChange={handlePresetChange}
                                  disabled={presetsLoading}
                                >
                                  <SelectTrigger className="w-full sm:w-[360px]">
                                    <SelectValue
                                      placeholder={presetsLoading ? "Cargando roles..." : "Sin rol preconfigurado"}
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="manual">Sin rol preconfigurado</SelectItem>
                                    {presets.map((preset) => (
                                      <SelectItem key={preset.id} value={preset.id}>
                                        {preset.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="max-h-[52vh] overflow-y-auto pr-1">
                                <div className="space-y-2 sm:hidden">
                                  {editableSections.map((section) => {
                                    const perm = editingPermissions.find(
                                      (p) => p.section_key === section.key
                                    );
                                    return (
                                      <div key={section.key} className="rounded-md border border-border/70 bg-card p-3">
                                        <p className="text-sm font-medium">{section.label}</p>
                                        <div className="mt-2 space-y-2">
                                          <div className="flex items-center justify-between">
                                            <span className="text-sm text-muted-foreground">Acceso</span>
                                            <Checkbox
                                              checked={perm?.can_view ?? false}
                                              onCheckedChange={(checked) =>
                                                handlePermissionChange(section.key, checked as boolean)
                                              }
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="hidden sm:block rounded-md border border-border/70 overflow-auto">
                                  <Table className="min-w-[520px]">
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Sección</TableHead>
                                        <TableHead className="text-center">Acceso</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {editableSections.map((section) => {
                                        const perm = editingPermissions.find(
                                          (p) => p.section_key === section.key
                                        );
                                        return (
                                          <TableRow key={section.key}>
                                            <TableCell className="font-medium">
                                              {section.label}
                                            </TableCell>
                                            <TableCell className="text-center">
                                              <Checkbox
                                                checked={perm?.can_view ?? false}
                                                onCheckedChange={(checked) =>
                                                  handlePermissionChange(section.key, checked as boolean)
                                                }
                                              />
                                            </TableCell>
                                          </TableRow>
                                        );
                                      })}
                                    </TableBody>
                                  </Table>
                                </div>
                              </div>
                              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                                <Button variant="outline" onClick={() => setSelectedUser(null)}>
                                  Cancelar
                                </Button>
                                <Button onClick={savePermissions}>Guardar Permisos</Button>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openPasswordDialog(user)}
                        >
                          <Key className="h-4 w-4 mr-1" />
                          Contraseña
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteUser(user.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={passwordDialogOpen} onOpenChange={(open) => !open && closePasswordDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cambiar contraseña</DialogTitle>
            <DialogDescription>
              Define una nueva contraseña para {getUserDisplayName(passwordTargetUser)} ({passwordTargetUser?.email || passwordTargetUser?.id}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="user-new-password">Nueva contraseña</Label>
              <Input
                id="user-new-password"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-confirm-password">Confirmar contraseña</Label>
              <Input
                id="user-confirm-password"
                type="password"
                placeholder="Repite la nueva contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closePasswordDialog} disabled={updatingPassword}>
                Cancelar
              </Button>
              <Button onClick={handleChangePassword} disabled={updatingPassword}>
                {updatingPassword ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Actualizar contraseña
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
