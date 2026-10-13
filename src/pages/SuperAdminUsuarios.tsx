import { useState } from "react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ListaUsuarios } from "@/components/usuarios/ListaUsuarios";
import { InvitarUsuario } from "@/components/usuarios/InvitarUsuario";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { UserPlus } from "lucide-react";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado abierto en el
 * móvil) deja de encoger y vuelve el scroll de página. El mismo que Usuarios y Newsletter.
 */
const ALTURA_MINIMA_USUARIOS = 360;

export default function SuperAdminUsuarios() {
  const [addUserOpen, setAddUserOpen] = useState(false);
  // Alto de la pantalla, sin scroll de página (petición del dueño, 2026-10-07): el mismo patrón
  // que Usuarios (`useAlturaDisponible`); la tabla hace scroll por dentro (ListaUsuarios).
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_USUARIOS);

  return (
    <SuperAdminLayout>
      <div ref={setRaiz} className="flex min-w-0 flex-col gap-3 sm:gap-6" style={alto ? { height: alto } : undefined}>
        <div className="flex justify-end">
          <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
            <DialogTrigger asChild>
              <Button className="flex h-11 w-full items-center justify-center gap-2 px-5 sm:w-auto">
                <UserPlus className="h-4 w-4" />
                Añadir Usuario
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[85dvh] overflow-y-auto p-4 sm:p-6">
              <DialogHeader>
                <DialogTitle>Añadir Nuevo Usuario</DialogTitle>
                <DialogDescription>
                  Registra un nuevo usuario y configura sus permisos iniciales
                </DialogDescription>
              </DialogHeader>
              <InvitarUsuario allowSuperAdmin onSuccess={() => setAddUserOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>

        <Card className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CardHeader className="shrink-0 p-4 sm:p-6">
            <CardTitle>Lista de Usuarios</CardTitle>
            <CardDescription>
              Gestiona permisos, contraseñas y el acceso de los usuarios del sistema
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col px-3 pb-3 pt-0 sm:px-6 sm:pb-6">
            <ListaUsuarios canManageSuperAdmins />
          </CardContent>
        </Card>
      </div>
    </SuperAdminLayout>
  );
}
