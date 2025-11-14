import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, MapPin, Users } from "lucide-react";
import {
  useEspaciosReserva,
  useEliminarEspacio,
} from "@/hooks/useEspaciosReserva";
import { EspacioForm } from "@/components/reservas/EspacioForm";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Espacios() {
  const { data: espacios = [], isLoading } = useEspaciosReserva() as any;

  const [showForm, setShowForm] = useState(false);
  const [espacioEditando, setEspacioEditando] = useState<any>();
  const [espacioAEliminar, setEspacioAEliminar] = useState<string | null>(null);

  const eliminarEspacio = useEliminarEspacio();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Espacios para Reservas</h2>
            <p className="text-muted-foreground">
              Configura los espacios disponibles para reservas de clientes
            </p>
          </div>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nuevo Espacio
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground col-span-full">Cargando...</p>
          ) : espacios.length === 0 ? (
            <p className="text-sm text-muted-foreground col-span-full">No hay espacios creados</p>
          ) : (
            espacios.map((espacio) => (
              <Card key={espacio.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2">
                        {espacio.nombre}
                        {espacio.activa ? (
                          <Badge variant="default">Activo</Badge>
                        ) : (
                          <Badge variant="secondary">Inactivo</Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-2">
                        {espacio.descripcion || "Sin descripción"}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEspacioEditando(espacio);
                          setShowForm(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEspacioAEliminar(espacio.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Capacidad:</span>
                      <span className="font-medium">{espacio.capacidad_maxima} personas</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Mesas:</span>
                      <span className="font-medium">{espacio.numero_mesas}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <EspacioForm
          open={showForm}
          onOpenChange={(open) => {
            setShowForm(open);
            if (!open) setEspacioEditando(null);
          }}
          espacio={espacioEditando}
        />

        <AlertDialog open={!!espacioAEliminar} onOpenChange={() => setEspacioAEliminar(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción no se puede deshacer. Se eliminará permanentemente el espacio.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (espacioAEliminar) {
                    eliminarEspacio.mutate(espacioAEliminar);
                    setEspacioAEliminar(null);
                  }
                }}
              >
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
