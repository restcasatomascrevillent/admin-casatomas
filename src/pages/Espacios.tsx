import { useState } from "react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, Users, Settings2 } from "lucide-react";
import {
  useEspaciosReserva,
  useEliminarEspacio,
} from "@/hooks/useEspaciosReserva";
import { useMesas } from "@/hooks/useMesas";
import { EspacioForm } from "@/components/reservas/EspacioForm";
import { EditorPlanoEspacio } from "@/components/espacios/EditorPlanoEspacio";
import { NegocioBadge } from "@/components/reservas/NegocioBadge";
import { agruparPorNegocio, marcaDeEspacio } from "@/lib/reservas/negocios";
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
  const { data: todasMesas = [], refetch: refetchMesas } = useMesas();

  const [showForm, setShowForm] = useState(false);
  const [espacioEditando, setEspacioEditando] = useState<any>();
  const [espacioAEliminar, setEspacioAEliminar] = useState<string | null>(null);
  const [espacioConfigurando, setEspacioConfigurando] = useState<{ id: string; nombre: string } | null>(null);

  const eliminarEspacio = useEliminarEspacio();

  // Obtener cantidad de mesas por espacio
  const getMesasCount = (espacioId: string) => {
    return todasMesas.filter((m) => m.espacio_id === espacioId).length;
  };

  // Callback para volver del editor - refrescar datos
  const handleBackFromEditor = () => {
    setEspacioConfigurando(null);
    refetchMesas(); // Refrescar conteo de mesas
  };

  // Si estamos configurando un espacio, mostrar el editor a pantalla completa
  if (espacioConfigurando) {
    return (
      <SuperAdminLayout>
        <div className="h-[calc(100vh-120px)] flex flex-col">
          <EditorPlanoEspacio
            espacioId={espacioConfigurando.id}
            espacioNombre={espacioConfigurando.nombre}
            onBack={handleBackFromEditor}
          />
        </div>
      </SuperAdminLayout>
    );
  }

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        {/* Sin título de página (2026-09-25): la pestaña "Espacios" activa en
            el menú lateral ya dice dónde estás. Se conserva el botón, que sí
            es una acción. */}
        <div className="flex justify-end">
          <Button onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nuevo Espacio
          </Button>
        </div>

        {/* Espacios agrupados por negocio: Casa Tomás (restaurante) y Touza
            (El Reservado). Cada negocio tiene su propio aforo: la capacidad
            de un grupo nunca se suma a la del otro (trigger
            validar_capacidad_reserva). */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : espacios.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay espacios creados</p>
        ) : (
          agruparPorNegocio(espacios as any[], (e) => marcaDeEspacio(e)).map(({ negocio, items }) => (
            <section key={negocio.marca} aria-labelledby={`negocio-${negocio.marca}`} className="space-y-3">
              <h3 id={`negocio-${negocio.marca}`} className="flex items-baseline gap-2 text-lg font-semibold">
                {negocio.etiqueta}
                <span className="text-sm font-normal text-muted-foreground">
                  Aforo por turno:{" "}
                  {items
                    .filter((e: any) => e.activa)
                    .reduce((s: number, e: any) => s + (Number(e.capacidad_maxima) || 0), 0)}{" "}
                  plazas
                </span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {items.map((espacio: any) => {
                  const mesasCount = getMesasCount(espacio.id);

                  return (
                      <Card key={espacio.id} className="group">
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <CardTitle className="flex items-center gap-2">
                                {espacio.nombre}
                                <NegocioBadge marca={marcaDeEspacio(espacio)} corta />
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
                          <div className="space-y-3">
                            <div className="flex items-center gap-4 text-sm">
                              <div className="flex items-center gap-2">
                                <Users className="h-4 w-4 text-muted-foreground" />
                                <span className="text-muted-foreground">Capacidad:</span>
                                <span className="font-medium">{espacio.capacidad_maxima}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">Mesas:</span>
                                <Badge variant="outline">{mesasCount}</Badge>
                              </div>
                            </div>

                            {/* Botón de configurar plano */}
                            <Button
                              variant="outline"
                              className="w-full"
                              onClick={() => {
                                console.log("[Espacios] abrir editor plano", {
                                  espacioId: espacio.id,
                                  espacioNombre: espacio.nombre,
                                });
                                setEspacioConfigurando({ id: espacio.id, nombre: espacio.nombre });
                              }}
                            >
                              <Settings2 className="h-4 w-4 mr-2" />
                              Configurar Plano y Mesas
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                  );
                })}
              </div>
            </section>
          ))
        )}

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
                Esta acción no se puede deshacer. Se eliminará permanentemente el espacio, 
                incluyendo todas sus mesas y la configuración del plano.
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
    </SuperAdminLayout>
  );
}
