import { useState } from "react";
import { useUsersManagement, ManagedUser } from "@/hooks/useUsersManagement";
import { SECTIONS, AppRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Loader2, Settings, Shield, ShieldCheck, User, Trash2 } from "lucide-react";
import { toast } from "sonner";

const ROLE_LABELS: Record<AppRole, { label: string; color: string }> = {
  admin: { label: "Administrador", color: "bg-red-500" },
  manager: { label: "Manager", color: "bg-blue-500" },
  staff: { label: "Staff", color: "bg-gray-500" },
};

export function ListaUsuarios() {
  const { users, loading, updateUserRole, setAllPermissions, deleteUser } = useUsersManagement();
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<
    { section_key: string; can_view: boolean; can_edit: boolean }[]
  >([]);

  const openPermissionsDialog = (user: ManagedUser) => {
    setSelectedUser(user);
    // Inicializar con permisos existentes o defaults
    const perms = SECTIONS.map((s) => {
      const existing = user.permissions.find((p) => p.section_key === s.key);
      return {
        section_key: s.key,
        can_view: existing?.can_view ?? false,
        can_edit: existing?.can_edit ?? false,
      };
    });
    setEditingPermissions(perms);
  };

  const handlePermissionChange = (
    sectionKey: string,
    field: "can_view" | "can_edit",
    value: boolean
  ) => {
    setEditingPermissions((prev) =>
      prev.map((p) =>
        p.section_key === sectionKey
          ? { ...p, [field]: value, ...(field === "can_edit" && value ? { can_view: true } : {}) }
          : p
      )
    );
  };

  const savePermissions = async () => {
    if (!selectedUser) return;
    await setAllPermissions(selectedUser.id, editingPermissions);
    setSelectedUser(null);
  };

  const handleRoleChange = async (userId: string, newRole: AppRole) => {
    await updateUserRole(userId, newRole);
  };

  const handleDeleteUser = async (userId: string) => {
    if (confirm("¿Estás seguro de eliminar este usuario del sistema de permisos?")) {
      await deleteUser(userId);
    }
  };

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
            <TableHead>Permisos</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const roleInfo = user.role ? ROLE_LABELS[user.role] : null;
            const viewCount = user.permissions.filter((p) => p.can_view).length;
            const editCount = user.permissions.filter((p) => p.can_edit).length;

            return (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {user.role === "admin" ? (
                      <ShieldCheck className="h-4 w-4 text-red-500" />
                    ) : (
                      <User className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-medium">
                      {user.display_name || 
                        (user.email?.endsWith("@staff.local") 
                          ? user.email.replace("@staff.local", "") 
                          : user.email || user.id.slice(0, 8) + "...")}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {user.role === "admin" ? (
                    <Badge className={roleInfo?.color}>{roleInfo?.label}</Badge>
                  ) : (
                    <Select
                      value={user.role || "staff"}
                      onValueChange={(value) => handleRoleChange(user.id, value as AppRole)}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="staff">Staff</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell>
                  {user.role === "admin" ? (
                    <span className="text-sm text-muted-foreground">Acceso completo</span>
                  ) : (
                    <div className="flex gap-2">
                      <Badge variant="outline">{viewCount} ver</Badge>
                      <Badge variant="outline">{editCount} editar</Badge>
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
                          <DialogContent className="max-w-2xl">
                            <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Shield className="h-5 w-5" />
                                Permisos de {selectedUser?.display_name || 
                                  (selectedUser?.email?.endsWith("@staff.local") 
                                    ? selectedUser.email.replace("@staff.local", "") 
                                    : selectedUser?.email || selectedUser?.id.slice(0, 8))}
                              </DialogTitle>
                              <DialogDescription>
                                Configura qué secciones puede ver y editar este usuario
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Sección</TableHead>
                                    <TableHead className="text-center">Ver</TableHead>
                                    <TableHead className="text-center">Editar</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {SECTIONS.filter((s) => s.key !== "usuarios").map((section) => {
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
                                              handlePermissionChange(
                                                section.key,
                                                "can_view",
                                                checked as boolean
                                              )
                                            }
                                          />
                                        </TableCell>
                                        <TableCell className="text-center">
                                          <Checkbox
                                            checked={perm?.can_edit ?? false}
                                            onCheckedChange={(checked) =>
                                              handlePermissionChange(
                                                section.key,
                                                "can_edit",
                                                checked as boolean
                                              )
                                            }
                                          />
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                              <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setSelectedUser(null)}>
                                  Cancelar
                                </Button>
                                <Button onClick={savePermissions}>Guardar Permisos</Button>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
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
    </div>
  );
}
