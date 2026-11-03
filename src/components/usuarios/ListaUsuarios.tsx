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
import {
  Loader2,
  ChevronDown,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
  Trash2,
  Key,
  LockKeyhole,
  UnlockKeyhole,
} from "lucide-react";
import { useUserRolePresets, UserRolePreset } from "@/hooks/useUserRolePresets";
import { ConfigurarRolesModal } from "@/components/usuarios/ConfigurarRolesModal";
import { TablaPermisosSecciones } from "@/components/usuarios/TablaPermisosSecciones";
import { VisorPermisosUsuario } from "@/components/usuarios/VisorPermisosUsuario";
import { MarcaTu, TarjetasUsuarios } from "@/components/usuarios/TarjetasUsuarios";
import { useIsMobile } from "@/hooks/use-mobile";
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
import { DialogoCambiarContrasena } from "@/components/cuenta/DialogoCambiarContrasena";

interface ListaUsuariosProps {
  /** Activa la gestión solo en el área de Super Admin y para un superadmin autenticado. */
  canManageSuperAdmins?: boolean;
}

export function ListaUsuarios({
  canManageSuperAdmins = false,
}: ListaUsuariosProps) {
  const isMobile = useIsMobile();
  const {
    users,
    loading,
    loadError,
    updateUserRole,
    setAllPermissions,
    updateUserPassword,
    setSuperAdmin,
    setUserAccessBlocked,
    deleteUser,
    fetchUsers,
  } = useUsersManagement();
  const { user: currentUser } = useAuth();
  // Solo un super admin concede o retira «Puede editar» (2026-10-01). Es la misma
  // regla que la BD: la RLS de user_permissions solo deja escribir a super admins.
  const { isSuperAdmin } = useSuperAdmin();
  const canManageUsers = canManageSuperAdmins && isSuperAdmin;
  const {
    presets,
    loading: presetsLoading,
    createPreset,
    updatePreset,
    deletePreset,
  } = useUserRolePresets();
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<
    PermisoSeccion[]
  >([]);
  const [selectedPresetId, setSelectedPresetId] = useState("manual");
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordTargetUser, setPasswordTargetUser] =
    useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [accessTarget, setAccessTarget] = useState<ManagedUser | null>(null);
  // Su propia fila: «Contraseña» abre el cambio de SU contraseña (pide la actual).
  const [cambioPropioAbierto, setCambioPropioAbierto] = useState(false);
  const [updatingAccess, setUpdatingAccess] = useState(false);

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
    presets.find(
      (preset) =>
        preset.base_role === role && mismosPermisos(perms, preset.permissions),
    );

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
    if (savingPermissions) return;
    setSelectedUser(null);
    setEditingPermissions([]);
    setSelectedPresetId("manual");
  };

  // Quien no es super admin ve el diálogo en solo lectura: la RLS de user_permissions
  // solo deja escribir a un super admin y cualquier otro guardado no haría nada.
  const handleVerChange = (sectionKey: string, value: boolean) => {
    if (!canManageUsers) return;
    if (selectedPresetId !== "manual") {
      setSelectedPresetId("manual");
    }
    // Quitar «Ver» quita también «Puede editar».
    setEditingPermissions((prev) => cambiarVer(prev, sectionKey, value));
  };

  const handleEditarChange = (sectionKey: string, value: boolean) => {
    if (!canManageUsers) return;
    if (selectedPresetId !== "manual") {
      setSelectedPresetId("manual");
    }
    setEditingPermissions((prev) => cambiarEditar(prev, sectionKey, value));
  };

  const savePermissions = async () => {
    if (!selectedUser || !canManageUsers || savingPermissions) return;
    setSavingPermissions(true);
    try {
    // «Puede editar» solo lo escribe un super admin. Si el guardado falla, el
    // diálogo sigue abierto con lo elegido (para reintentar) y el rol no se toca.
    const guardado = await setAllPermissions(
      selectedUser.id,
      editingPermissions,
      {
        puedeConcederEdicion: isSuperAdmin,
      },
    );
    if (!guardado) return;
    if (selectedPresetId !== "manual") {
      const selectedPreset = presets.find(
        (preset) => preset.id === selectedPresetId,
      );
      if (selectedPreset) {
        const actualizado = await updateUserRole(
          selectedUser.id,
          selectedPreset.base_role,
        );
        if (!actualizado) return;
      }
    }
    closePermissionsDialog();
    } finally {
      setSavingPermissions(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!canManageUsers) return;
    if (
      confirm("¿Eliminar este usuario definitivamente? Se borrará su cuenta. Para impedir el acceso sin borrarla, usa «Bloquear acceso».")
    ) {
      await deleteUser(userId);
    }
  };

  const handleAccessChange = async () => {
    if (!accessTarget || !canManageUsers || updatingAccess) return;
    setUpdatingAccess(true);
    try {
      const updated = await setUserAccessBlocked(
        accessTarget.id,
        !accessTarget.access_blocked,
      );
      if (updated) setAccessTarget(null);
    } finally {
      setUpdatingAccess(false);
    }
  };

  const handleToggleSuperAdmin = async (user: ManagedUser) => {
    if (!canManageUsers) return;
    const makeSuperAdmin = !user.is_super_admin;
    const confirmMessage = makeSuperAdmin
      ? `¿Dar acceso de super admin a ${getUserDisplayName(user)}?`
      : `¿Quitar el acceso de super admin a ${getUserDisplayName(user)}?`;

    if (confirm(confirmMessage)) {
      await setSuperAdmin(user.id, makeSuperAdmin);
    }
  };

  const openPasswordDialog = (user: ManagedUser) => {
    if (!canManageUsers) return;
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
    if (!passwordTargetUser || !canManageUsers || updatingPassword) return;

    if (newPassword.length < 10) {
      toast.error("La contraseña debe tener al menos 10 caracteres");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Las contraseñas no coinciden");
      return;
    }

    setUpdatingPassword(true);
    const updated = await updateUserPassword(
      passwordTargetUser.id,
      newPassword,
    );
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
    baseRole: UserRolePreset["base_role"],
    presetPermissions: PermisoSeccion[],
  ) => {
    const updatedPreset = await updatePreset(
      presetId,
      name,
      baseRole,
      presetPermissions,
    );
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
    return () =>
      window.removeEventListener("users-management-refresh", handleRefresh);
  }, [fetchUsers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return <div className="space-y-3 py-6 text-center">
      <p className="text-sm text-destructive" role="alert">{loadError}</p>
      <Button variant="outline" className="h-11" onClick={() => void fetchUsers()}>Reintentar</Button>
    </div>;
  }

  if (users.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No hay usuarios registrados con roles asignados</p>
      </div>
    );
  }

  const usuariosConAccesos = users.map((user) => {
    const permisosActuales = permisosParaEditar(user.permissions);
    return {
      user,
      nombre: getUserDisplayName(user),
      accessCount: permisosActuales.filter((p) => p.can_view).length,
      editCount: permisosActuales.filter((p) => p.can_edit).length,
    };
  });

  const opcionesUsuario = (user: ManagedUser) => (
    <>
      {canManageUsers && (
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
          {user.is_super_admin
            ? "Quitar Super Admin"
            : "Hacer Super Admin"}
        </Button>
      )}
      {canManageUsers && user.id === currentUser?.id && (
        <p className={isMobile ? "text-left text-xs text-muted-foreground" : "basis-full text-right text-xs text-muted-foreground"}>
          No puedes quitarte a ti mismo el acceso de super admin.
        </p>
      )}
      {canManageUsers && !user.is_super_admin && (
        <Button
          variant="ghost"
          size="sm"
          className={isMobile ? "h-11 w-full gap-2 px-3 text-destructive hover:text-destructive" : "h-11 w-11 px-0 text-destructive hover:text-destructive"}
          disabled={user.id === currentUser?.id}
          title={
            user.id === currentUser?.id
              ? "No puedes eliminar tu propio usuario"
              : undefined
          }
          aria-label={`Eliminar a ${getUserDisplayName(user)}`}
          onClick={() => handleDeleteUser(user.id)}
        >
          <Trash2 className="h-4 w-4" />
          {isMobile && <span>Eliminar usuario</span>}
        </Button>
      )}
    </>
  );

  const accionesUsuario = (user: ManagedUser) => (
    <div className={isMobile ? "grid grid-cols-2 gap-2" : "flex flex-wrap justify-end gap-2"}>
      {(!canManageUsers || user.is_super_admin) && (
        <VisorPermisosUsuario
          user={user}
          nombre={getUserDisplayName(user)}
          className={isMobile ? "order-1 col-span-2 w-full" : undefined}
        />
      )}
      {canManageUsers && !user.is_super_admin && (
        <Dialog
          open={selectedUser?.id === user.id}
          onOpenChange={(open) => {
            if (!open) closePermissionsDialog();
          }}
        >
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={isMobile ? "order-1 h-11 w-full min-w-0 gap-1.5 px-2 text-[13px] pointer-coarse:px-2 [&_svg]:mr-0" : "h-11 px-4"}
              onClick={() => openPermissionsDialog(user)}
            >
              <Settings className="h-4 w-4 mr-1" />
              Permisos
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
            <DialogHeader className="pr-10 text-left">
              <DialogTitle className="flex min-w-0 items-start gap-2 text-base leading-snug sm:text-lg">
                <Shield className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">Permisos de {getUserDisplayName(selectedUser)}</span>
              </DialogTitle>
              <DialogDescription>
                Elige qué secciones ve este usuario y en cuáles
                puede editar
              </DialogDescription>
            </DialogHeader>
            <fieldset disabled={savingPermissions} className="min-w-0 space-y-4 py-2 sm:py-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-sm font-medium">
                    Rol preconfigurado
                  </Label>
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
                      placeholder={
                        presetsLoading
                          ? "Cargando roles..."
                          : "Sin rol preconfigurado"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">
                      Sin rol preconfigurado
                    </SelectItem>
                    {presets.map((preset) => (
                      <SelectItem
                        key={preset.id}
                        value={preset.id}
                      >
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
                <Button
                  variant="outline"
                  className="h-11 px-5"
                  onClick={closePermissionsDialog}
                >
                  Cancelar
                </Button>
                {/* Deshabilitado, el motivo va en el envoltorio: el botón no recibe el ratón.
                      (El motivo también está escrito arriba, en la tabla: con el dedo no hay hover.) */}
                <ConMotivo
                  motivo={
                    isSuperAdmin
                      ? undefined
                      : SOLO_SUPER_ADMIN_CAMBIA_PERMISOS
                  }
                >
                  <Button
                    onClick={savePermissions}
                    disabled={!isSuperAdmin || savingPermissions}
                    className="h-11 w-full px-5 sm:w-auto"
                  >
                    {savingPermissions && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    {savingPermissions ? "Guardando..." : "Guardar Permisos"}
                  </Button>
                </ConMotivo>
              </div>
            </fieldset>
          </DialogContent>
        </Dialog>
      )}
      {canManageUsers && (
        <Button
          variant="outline"
          size="sm"
          className={isMobile ? "order-3 col-span-2 h-11 w-full px-3" : "h-11 px-4"}
          disabled={
            updatingAccess ||
            user.id === currentUser?.id ||
            typeof user.access_blocked !== "boolean" ||
            (user.is_super_admin && !user.access_blocked)
          }
          title={
            typeof user.access_blocked !== "boolean"
              ? "Bloqueo de acceso pendiente de activar"
              : user.id === currentUser?.id
                ? "No puedes bloquear tu propia cuenta"
                : user.is_super_admin && !user.access_blocked
                  ? "Quita primero el acceso de super admin"
                  : undefined
          }
          onClick={() => setAccessTarget(user)}
        >
          {user.access_blocked ? (
            <UnlockKeyhole className="h-4 w-4 mr-1" />
          ) : (
            <LockKeyhole className="h-4 w-4 mr-1" />
          )}
          {user.access_blocked
            ? "Desbloquear acceso"
            : "Bloquear acceso"}
        </Button>
      )}
      {canManageUsers && (
        <Button
          variant="outline"
          size="sm"
          className={isMobile ? "order-2 h-11 w-full min-w-0 gap-1.5 px-2 text-[13px] pointer-coarse:px-2 [&_svg]:mr-0 " + (user.is_super_admin ? "col-span-2" : "") : "h-11 px-4"}
          title={user.id === currentUser?.id ? "Cambiar tu contraseña (te pedirá la actual)" : undefined}
          onClick={() => (user.id === currentUser?.id ? setCambioPropioAbierto(true) : openPasswordDialog(user))}
        >
          <Key className="h-4 w-4 mr-1" />
          {user.id === currentUser?.id ? "Mi contraseña" : "Contraseña"}
        </Button>
      )}
      {isMobile && canManageUsers ? (
        <details className="group order-4 col-span-2 rounded-lg border bg-muted/20">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            Más opciones
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="grid gap-2 px-2 pb-2 [&>button]:w-full [&>button]:px-2">
            {opcionesUsuario(user)}
          </div>
        </details>
      ) : (
        opcionesUsuario(user)
      )}
    </div>
  );

  return (
    // La lista ocupa el alto disponible: tarjetas con scroll en móvil y tabla
    // con cabecera fija en escritorio. Solo se monta una vista y los mismos
    // controles de gestión se utilizan en ambas; los diálogos globales permanecen.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {isMobile ? (
        <TarjetasUsuarios usuarios={usuariosConAccesos} renderAcciones={accionesUsuario} idActual={currentUser?.id} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col [&>div]:min-h-0 [&>div]:flex-1">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Accesos</TableHead>
                <TableHead className="text-right">
                  {canManageUsers ? "Acciones" : "Permisos"}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usuariosConAccesos.map(({ user, accessCount, editCount }) => {
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {user.is_super_admin ? (
                          <ShieldCheck className="h-4 w-4 text-red-500" />
                        ) : (
                          <User className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {getUserDisplayName(user)}
                          </span>
                          {user.id === currentUser?.id && <MarcaTu />}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.access_blocked ? (
                        <div className="space-y-1">
                          <Badge variant="destructive">Acceso bloqueado</Badge>
                          <p className="text-xs text-muted-foreground">
                            Permisos conservados
                          </p>
                        </div>
                      ) : user.is_super_admin ? (
                        <span className="text-sm text-muted-foreground">
                          Acceso completo
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{accessCount} secciones</Badge>
                          {editCount > 0 && (
                            <Badge variant="outline">{editCount} con edición</Badge>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {accionesUsuario(user)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={!!accessTarget}
        onOpenChange={(open) => {
          if (!open && !updatingAccess) setAccessTarget(null);
        }}
      >
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {accessTarget?.access_blocked
                ? "Desbloquear acceso"
                : "Bloquear acceso"}
            </DialogTitle>
            <DialogDescription className="break-words [overflow-wrap:anywhere]">
              {accessTarget?.access_blocked
                ? `${getUserDisplayName(accessTarget)} podrá volver a iniciar sesión con los mismos permisos.`
                : `Se cerrarán las sesiones abiertas de ${getUserDisplayName(accessTarget)} y no podrá volver a entrar. Su cuenta, datos y permisos se conservarán.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              className="h-11"
              disabled={updatingAccess}
              onClick={() => setAccessTarget(null)}
            >
              Cancelar
            </Button>
            <Button
              variant={accessTarget?.access_blocked ? "default" : "destructive"}
              className="h-11"
              disabled={updatingAccess}
              onClick={() => void handleAccessChange()}
            >
              {updatingAccess && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {accessTarget?.access_blocked
                ? "Confirmar desbloqueo"
                : "Confirmar bloqueo"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {canManageUsers && (
        <DialogoCambiarContrasena
          open={cambioPropioAbierto}
          onOpenChange={setCambioPropioAbierto}
          email={currentUser?.email}
        />
      )}

      <Dialog
        open={passwordDialogOpen}
        onOpenChange={(open) => !open && closePasswordDialog()}
      >
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-md p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Cambiar contraseña</DialogTitle>
            <DialogDescription className="break-words [overflow-wrap:anywhere]">
              Define una nueva contraseña para{" "}
              {getUserDisplayName(passwordTargetUser)} (
              {passwordTargetUser?.email || passwordTargetUser?.id}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="user-new-password">Nueva contraseña</Label>
              <Input
                id="user-new-password"
                type="password"
                placeholder="Mínimo 10 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="h-11 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-confirm-password">
                Confirmar contraseña
              </Label>
              <Input
                id="user-confirm-password"
                type="password"
                placeholder="Repite la nueva contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="h-11 text-base"
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                className="h-11 px-5"
                onClick={closePasswordDialog}
                disabled={updatingPassword}
              >
                Cancelar
              </Button>
              <Button
                className="h-11 px-5"
                onClick={handleChangePassword}
                disabled={updatingPassword}
              >
                {updatingPassword ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Actualizar contraseña
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
