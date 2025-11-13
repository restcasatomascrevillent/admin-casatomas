import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DndContext, DragEndEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { format, startOfWeek, addDays, addWeeks, subWeeks } from "date-fns";
import { es } from "date-fns/locale";
import { TrabajadorDraggable } from "@/components/turnos/TrabajadorDraggable";
import { TurnoSlot } from "@/components/turnos/TurnoSlot";
import {
  useTurnos,
  useTrabajadores,
  useAsignaciones,
  useCrearAsignacion,
  useEliminarAsignacion,
} from "@/hooks/useTurnos";

export default function Turnos() {
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);

  const { data: turnos = [], isLoading: loadingTurnos } = useTurnos();
  const { data: trabajadores = [], isLoading: loadingTrabajadores } = useTrabajadores();
  const { data: asignaciones = [], isLoading: loadingAsignaciones } = useAsignaciones(
    format(weekStart, "yyyy-MM-dd"),
    format(weekEnd, "yyyy-MM-dd")
  );
  const crearAsignacion = useCrearAsignacion();
  const eliminarAsignacion = useEliminarAsignacion();

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) return;

    const trabajadorId = active.id as string;
    const [turnoId, fecha] = (over.id as string).split("-");

    crearAsignacion.mutate({
      trabajador_id: trabajadorId,
      turno_id: turnoId,
      fecha,
      sala_id: null,
      posicion_sala_id: null,
      notas: null,
      asignacion_automatica: false,
    });
  };

  const getAsignacionesParaTurnoYFecha = (turnoId: string, fecha: string) => {
    return asignaciones.filter(
      (a: any) => a.turno_id === turnoId && a.fecha === fecha
    );
  };

  const isLoading = loadingTurnos || loadingTrabajadores || loadingAsignaciones;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Gestión de Turnos</h2>
            <p className="text-muted-foreground">
              Arrastra trabajadores a los turnos para asignarlos
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 min-w-[200px] justify-center">
              <CalendarIcon className="h-4 w-4" />
              <span className="font-medium">
                {format(weekStart, "d MMM", { locale: es })} -{" "}
                {format(weekEnd, "d MMM yyyy", { locale: es })}
              </span>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => setCurrentWeek(new Date())}
            >
              Hoy
            </Button>
          </div>
        </div>

        <DndContext onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Lista de trabajadores */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-lg">Trabajadores Disponibles</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Cargando...</p>
                ) : (
                  <div className="space-y-2">
                    {trabajadores.map((trabajador) => (
                      <TrabajadorDraggable
                        key={trabajador.id}
                        trabajador={trabajador}
                      />
                    ))}
                    {trabajadores.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No hay trabajadores activos
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Calendario de turnos */}
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-lg">Calendario Semanal</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Cargando calendario...</p>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="min-w-[800px]">
                      {/* Header con días */}
                      <div className="grid grid-cols-8 gap-2 mb-4">
                        <div className="font-medium text-sm text-muted-foreground">
                          Turno
                        </div>
                        {weekDays.map((day) => (
                          <div key={day.toISOString()} className="text-center">
                            <p className="font-semibold text-sm">
                              {format(day, "EEE", { locale: es })}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(day, "d MMM", { locale: es })}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* Grid de turnos */}
                      <div className="space-y-3">
                        {turnos.map((turno) => (
                          <div key={turno.id} className="grid grid-cols-8 gap-2">
                            <div className="flex flex-col justify-center">
                              <p className="font-medium text-sm">{turno.nombre}</p>
                              <p className="text-xs text-muted-foreground">
                                {turno.hora_inicio.slice(0, 5)} -{" "}
                                {turno.hora_fin.slice(0, 5)}
                              </p>
                            </div>
                            {weekDays.map((day) => {
                              const fecha = format(day, "yyyy-MM-dd");
                              const dayOfWeek = day.getDay();
                              const isTurnoActivo = turno.dias_semana.includes(dayOfWeek);

                              return (
                                <div key={fecha}>
                                  {isTurnoActivo ? (
                                    <TurnoSlot
                                      turno={turno}
                                      fecha={fecha}
                                      asignaciones={getAsignacionesParaTurnoYFecha(
                                        turno.id,
                                        fecha
                                      )}
                                      onEliminarAsignacion={(id) =>
                                        eliminarAsignacion.mutate(id)
                                      }
                                    />
                                  ) : (
                                    <Card className="p-3 min-h-[120px] bg-muted/30 border-dashed">
                                      <p className="text-xs text-muted-foreground text-center">
                                        No disponible
                                      </p>
                                    </Card>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                        {turnos.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-8">
                            No hay turnos configurados
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </DndContext>
      </div>
    </DashboardLayout>
  );
}
