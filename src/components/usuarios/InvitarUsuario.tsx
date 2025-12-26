import { useState } from "react";
import { useUsersManagement } from "@/hooks/useUsersManagement";
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

export function InvitarUsuario() {
  const { assignRoleToNewUser, setAllPermissions } = useUsersManagement();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("staff");
  const [loading, setLoading] = useState(false);
  const [permissions, setPermissions] = useState<
    { section_key: string; can_view: boolean; can_edit: boolean }[]
  >(
    SECTIONS.filter((s) => s.key !== "usuarios").map((s) => ({
      section_key: s.key,
      can_view: s.key === "dashboard",
      can_edit: false,
    }))
  );

  const handlePermissionChange = (
    sectionKey: string,
    field: "can_view" | "can_edit",
    value: boolean
  ) => {
    setPermissions((prev) =>
      prev.map((p) =>
        p.section_key === sectionKey
          ? { ...p, [field]: value, ...(field === "can_edit" && value ? { can_view: true } : {}) }
          : p
      )
    );
  };

  const handleRoleChange = (newRole: AppRole) => {
    setRole(newRole);
    // Preset permissions based on role
    if (newRole === "manager") {
      setPermissions((prev) =>
        prev.map((p) => ({ ...p, can_view: true, can_edit: false }))
      );
    } else if (newRole === "staff") {
      setPermissions((prev) =>
        prev.map((p) => ({
          ...p,
          can_view: p.section_key === "dashboard" || p.section_key === "reservas",
          can_edit: false,
        }))
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error("Email y contraseña son requeridos");
      return;
    }

    if (password.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    setLoading(true);
    try {
      // Crear usuario con Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (authError) {
        if (authError.message.includes("already registered")) {
          toast.error("Este email ya está registrado");
        } else {
          throw authError;
        }
        return;
      }

      if (!authData.user) {
        toast.error("Error al crear el usuario");
        return;
      }

      // Asignar rol
      const { error: roleError } = await supabase
        .from("user_roles")
        .insert({ user_id: authData.user.id, role });

      if (roleError) throw roleError;

      // Asignar permisos
      const permissionsToInsert = permissions.map((p) => ({
        user_id: authData.user!.id,
        section_key: p.section_key,
        can_view: p.can_view,
        can_edit: p.can_edit,
      }));

      const { error: permError } = await supabase
        .from("user_permissions")
        .insert(permissionsToInsert);

      if (permError) throw permError;

      toast.success("Usuario creado correctamente");
      
      // Reset form
      setEmail("");
      setPassword("");
      setRole("staff");
      setPermissions(
        SECTIONS.filter((s) => s.key !== "usuarios").map((s) => ({
          section_key: s.key,
          can_view: s.key === "dashboard",
          can_edit: false,
        }))
      );
    } catch (error: any) {
      console.error("Error creating user:", error);
      toast.error(error.message || "Error al crear el usuario");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="usuario@restaurante.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
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
        <Label>Rol</Label>
        <Select value={role} onValueChange={(v) => handleRoleChange(v as AppRole)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manager">Manager</SelectItem>
            <SelectItem value="staff">Staff</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {role === "manager"
            ? "Los managers tienen acceso de lectura a todas las secciones por defecto"
            : "El staff tiene acceso limitado por defecto"}
        </p>
      </div>

      <div className="space-y-2">
        <Label>Permisos por Sección</Label>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sección</TableHead>
                <TableHead className="text-center w-24">Ver</TableHead>
                <TableHead className="text-center w-24">Editar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SECTIONS.filter((s) => s.key !== "usuarios").map((section) => {
                const perm = permissions.find((p) => p.section_key === section.key);
                return (
                  <TableRow key={section.key}>
                    <TableCell className="font-medium">{section.label}</TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={perm?.can_view ?? false}
                        onCheckedChange={(checked) =>
                          handlePermissionChange(section.key, "can_view", checked as boolean)
                        }
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={perm?.can_edit ?? false}
                        onCheckedChange={(checked) =>
                          handlePermissionChange(section.key, "can_edit", checked as boolean)
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
