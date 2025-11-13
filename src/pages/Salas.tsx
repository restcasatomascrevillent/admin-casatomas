import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, MapPin, Users, Layout } from "lucide-react";
import {
  useSalas,
  usePosicionesSala,
  useCrearSala,
  useActualizarSala,
  useEliminarSala,
  useCrearPosicion,
  useActualizarPosicion,
  useEliminarPosicion,
} from "@/hooks/useSalas";
import { SalaForm } from "@/components/salas/SalaForm";
import { PosicionForm } from "@/components/salas/PosicionForm";
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
  const [salaSeleccionada, setSalaSeleccionada] = useState<string | null>(null);
  const { data: posiciones = [] } = usePosicionesSala(salaSeleccionada);

  const [showSalaForm, setShowSalaForm] = useState(false);
  const [showPosicionForm, setShowPosicionForm] = useState(false);
  const [salaEditando, setSalaEditando] = useState<any>();
  const [posicionEditando, setPosicionEditando] = useState<any>();
  const [salaAEliminar, setSalaAEliminar] = useState<string | null>(null);
  const [posicionAEliminar, setPosicionAEliminar] = useState<{ id: string; sala_id: string } | null>(null);

  const crearSala = useCrearSala();
  const actualizarSala = useActualizarSala();
  const eliminarSala = useEliminarSala();
  const crearPosicion = useCrearPosicion();
  const actualizarPosicion = useActualizarPosicion();
  const eliminarPosicion = useEliminarPosicion();

  const salaActual = salas.find(s => s.id === salaSeleccionada);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Gestión de Salas</h2>
            <p className="text-muted-foreground">
              Configura las salas y posiciones de tu restaurante
            </p>
          </div>
          <Button onClick={() => setShowSalaForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nueva Sala
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg">Salas</CardTitle>
              <CardDescription>
                {salas.length} {salas.length === 1 ? "sala" : "salas"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Cargando...</p>
              ) : salas.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay salas creadas</p>
              ) : (
                <div className="space-y-2">
                  {salas.map((sala) => (
                    <Card
                      key={sala.id}
                      className={`cursor-pointer transition-all hover:shadow-md ${
                        salaSeleccionada === sala.id ? "border-primary" : ""
                      }`}
                      onClick={() => setSalaSeleccionada(sala.id)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-semibold">{sala.nombre}</h4>
                            <div className="flex gap-4 text-xs text-muted-foreground mt-2">
                              <div className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {sala.capacidad_maxima}
                              </div>
                              <div className="flex items-center gap-1">
                                <Layout className="h-3 w-3" />
                                {sala.numero_mesas} mesas
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  {salaActual ? `Posiciones: ${salaActual.nombre}` : "Posiciones"}
                </CardTitle>
                {salaSeleccionada && (
                  <Button onClick={() => setShowPosicionForm(true)} size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Nueva Posición
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!salaSeleccionada ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <MapPin className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">Selecciona una sala</p>
                </div>
              ) : posiciones.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">No hay posiciones</p>
                  <Button onClick={() => setShowPosicionForm(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Crear Posición
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Capacidad</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {posiciones.map((pos) => (
                      <TableRow key={pos.id}>
                        <TableCell>{pos.nombre}</TableCell>
                        <TableCell>{pos.capacidad_comensales}</TableCell>
                        <TableCell>
                          <Badge variant={pos.activa ? "default" : "secondary"}>
                            {pos.activa ? "Activa" : "Inactiva"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <SalaForm
        open={showSalaForm}
        onOpenChange={setShowSalaForm}
        onSubmit={(sala) => crearSala.mutate(sala)}
        loading={crearSala.isPending}
      />

      {salaSeleccionada && (
        <PosicionForm
          open={showPosicionForm}
          onOpenChange={setShowPosicionForm}
          onSubmit={(pos) => crearPosicion.mutate(pos)}
          salaId={salaSeleccionada}
          loading={crearPosicion.isPending}
        />
      )}
    </DashboardLayout>
  );
}
