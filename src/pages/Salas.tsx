import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, MapPin, Users } from "lucide-react";
import {
  useSalas,
  useCrearSala,
  useActualizarSala,
  useEliminarSala,
} from "@/hooks/useSalas";
import { SalaForm } from "@/components/salas/SalaForm";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function Salas() {
  const { data: salas = [], isLoading } = useSalas();

  const [showSalaForm, setShowSalaForm] = useState(false);
  const [salaEditando, setSalaEditando] = useState<any>();
  const [salaAEliminar, setSalaAEliminar] = useState<string | null>(null);

  const crearSala = useCrearSala();
  const actualizarSala = useActualizarSala();
  const eliminarSala = useEliminarSala();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Gestión de Salas</h2>
            <p className="text-muted-foreground">
              Configura las salas de tu restaurante
            </p>
          </div>
          <Button onClick={() => setShowSalaForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nueva Sala
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground col-span-full">Cargando...</p>
          ) : salas.length === 0 ? (
            <p className="text-sm text-muted-foreground col-span-full">No hay salas creadas</p>
          ) : (
            salas.map((sala) => (
              <Card key={sala.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2">
                        {sala.nombre}
                        {sala.activa ? (
                          <Badge variant="default">Activa</Badge>
                        ) : (
                          <Badge variant="secondary">Inactiva</Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-2">
                        {sala.descripcion || "Sin descripción"}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSalaEditando(sala);
                          setShowSalaForm(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSalaAEliminar(sala.id)}
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
                      <span>Capacidad: {sala.capacidad_maxima} personas</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{sala.numero_mesas} mesas</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
         </div>
      </div>

      <SalaForm
        open={showSalaForm}
        onOpenChange={(open) => {
          setShowSalaForm(open);
          if (!open) setSalaEditando(undefined);
        }}
        onSubmit={(sala) => {
          if (salaEditando) {
            actualizarSala.mutate({ id: salaEditando.id, ...sala });
          } else {
            crearSala.mutate(sala);
          }
        }}
        initialData={salaEditando}
        loading={crearSala.isPending || actualizarSala.isPending}
      />

      <AlertDialog open={!!salaAEliminar} onOpenChange={() => setSalaAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar sala?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará la sala permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (salaAEliminar) {
                  eliminarSala.mutate(salaAEliminar);
                  setSalaAEliminar(null);
                }
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
