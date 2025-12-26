import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListaUsuarios } from "@/components/usuarios/ListaUsuarios";
import { InvitarUsuario } from "@/components/usuarios/InvitarUsuario";
import { Shield, UserPlus, Users } from "lucide-react";

export default function Usuarios() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold text-foreground">Gestión de Usuarios</h1>
            <p className="text-muted-foreground">
              Administra roles y permisos de acceso a la aplicación
            </p>
          </div>
        </div>

        <Tabs defaultValue="usuarios" className="space-y-4">
          <TabsList>
            <TabsTrigger value="usuarios" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Usuarios
            </TabsTrigger>
            <TabsTrigger value="invitar" className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Añadir Usuario
            </TabsTrigger>
          </TabsList>

          <TabsContent value="usuarios">
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
          </TabsContent>

          <TabsContent value="invitar">
            <Card>
              <CardHeader>
                <CardTitle>Añadir Nuevo Usuario</CardTitle>
                <CardDescription>
                  Registra un nuevo usuario y configura sus permisos iniciales
                </CardDescription>
              </CardHeader>
              <CardContent>
                <InvitarUsuario />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
