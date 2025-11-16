import { useState, useMemo } from "react";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTurnos, useTrabajadoresActivos, useActualizarTurno } from "@/hooks/useTrabajadores";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { DialogTurno } from "./DialogTurno";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";

interface TurnoConTrabajador {
  id: string;
  trabajador_id: string;
  trabajador_nombre: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: string;
  puesto: string;
  salas_asignadas?: string[];
  notas?: string;
}

const ESTADOS_COLORS: Record<string, string> = {
  programado: "bg-blue-500/80 border-blue-600",
  activo: "bg-green-500/80 border-green-600",
  completado: "bg-gray-400/80 border-gray-500",
  cancelado: "bg-red-500/80 border-red-600",
};

const calcularDuracion = (horaInicio: string, horaFin: string) => {
  const [horaI, minI] = horaInicio.split(":").map(Number);
  const [horaF, minF] = horaFin.split(":").map(Number);
  
  const minutosInicio = horaI * 60 + minI;
  const minutosFin = horaF * 60 + minF;
  const duracionMinutos = minutosFin - minutosInicio;
  
  const horas = Math.floor(duracionMinutos / 60);
  const minutos = duracionMinutos % 60;
  
  return minutos > 0 ? `${horas}h ${minutos}m` : `${horas}h`;
};

interface TurnoCardProps {
  turno: TurnoConTrabajador;
  isDragging?: boolean;
  onClick?: () => void;
}

const TurnoCard = ({ turno, isDragging, onClick }: TurnoCardProps) => {
  const duracion = calcularDuracion(turno.hora_inicio, turno.hora_fin);

  return (
    <div
      className={cn(
        "rounded px-2 py-1 text-white text-xs border-l-4 cursor-pointer hover:brightness-110 transition-all",
        ESTADOS_COLORS[turno.estado] || "bg-gray-500/80 border-gray-600",
        isDragging && "opacity-50"
      )}
      onClick={onClick}
      title={`${turno.trabajador_nombre}\n${turno.hora_inicio} - ${turno.hora_fin}\n${turno.estado}`}
    >
      <div className="font-semibold">{duracion}</div>
      <div className="text-[10px] opacity-90">
        {turno.hora_inicio.substring(0, 5)}
      </div>
      {turno.salas_asignadas && turno.salas_asignadas.length > 0 && (
        <div className="text-[10px] opacity-75 truncate">
          {turno.salas_asignadas[0]}
        </div>
      )}
    </div>
  );
};

interface DraggableTurnoProps extends TurnoCardProps {
  turno: TurnoConTrabajador;
  trabajadorId: string;
  fecha: string;
}

const DraggableTurno = ({ turno, trabajadorId, fecha, onClick }: DraggableTurnoProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: turno.id,
    data: {
      turno,
      trabajadorId,
      fecha,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.();
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={handleClick}>
      <TurnoCard turno={turno} isDragging={isDragging} />
    </div>
  );
};

interface DroppableCellProps {
  trabajadorId: string;
  fecha: string;
  turnosDia: TurnoConTrabajador[];
  onCrearTurno: (fecha: string, trabajadorId: string) => void;
  onEditarTurno: (turno: TurnoConTrabajador) => void;
}

const DroppableCell = ({
  trabajadorId,
  fecha,
  turnosDia,
  onCrearTurno,
  onEditarTurno,
}: DroppableCellProps) => {
  const { setNodeRef, isOver } = useSortable({
    id: `${trabajadorId}-${fecha}`,
    data: {
      trabajadorId,
      fecha,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative min-h-[80px] bg-muted/30 rounded-md border border-border/50 p-1 group",
        isOver && "bg-primary/10 border-primary"
      )}
    >
      {turnosDia.length > 0 ? (
        <div className="space-y-1">
          {turnosDia.map((turno) => (
            <DraggableTurno
              key={turno.id}
              turno={turno}
              trabajadorId={trabajadorId}
              fecha={fecha}
              onClick={() => onEditarTurno(turno)}
            />
          ))}
        </div>
      ) : (
        <button
          onClick={() => onCrearTurno(fecha, trabajadorId)}
          className="w-full h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Plus className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
};

export const CalendarioTurnosSemanal = () => {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [turnoSeleccionado, setTurnoSeleccionado] = useState<any>(null);
  const [fechaInicial, setFechaInicial] = useState<string | undefined>();
  const [trabajadorIdInicial, setTrabajadorIdInicial] = useState<string | undefined>();
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  
  const weekStart = startOfWeek(currentDate, { locale: es, weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { locale: es, weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const { data: trabajadores = [] } = useTrabajadoresActivos();
  const { data: turnosData = [] } = useTurnos();
  const actualizarTurnoMutation = useActualizarTurno();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Filtrar turnos de la semana actual
  const turnosSemana = useMemo(() => {
    const startStr = format(weekStart, "yyyy-MM-dd");
    const endStr = format(weekEnd, "yyyy-MM-dd");
    
    return (turnosData as any[]).filter((turno: any) => {
      return turno.fecha >= startStr && turno.fecha <= endStr;
    });
  }, [turnosData, weekStart, weekEnd]);

  // Organizar turnos por trabajador
  const turnosPorTrabajador = useMemo(() => {
    const map = new Map<string, TurnoConTrabajador[]>();
    
    turnosSemana.forEach((turno: any) => {
      const trabajador = trabajadores.find((t: any) => t.id === turno.trabajador_id);
      const turnoConTrabajador: TurnoConTrabajador = {
        ...turno,
        trabajador_nombre: trabajador ? `${trabajador.nombre} ${trabajador.apellidos}` : "Desconocido",
        puesto: trabajador?.puesto || "",
      };
      
      const existing = map.get(turno.trabajador_id) || [];
      map.set(turno.trabajador_id, [...existing, turnoConTrabajador]);
    });
    
    return map;
  }, [turnosSemana, trabajadores]);

  const trabajadoresConTurnos = Array.from(turnosPorTrabajador.entries())
    .map(([trabajadorId, turnos]) => ({
      trabajadorId,
      trabajador: trabajadores.find((t: any) => t.id === trabajadorId),
      turnos,
    }))
    .filter((item) => item.trabajador);

  const handleCrearTurno = (fecha: string, trabajadorId: string) => {
    setTurnoSeleccionado(null);
    setFechaInicial(fecha);
    setTrabajadorIdInicial(trabajadorId);
    setDialogOpen(true);
  };

  const handleEditarTurno = (turno: any) => {
    setTurnoSeleccionado(turno);
    setFechaInicial(undefined);
    setTrabajadorIdInicial(undefined);
    setDialogOpen(true);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over || active.id === over.id) return;

    const activeTurno = active.data.current?.turno as TurnoConTrabajador;
    const overData = over.data.current as { trabajadorId: string; fecha: string } | undefined;

    if (!activeTurno || !overData) return;

    // Actualizar el turno con la nueva fecha o trabajador
    const updates: any = {};
    
    if (overData.fecha !== activeTurno.fecha) {
      updates.fecha = overData.fecha;
    }
    
    if (overData.trabajadorId !== activeTurno.trabajador_id) {
      updates.trabajador_id = overData.trabajadorId;
    }

    if (Object.keys(updates).length > 0) {
      await actualizarTurnoMutation.mutateAsync({
        id: activeTurno.id,
        ...updates,
      });
    }
  };

  const activeTurno = activeDragId
    ? turnosSemana.find((t: any) => t.id === activeDragId)
    : null;

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Calendario de Turnos</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentDate(subWeeks(currentDate, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                onClick={() => setCurrentDate(new Date())}
              >
                Hoy
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentDate(addWeeks(currentDate, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Semana del {format(weekStart, "d 'de' MMMM", { locale: es })} al{" "}
            {format(weekEnd, "d 'de' MMMM 'de' yyyy", { locale: es })}
          </p>
        </CardHeader>
        <CardContent>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="overflow-x-auto">
              {/* Header con días de la semana */}
              <div className="grid grid-cols-[200px_1fr] gap-4 mb-4">
                <div className="font-semibold text-sm">Trabajador</div>
                <div className="grid grid-cols-7 gap-2">
                  {weekDays.map((day) => (
                    <div key={day.toString()} className="text-center">
                      <div className="font-semibold text-sm">
                        {format(day, "EEE", { locale: es })}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(day, "d MMM", { locale: es })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Filas de trabajadores */}
              {trabajadoresConTurnos.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No hay turnos programados para esta semana
                </p>
              ) : (
                <div className="space-y-3">
                  {trabajadoresConTurnos.map(({ trabajadorId, trabajador, turnos }) => (
                    <div key={trabajadorId} className="grid grid-cols-[200px_1fr] gap-4 items-start">
                      {/* Columna de trabajador */}
                      <div className="flex flex-col gap-1 py-2">
                        <div className="font-medium text-sm">
                          {trabajador.nombre} {trabajador.apellidos}
                        </div>
                        <Badge variant="outline" className="w-fit text-xs">
                          {trabajador.puesto}
                        </Badge>
                      </div>

                      {/* Grid de días */}
                      <div className="grid grid-cols-7 gap-2">
                        {weekDays.map((day) => {
                          const fechaStr = format(day, "yyyy-MM-dd");
                          const turnosDia = turnos.filter((t) => t.fecha === fechaStr);

                          return (
                            <DroppableCell
                              key={day.toString()}
                              trabajadorId={trabajadorId}
                              fecha={fechaStr}
                              turnosDia={turnosDia}
                              onCrearTurno={handleCrearTurno}
                              onEditarTurno={handleEditarTurno}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Leyenda de estados */}
              <div className="flex items-center gap-4 mt-6 pt-4 border-t">
                <span className="text-xs text-muted-foreground font-medium">Estado:</span>
                {Object.entries(ESTADOS_COLORS).map(([estado, color]) => (
                  <div key={estado} className="flex items-center gap-2">
                    <div className={cn("w-3 h-3 rounded border-2", color)} />
                    <span className="text-xs capitalize">{estado}</span>
                  </div>
                ))}
              </div>
            </div>

            <DragOverlay>
              {activeTurno ? (
                <TurnoCard
                  turno={{
                    ...activeTurno,
                    trabajador_nombre: "",
                    puesto: "",
                  }}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </CardContent>
      </Card>

      <DialogTurno
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        turnoId={turnoSeleccionado?.id}
        turnoData={turnoSeleccionado}
        fechaInicial={fechaInicial}
        trabajadorIdInicial={trabajadorIdInicial}
      />
    </>
  );
};
