import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
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
import { UserPlus } from "lucide-react";

export default function Usuarios() {
  const [addUserOpen, setAddUserOpen] = useState(false);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Sin título de página (2026-09-25): la pestaña "Usuarios" activa en
            el menú lateral ya dice dónde estás; el subtítulo era relleno. */}

        <div className="flex justify-end">
          <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
            <DialogTrigger asChild>
              <Button className="flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                Añadir Usuario
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Añadir Nuevo Usuario</DialogTitle>
                <DialogDescription>
                  Registra un nuevo usuario y configura sus permisos iniciales
                </DialogDescription>
              </DialogHeader>
              <InvitarUsuario onSuccess={() => setAddUserOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Lista de Usuarios</CardTitle>
            <CardDescription>
              Gestiona los permisos de cada usuario del sistema
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ListaUsuarios />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
