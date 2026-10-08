import type { ManagedUser } from "@/hooks/useUsersManagement";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye, Shield } from "lucide-react";
import { AYUDA_EDICION, permisosParaEditar, SECCIONES_CONFIGURABLES } from "./permisosSecciones";

/** Visor sin controles de escritura, también para superadmins que visitan el panel normal. */
export function VisorPermisosUsuario({ user, nombre }: { user: ManagedUser; nombre: string }) {
  const permisos = permisosParaEditar(user.permissions);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-11 px-4">
          <Eye className="mr-1.5 h-4 w-4" />
          Ver permisos
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pr-6">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Shield className="h-5 w-5" />Permisos de {nombre}
          </DialogTitle>
          <DialogDescription>
            Consulta de permisos. Los usuarios, roles y accesos se gestionan desde el superadmin.
          </DialogDescription>
        </DialogHeader>
        {user.is_super_admin && <p className="text-sm text-muted-foreground">Super Admin: acceso completo al panel y al área de superadmin.</p>}
        <div className="rounded-md border">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Sección</TableHead>
              <TableHead className="text-center">Ver</TableHead>
              <TableHead className="text-center">Editar</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {SECCIONES_CONFIGURABLES.map((seccion) => {
                const permiso = permisos.find(p => p.section_key === seccion.key);
                const ver = user.is_super_admin || permiso?.can_view;
                const editar = user.is_super_admin || permiso?.can_edit;
                return <TableRow key={seccion.key}>
                  <TableCell>
                    <p className="font-medium">{seccion.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Editar: {AYUDA_EDICION[seccion.key]}</p>
                  </TableCell>
                  <TableCell className="text-center" aria-label={`Ver ${seccion.label}: ${ver ? "Sí" : "No"}`}>{ver ? "Sí" : "No"}</TableCell>
                  <TableCell className="text-center" aria-label={`Editar ${seccion.label}: ${editar ? "Sí" : "No"}`}>{editar ? "Sí" : "No"}</TableCell>
                </TableRow>;
              })}
              <TableRow>
                <TableCell><p className="font-medium">Usuarios</p><p className="mt-0.5 text-xs text-muted-foreground">Consulta en el admin panel; gestión en el superadmin.</p></TableCell>
                <TableCell className="text-center">{user.is_super_admin || user.role === "admin" ? "Sí" : "No"}</TableCell>
                <TableCell className="text-center">{user.is_super_admin ? "Superadmin" : "No"}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
