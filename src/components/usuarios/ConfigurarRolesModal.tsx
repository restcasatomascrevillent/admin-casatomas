import { useEffect, useMemo, useState } from "react";
import {
  PresetBaseRole,
  RolePresetPermission,
  UserRolePreset,
} from "@/hooks/useUserRolePresets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Loader2, Pencil, Settings2, Trash2 } from "lucide-react";
import { TablaPermisosSecciones } from "@/components/usuarios/TablaPermisosSecciones";
import { cambiarEditar, cambiarVer, permisosParaEditar } from "@/components/usuarios/permisosSecciones";

// Los roles preconfigurados llevan también «Puede editar» (2026-10-01): el
// borrador copia el can_edit real de los permisos actuales o de la plantilla, en
// vez de forzarlo a false.
const normalizePermissions = (incomingPermissions: RolePresetPermission[]): RolePresetPermission[] =>
  permisosParaEditar(incomingPermissions);

interface ConfigurarRolesModalProps {
  currentPermissions: RolePresetPermission[];
  presets: UserRolePreset[];
  presetsLoading: boolean;
  onCreatePreset: (
    name: string,
    baseRole: PresetBaseRole,
    permissions: RolePresetPermission[]
  ) => Promise<UserRolePreset | null>;
  onUpdatePreset: (
    presetId: string,
    name: string,
    baseRole: PresetBaseRole,
    permissions: RolePresetPermission[]
  ) => Promise<UserRolePreset | null>;
  onDeletePreset: (presetId: string) => Promise<boolean>;
  /** Solo un super admin concede o retira «Puede editar» (también en las plantillas). */
  puedeConcederEdicion?: boolean;
}

export function ConfigurarRolesModal({
  currentPermissions,
  presets,
  presetsLoading,
  onCreatePreset,
  onUpdatePreset,
  onDeletePreset,
  puedeConcederEdicion = false,
}: ConfigurarRolesModalProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [draftBaseRole, setDraftBaseRole] = useState<PresetBaseRole>("staff");
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<RolePresetPermission[]>(
    normalizePermissions(currentPermissions)
  );
  const isEditing = editingPresetId !== null;
  const accessCount = useMemo(
    () => draftPermissions.filter((permission) => permission.can_view).length,
    [draftPermissions]
  );

  const resetEditor = (permissions: RolePresetPermission[]) => {
    setEditingPresetId(null);
    setPresetName("");
    setDraftBaseRole("staff");
    setDraftPermissions(normalizePermissions(permissions));
  };

  useEffect(() => {
    if (!open) return;
    resetEditor(currentPermissions);
  }, [open, currentPermissions]);

  const handleVerChange = (sectionKey: string, value: boolean) => {
    setDraftPermissions((prev) => cambiarVer(prev, sectionKey, value));
  };

  const handleEditarChange = (sectionKey: string, value: boolean) => {
    if (!puedeConcederEdicion) return;
    setDraftPermissions((prev) => cambiarEditar(prev, sectionKey, value));
  };

  const startEditingPreset = (preset: UserRolePreset) => {
    setEditingPresetId(preset.id);
    setPresetName(preset.name);
    setDraftBaseRole(preset.base_role);
    setDraftPermissions(normalizePermissions(preset.permissions));
  };

  const handleSavePreset = async () => {
    const normalizedName = presetName.trim();
    if (!normalizedName) return;

    setSaving(true);
    try {
      const savedPreset = editingPresetId
        ? await onUpdatePreset(editingPresetId, normalizedName, draftBaseRole, draftPermissions)
        : await onCreatePreset(normalizedName, draftBaseRole, draftPermissions);
      if (!savedPreset) return;

      resetEditor(currentPermissions);
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePreset = async (preset: UserRolePreset) => {
    if (!window.confirm(`¿Eliminar el rol preconfigurado "${preset.name}"?`)) return;
    const deleted = await onDeletePreset(preset.id);
    if (!deleted) return;

    if (editingPresetId === preset.id) {
      resetEditor(currentPermissions);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Settings2 className="h-4 w-4 mr-1" />
          Configurar roles
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(96vw,1080px)] max-w-[min(96vw,1080px)] max-h-[92vh] overflow-hidden p-0 gap-0">
        <div className="flex max-h-[92vh] flex-col">
          <DialogHeader className="border-b px-4 py-4 pr-10 sm:px-6">
            <DialogTitle>Configurar Roles</DialogTitle>
            <DialogDescription>
              Crea, edita y gestiona roles preconfigurados por sección.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div className="space-y-4 rounded-lg border border-border/70 p-3 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {isEditing ? "Editar Rol Preconfigurado" : "Nuevo Rol Preconfigurado"}
                  </h3>
                  {isEditing && <Badge variant="secondary">Editando</Badge>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="preset-name">Nombre del rol</Label>
                  <Input
                    id="preset-name"
                    value={presetName}
                    onChange={(event) => setPresetName(event.target.value)}
                    placeholder="Ej: Sala principal"
                  />
                  <p className="text-xs text-muted-foreground">{accessCount} secciones con acceso</p>
                </div>

                <div className="space-y-2">
                  <Label>Rol base</Label>
                  <Select value={draftBaseRole} onValueChange={(v) => setDraftBaseRole(v as PresetBaseRole)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="staff">Staff</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Permisos</Label>
                  <div className="max-h-[42vh] overflow-y-auto pr-1">
                    <TablaPermisosSecciones
                      permisos={draftPermissions}
                      onCambiarVer={handleVerChange}
                      onCambiarEditar={handleEditarChange}
                      puedeConcederEdicion={puedeConcederEdicion}
                    />
                  </div>
                </div>

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  {isEditing && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={() => resetEditor(currentPermissions)}
                    >
                      Cancelar edición
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={handleSavePreset}
                    disabled={saving || !presetName.trim()}
                    className="sm:min-w-[170px]"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Guardando...
                      </>
                    ) : isEditing ? (
                      "Guardar cambios"
                    ) : (
                      "Guardar rol"
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border/70 p-3 sm:p-4">
                <h3 className="text-sm font-semibold">Roles Guardados</h3>
                {presetsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando roles...
                  </div>
                ) : presets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Todavía no hay roles preconfigurados.</p>
                ) : (
                  <div className="space-y-2 max-h-[56vh] overflow-y-auto pr-1">
                    {presets.map((preset) => {
                      const presetAccessCount = preset.permissions.filter((permission) => permission.can_view).length;
                      const presetEditCount = preset.permissions.filter((permission) => permission.can_edit).length;
                      const editingThisPreset = editingPresetId === preset.id;

                      return (
                        <div
                          key={preset.id}
                          className={`flex flex-col gap-2 rounded-md border p-3 ${
                            editingThisPreset
                              ? "border-primary/40 bg-primary/5"
                              : "border-border/70 bg-card"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium leading-tight">{preset.name}</p>
                            <Badge variant={editingThisPreset ? "secondary" : "outline"}>
                              {editingThisPreset ? "Editando" : "Rol"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            <Badge variant="outline" className="mr-1 text-[10px] px-1.5 py-0">{preset.base_role}</Badge>
                            {presetAccessCount} secciones con acceso
                            {presetEditCount > 0 && ` · ${presetEditCount} con edición`}
                          </p>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={saving}
                              onClick={() => startEditingPreset(preset)}
                            >
                              <Pencil className="h-4 w-4 mr-1" />
                              Editar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              disabled={saving}
                              onClick={() => handleDeletePreset(preset)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
