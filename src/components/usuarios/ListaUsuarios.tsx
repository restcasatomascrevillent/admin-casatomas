import { useEffect, useState } from "react";
import { useUsersManagement, ManagedUser } from "@/hooks/useUsersManagement";
import { AppRole } from "@/hooks/useUserRole";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { Button } from "@/components/ui/button";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Settings,
  Shield,
  ShieldAlert,
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
import {
  AccesoUsuario,
  AvatarUsuario,
  DatosUsuario,
  MarcaTu,
  TarjetasUsuarios,
  textoResumenUsuarios,
} from "@/components/usuarios/TarjetasUsuarios";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  cambiarEditar,
  cambiarVer,
  mismosPermisos,
  NOMBRE_ROL,
  permisosParaEditar,
  rolAlGuardar,
  SOLO_SUPER_ADMIN_CAMBIA_PERMISOS,
  type PermisoSeccion,
} from "@/components/usuarios/permisosSecciones";
import { ConMotivo } from "@/components/reservas/ConMotivo";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
    // El rol sigue a los permisos (06/11/2026): el del preconfigurado elegido o, si se han
    // tocado a mano, el que corresponde a lo marcado (ver rolAlGuardar).
    const rolNuevo = rolAlGuardar(editingPermissions, presets, selectedPresetId === "manual" ? null : selectedPresetId);
    if (rolNuevo !== selectedUser.role) {
      const actualizado = await updateUserRole(selectedUser.id, rolNuevo);
      if (!actualizado) return;
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
      <div role="status" className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        Cargando usuarios…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 items-start justify-center sm:items-center sm:p-6">
        <div role="alert" className="flex w-full max-w-md flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-5 text-center">
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">No se ha podido cargar la lista de usuarios</p>
            {/* El detalle, si dice algo más (sesión caducada, error del servidor…). */}
            {!/cargar la lista de usuarios/i.test(loadError) && (
              <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{loadError}</p>
            )}
          </div>
          <Button variant="outline" className="h-11 gap-2" onClick={() => void fetchUsers()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="flex flex-1 items-start justify-center sm:items-center sm:p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-2 rounded-xl border border-dashed bg-card/60 p-6 text-center">
          <span aria-hidden="true" className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <User className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium text-foreground">No hay usuarios registrados con roles asignados</p>
          {canManageUsers && (
            <p className="text-sm text-muted-foreground">Crea el primero con «Añadir Usuario».</p>
          )}
        </div>
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

  // Botones de cada usuario: en el teléfono, dos filas de 44 px que se reparten el
  // ancho; en escritorio, una fila compacta (44 px también con el dedo, `pointer-coarse`).
  const BOTON_MOVIL = "h-11 w-full min-w-0 gap-1.5 px-2 text-[13px] pointer-coarse:px-2 [&_svg]:mr-0";
  const BOTON_ESCRITORIO = "h-9 gap-1.5 px-3 pointer-coarse:h-11 [&_svg]:mr-0";

  /** «Permisos»: el diálogo para elegir qué ve y edita (solo quien no es super admin). */
  const dialogoPermisos = (user: ManagedUser, claseBoton: string) => (
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
          className={claseBoton}
          onClick={() => openPermissionsDialog(user)}
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
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
          {selectedUser && !selectedUser.is_super_admin && (
            <p className="text-xs text-muted-foreground" data-testid="rol-al-guardar">
              Rol al guardar:{" "}
              <span className="font-medium text-foreground">
                {NOMBRE_ROL[rolAlGuardar(editingPermissions, presets, selectedPresetId === "manual" ? null : selectedPresetId)]}
              </span>
              {selectedPresetId === "manual" && " · sale de los permisos: edita en todo → Admin; en algo → Manager; solo ve → Staff"}
            </p>
          )}
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
  );

  /** «Permisos» (editar) o, en la fila de un super admin, «Ver permisos» (solo consulta). */
  const botonPermisos = (user: ManagedUser, claseBoton: string) =>
    user.is_super_admin ? (
      <VisorPermisosUsuario user={user} nombre={getUserDisplayName(user)} className={claseBoton} />
    ) : (
      dialogoPermisos(user, claseBoton)
    );

  const botonContrasena = (user: ManagedUser, claseBoton: string) => (
    <Button
      variant="outline"
      size="sm"
      className={claseBoton}
      title={user.id === currentUser?.id ? "Cambiar tu contraseña (te pedirá la actual)" : undefined}
      onClick={() => (user.id === currentUser?.id ? setCambioPropioAbierto(true) : openPasswordDialog(user))}
    >
      <Key className="h-4 w-4" aria-hidden="true" />
      {user.id === currentUser?.id ? "Mi contraseña" : "Contraseña"}
    </Button>
  );

  const botonAcceso = (user: ManagedUser, claseBoton: string) => (
    <Button
      variant="outline"
      size="sm"
      className={claseBoton}
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
        <UnlockKeyhole className="h-4 w-4" aria-hidden="true" />
      ) : (
        <LockKeyhole className="h-4 w-4" aria-hidden="true" />
      )}
      {user.access_blocked
        ? "Desbloquear acceso"
        : "Bloquear acceso"}
    </Button>
  );

  /**
   * «Más opciones» (lo que se usa poco y lo irreversible): dar o quitar super admin y
   * eliminar la cuenta. Un menú en el teléfono y en escritorio, como en Reservas.
   */
  const menuMasOpciones = (user: ManagedUser, enMovil: boolean) => {
    const nombre = getUserDisplayName(user);
    const esPropio = user.id === currentUser?.id;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={
              enMovil
                ? "h-11 shrink-0 gap-1.5 px-3 text-[13px] pointer-coarse:px-3"
                : "w-9 shrink-0 px-0 pointer-coarse:w-11 pointer-coarse:px-0"
            }
            aria-label={`Más opciones de ${nombre}`}
            title="Más opciones"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            {enMovil && <span>Más</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
          <DropdownMenuItem
            disabled={esPropio}
            title={esPropio ? "No puedes quitarte a ti mismo el acceso de super admin" : undefined}
            onSelect={() => void handleToggleSuperAdmin(user)}
          >
            <ShieldAlert className="mr-2 h-4 w-4" aria-hidden="true" />
            {user.is_super_admin
              ? "Quitar Super Admin"
              : "Hacer Super Admin"}
          </DropdownMenuItem>
          {esPropio && (
            <p className="px-2 pb-1.5 text-xs text-muted-foreground">
              No puedes quitarte a ti mismo el acceso de super admin.
            </p>
          )}
          {!user.is_super_admin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={esPropio}
                title={esPropio ? "No puedes eliminar tu propio usuario" : undefined}
                aria-label={`Eliminar a ${nombre}`}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                onSelect={() => void handleDeleteUser(user.id)}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Eliminar usuario
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Sin gestión (panel normal, o quien no es super admin): solo la consulta de permisos.
  const accionesMovil = (user: ManagedUser) =>
    canManageUsers ? (
      <div className="flex min-w-0 flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          {botonPermisos(user, BOTON_MOVIL)}
          {botonContrasena(user, BOTON_MOVIL)}
        </div>
        <div className="flex min-w-0 gap-2">
          {botonAcceso(user, cn(BOTON_MOVIL, "flex-1"))}
          {menuMasOpciones(user, true)}
        </div>
      </div>
    ) : (
      <VisorPermisosUsuario user={user} nombre={getUserDisplayName(user)} className="w-full" />
    );

  const accionesEscritorio = (user: ManagedUser) =>
    canManageUsers ? (
      // En pantalla ancha, todos en una línea; en la tablet bajan de línea en vez de ensanchar la tabla.
      <div className="flex flex-wrap items-center justify-end gap-2 xl:flex-nowrap">
        {botonPermisos(user, BOTON_ESCRITORIO)}
        {botonContrasena(user, BOTON_ESCRITORIO)}
        {botonAcceso(user, BOTON_ESCRITORIO)}
        {menuMasOpciones(user, false)}
      </div>
    ) : (
      <VisorPermisosUsuario user={user} nombre={getUserDisplayName(user)} className={BOTON_ESCRITORIO} />
    );

  return (
    // La lista ocupa el alto disponible: tarjetas con scroll en móvil y tabla
    // con cabecera fija en escritorio. Solo se monta una vista y los mismos
    // controles de gestión se utilizan en ambas; los diálogos globales permanecen.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {isMobile ? (
        <TarjetasUsuarios usuarios={usuariosConAccesos} renderAcciones={accionesMovil} idActual={currentUser?.id} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="shrink-0 border-b px-4 py-3 text-xs font-medium text-muted-foreground">
            {textoResumenUsuarios(usuariosConAccesos)}
          </p>
          <div className="flex min-h-0 flex-1 flex-col [&>div]:min-h-0 [&>div]:flex-1">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-10 text-xs uppercase tracking-wide">Usuario</TableHead>
                  <TableHead className="h-10 text-xs uppercase tracking-wide">Accesos</TableHead>
                  <TableHead className="h-10 text-right text-xs uppercase tracking-wide">
                    {canManageUsers ? "Acciones" : "Permisos"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usuariosConAccesos.map(({ user, nombre, accessCount, editCount }) => (
                  <TableRow key={user.id} className={cn(user.access_blocked && "bg-destructive/[0.03]")}>
                    <TableCell className="py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <AvatarUsuario user={user} nombre={nombre} className="size-9 text-xs" />
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-medium text-foreground">{nombre}</span>
                            {user.id === currentUser?.id && <MarcaTu />}
                          </div>
                          <DatosUsuario user={user} nombre={nombre} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <AccesoUsuario user={user} accessCount={accessCount} editCount={editCount} />
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      {accionesEscritorio(user)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
