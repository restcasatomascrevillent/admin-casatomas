import { useEffect, useState } from "react";
import { useUsersManagement, ManagedUser } from "@/hooks/useUsersManagement";
import { AppRole } from "@/hooks/useUserRole";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Loader2, Settings, Shield, ShieldAlert, ShieldCheck, User, Trash2, Key } from "lucide-react";
import { useUserRolePresets, UserRolePreset } from "@/hooks/useUserRolePresets";
import { ConfigurarRolesModal } from "@/components/usuarios/ConfigurarRolesModal";
import { TablaPermisosSecciones } from "@/components/usuarios/TablaPermisosSecciones";
import {
  cambiarEditar,
  cambiarVer,
  mismosPermisos,
  permisosParaEditar,
  SOLO_SUPER_ADMIN_CAMBIA_PERMISOS,
  type PermisoSeccion,
} from "@/components/usuarios/permisosSecciones";
import { ConMotivo } from "@/components/reservas/ConMotivo";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface ListaUsuariosProps {
  /** Solo en el área de Super Admin: permite gestionar el acceso de super
   * admin de otros usuarios y actuar (contraseña) sobre usuarios admin, que
   * en el Admin Panel normal no tienen ninguna acción disponible. */
  canManageSuperAdmins?: boolean;
}

export function ListaUsuarios({ canManageSuperAdmins = false }: ListaUsuariosProps) {
  const {
    users,
    loading,
    updateUserRole,
    setAllPermissions,
    updateUserPassword,
    setSuperAdmin,
    deleteUser,
    fetchUsers,
  } = useUsersManagement();
  const { user: currentUser } = useAuth();
  // Solo un super admin concede o retira «Puede editar» (2026-10-01). Es la misma
  // regla que la BD: la RLS de user_permissions solo deja escribir a super admins.
  const { isSuperAdmin } = useSuperAdmin();
  const { presets, loading: presetsLoading, createPreset, updatePreset, deletePreset } = useUserRolePresets();
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<PermisoSeccion[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("manual");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordTargetUser, setPasswordTargetUser] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  const getUserDisplayName = (user: ManagedUser | null) => {
    if (!user) return "usuario";
    if (user.display_name) return user.display_name;
    if (user.email?.endsWith("@staff.local")) {
      return user.email.replace("@staff.local", "");
    }
    return user.email || `${user.id.slice(0, 8)}...`;
  };

  // Si los permisos actuales del usuario coinciden exactamente con un rol
  // preconfigurado (mismo rol base y mismos «Ver» y «Puede editar» en cada
  // sección), se selecciona ese preset en vez de dejarlo en "Sin rol preconfigurado".
  const findMatchingPreset = (role: AppRole | null, perms: PermisoSeccion[]) =>
    presets.find((preset) => preset.base_role === role && mismosPermisos(perms, preset.permissions));

  const openPermissionsDialog = (user: ManagedUser) => {
    setSelectedUser(user);
    // Inicializar con los permisos guardados, edición incluida (hasta el
    // 2026-10-01 se cargaba can_edit: false y al guardar se perdía).
    const perms = permisosParaEditar(user.permissions);
    setEditingPermissions(perms);
    const matchingPreset = findMatchingPreset(user.role, perms);
    setSelectedPresetId(matchingPreset?.id ?? "manual");
  };

  const closePermissionsDialog = () => {
    setSelectedUser(null);
    setEditingPermissions([]);
    setSelectedPresetId("manual");
  };

  // Quien no es super admin ve el diálogo en solo lectura: la RLS de user_permissions
  // solo deja escribir a un super admin y cualquier otro guardado no haría nada.
  const handleVerChange = (sectionKey: string, value: boolean) => {
    if (!isSuperAdmin) return;
    if (selectedPresetId !== "manual") {
      setSelectedPresetId("manual");
    }
    // Quitar «Ver» quita también «Puede editar».
    setEditingPermissions((prev) => cambiarVer(prev, sectionKey, value));
  };

  const handleEditarChange = (sectionKey: string, value: boolean) => {
    if (!isSuperAdmin) return;
    if (selectedPresetId !== "manual") {
      setSelectedPresetId("manual");
    }
    setEditingPermissions((prev) => cambiarEditar(prev, sectionKey, value));
  };

  const savePermissions = async () => {
    if (!selectedUser || !isSuperAdmin) return;
    // «Puede editar» solo lo escribe un super admin. Si el guardado falla, el
    // diálogo sigue abierto con lo elegido (para reintentar) y el rol no se toca.
    const guardado = await setAllPermissions(selectedUser.id, editingPermissions, {
      puedeConcederEdicion: isSuperAdmin,
    });
    if (!guardado) return;
    if (selectedPresetId !== "manual") {
      const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
      if (selectedPreset) {
        const actualizado = await updateUserRole(selectedUser.id, selectedPreset.base_role);
        if (!actualizado) return;
      }
    }
    closePermissionsDialog();
  };

  const handleDeleteUser = async (userId: string) => {
    if (confirm("¿Estás seguro de eliminar este usuario del sistema de permisos?")) {
      await deleteUser(userId);
    }
  };

  const handleToggleSuperAdmin = async (user: ManagedUser) => {
    const makeSuperAdmin = !user.is_super_admin;
    const confirmMessage = makeSuperAdmin
      ? `¿Dar acceso de super admin a ${getUserDisplayName(user)}?`
      : `¿Quitar el acceso de super admin a ${getUserDisplayName(user)}?`;

    if (confirm(confirmMessage)) {
      await setSuperAdmin(user.id, makeSuperAdmin);
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

  // Aplicar un rol preconfigurado copia su «Ver» y su «Puede editar». Guardarlo
  // solo funciona para un super admin (RLS de user_permissions), igual que antes.
  const applyPresetToEditing = (selectedPreset: UserRolePreset) => {
    setSelectedPresetId(selectedPreset.id);
    setEditingPermissions(permisosParaEditar(selectedPreset.permissions));
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
    presetPermissions: PermisoSeccion[]
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
    // Con alto medido (Usuarios / SuperAdminUsuarios) la lista llena lo que queda de la tarjeta y
    // solo hace scroll el cuerpo de la tabla. El contenedor de scroll es el `div` que el primitivo
    // `Table` pone alrededor de la tabla; su alto se fija desde aquí con `[&>div]:…` (como en
    // ListaReservasAvanzada) para no tocar `ui/table.tsx`, que es compartido. Los diálogos van en
    // portal, así que ese `div` es el único hijo `div`. La cabecera se pega arriba (`sticky top-0`)
    // con el fondo de la tarjeta para tapar las filas; la sombra de 1 px hace de línea inferior
    // cuando está pegada (con `border-collapse` el borde de la fila no viaja con el thead; en
    // reposo coincide con ese borde y no se nota).
    <div className="flex min-h-0 flex-1 flex-col [&>div]:min-h-0 [&>div]:flex-1">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
          <TableRow>
            <TableHead>Usuario</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Accesos</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const permisosActuales = permisosParaEditar(user.permissions);
            const matchingPreset = findMatchingPreset(user.role, permisosActuales);
            const accessCount = permisosActuales.filter((p) => p.can_view).length;
            const editCount = permisosActuales.filter((p) => p.can_edit).length;

            return (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {user.is_super_admin ? (
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
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!user.is_super_admin && (
                      <Badge variant="outline">{matchingPreset?.name ?? "Acceso por permisos"}</Badge>
                    )}
                    {user.role === "admin" && !user.is_super_admin && (
                      <Badge variant="outline">Gestiona usuarios</Badge>
                    )}
                    {user.is_super_admin && (
                      <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
                        <ShieldAlert className="h-3 w-3" />
                        Super Admin
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {user.is_super_admin ? (
                    <span className="text-sm text-muted-foreground">Acceso completo</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{accessCount} secciones</Badge>
                      {editCount > 0 && <Badge variant="outline">{editCount} con edición</Badge>}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {!user.is_super_admin && (user.role !== "admin" || canManageSuperAdmins) && (
                        <Dialog
                          open={selectedUser?.id === user.id}
                          onOpenChange={(open) => { if (!open) closePermissionsDialog(); }}
                        >
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-11 px-4"
                              onClick={() => openPermissionsDialog(user)}
                            >
                              <Settings className="h-4 w-4 mr-1" />
                              Permisos
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
                            <DialogHeader className="pr-6">
                              <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                                <Shield className="h-5 w-5" />
                                Permisos de {getUserDisplayName(selectedUser)}
                              </DialogTitle>
                              <DialogDescription>
                                Elige qué secciones ve este usuario y en cuáles puede editar
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
                                    puedeConcederEdicion={isSuperAdmin}
                                  />
                                </div>
                                <Select
                                  value={selectedPresetId}
                                  onValueChange={handlePresetChange}
                                  disabled={presetsLoading || !isSuperAdmin}
                                >
                                  <SelectTrigger className="h-11 w-full sm:w-[360px]">
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
                              <div className="max-h-[52dvh] overflow-y-auto pr-1">
                                <TablaPermisosSecciones
                                  permisos={editingPermissions}
                                  onCambiarVer={handleVerChange}
                                  onCambiarEditar={handleEditarChange}
                                  puedeConcederEdicion={isSuperAdmin}
                                  soloLectura={!isSuperAdmin}
                                />
                              </div>
                              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                                <Button variant="outline" className="h-11 px-5" onClick={closePermissionsDialog}>
                                  Cancelar
                                </Button>
                                {/* Deshabilitado, el motivo va en el envoltorio: el botón no recibe el ratón.
                                    (El motivo también está escrito arriba, en la tabla: con el dedo no hay hover.) */}
                                <ConMotivo motivo={isSuperAdmin ? undefined : SOLO_SUPER_ADMIN_CAMBIA_PERMISOS}>
                                  <Button onClick={savePermissions} disabled={!isSuperAdmin} className="h-11 w-full px-5 sm:w-auto">
                                    Guardar Permisos
                                  </Button>
                                </ConMotivo>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                    )}
                    {(user.role !== "admin" || canManageSuperAdmins) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 px-4"
                        onClick={() => openPasswordDialog(user)}
                      >
                        <Key className="h-4 w-4 mr-1" />
                        Contraseña
                      </Button>
                    )}
                    {canManageSuperAdmins && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 px-4"
                        disabled={user.id === currentUser?.id}
                        title={
                          user.id === currentUser?.id
                            ? "No puedes quitarte a ti mismo el acceso de super admin"
                            : undefined
                        }
                        onClick={() => handleToggleSuperAdmin(user)}
                      >
                        <ShieldAlert className="h-4 w-4 mr-1" />
                        {user.is_super_admin ? "Quitar Super Admin" : "Hacer Super Admin"}
                      </Button>
                    )}
                    {canManageSuperAdmins && user.id === currentUser?.id && (
                      <p className="basis-full text-right text-xs text-muted-foreground">
                        No puedes quitarte a ti mismo el acceso de super admin.
                      </p>
                    )}
                    {!user.is_super_admin && (user.role !== "admin" || canManageSuperAdmins) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-11 w-11 px-0 text-destructive hover:text-destructive"
                        disabled={user.id === currentUser?.id}
                        title={user.id === currentUser?.id ? "No puedes eliminar tu propio usuario" : undefined}
                        aria-label={`Eliminar a ${getUserDisplayName(user)}`}
                        onClick={() => handleDeleteUser(user.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
              <Button variant="outline" className="h-11 px-5" onClick={closePasswordDialog} disabled={updatingPassword}>
                Cancelar
              </Button>
              <Button className="h-11 px-5" onClick={handleChangePassword} disabled={updatingPassword}>
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
