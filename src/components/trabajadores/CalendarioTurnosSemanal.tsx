import { useState, useMemo } from "react";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

const HORAS_DIA = Array.from({ length: 17 }, (_, i) => i + 7); // 7:00 a 23:00
const ALTURA_HORA = 60; // Pixels por hora

const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const calcularPosicionYAltura = (horaInicio: string, horaFin: string) => {
  const minutosInicio = timeToMinutes(horaInicio);
  const minutosFin = timeToMinutes(horaFin);
  const minutosBase = 7 * 60; // 7:00 AM es la base
  
  const top = ((minutosInicio - minutosBase) / 60) * ALTURA_HORA;
  const height = ((minutosFin - minutosInicio) / 60) * ALTURA_HORA;
  
  return { top, height };
};

// Función para detectar superposiciones y calcular columnas
const calcularColumnas = (turnos: TurnoConTrabajador[]) => {
  if (turnos.length === 0) return [];
  
  const turnosOrdenados = [...turnos].sort((a, b) => 
    timeToMinutes(a.hora_inicio) - timeToMinutes(b.hora_inicio)
  );
  
  const columnas: { turno: TurnoConTrabajador; columna: number; totalColumnas: number }[] = [];
  const columnasOcupadas: { turno: TurnoConTrabajador; finMinutos: number }[][] = [[]];
  
  turnosOrdenados.forEach((turno) => {
    const inicioMinutos = timeToMinutes(turno.hora_inicio);
    const finMinutos = timeToMinutes(turno.hora_fin);
    
    // Buscar una columna libre
    let columnaEncontrada = -1;
    for (let i = 0; i < columnasOcupadas.length; i++) {
      const ultimoTurno = columnasOcupadas[i][columnasOcupadas[i].length - 1];
      if (!ultimoTurno || ultimoTurno.finMinutos <= inicioMinutos) {
        columnaEncontrada = i;
        break;
      }
    }
    
    // Si no hay columna libre, crear una nueva
    if (columnaEncontrada === -1) {
      columnaEncontrada = columnasOcupadas.length;
      columnasOcupadas.push([]);
    }
    
    columnasOcupadas[columnaEncontrada].push({ turno, finMinutos });
  });
  
  // Calcular el número total de columnas para cada turno
  turnosOrdenados.forEach((turno) => {
    const inicioMinutos = timeToMinutes(turno.hora_inicio);
    const finMinutos = timeToMinutes(turno.hora_fin);
    
    // Contar cuántas columnas se superponen con este turno
    let maxColumnas = 1;
    columnasOcupadas.forEach((col) => {
      col.forEach((item) => {
        const itemInicio = timeToMinutes(item.turno.hora_inicio);
        const itemFin = timeToMinutes(item.turno.hora_fin);
        
        // Hay superposición si los intervalos se cruzan
        if (!(finMinutos <= itemInicio || inicioMinutos >= itemFin)) {
          maxColumnas = Math.max(maxColumnas, columnasOcupadas.length);
        }
      });
    });
    
    // Encontrar la columna de este turno
    const columna = columnasOcupadas.findIndex((col) => 
      col.some((item) => item.turno.id === turno.id)
    );
    
    columnas.push({ turno, columna, totalColumnas: maxColumnas });
  });
  
  return columnas;
};

interface TurnoCardProps {
  turno: TurnoConTrabajador;
  isDragging?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

const TurnoCard = ({ turno, isDragging, onClick, style }: TurnoCardProps) => {
  return (
    <div
      className={cn(
        "absolute rounded px-2 py-1 text-white text-xs border-l-4 cursor-pointer hover:brightness-110 transition-all overflow-hidden",
        ESTADOS_COLORS[turno.estado] || "bg-gray-500/80 border-gray-600",
        isDragging && "opacity-50"
      )}
      style={style}
      onClick={onClick}
      title={`${turno.trabajador_nombre}\n${turno.hora_inicio} - ${turno.hora_fin}\n${turno.estado}`}
    >
      <div className="font-semibold truncate">{turno.trabajador_nombre}</div>
      <div className="text-[10px] opacity-90">
        {turno.hora_inicio.substring(0, 5)} - {turno.hora_fin.substring(0, 5)}
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
  fecha: string;
}

const DraggableTurno = ({ turno, fecha, onClick, style }: DraggableTurnoProps) => {
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
      fecha,
    },
  });

  const combinedStyle = {
    ...style,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.();
  };

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={handleClick}>
      <TurnoCard turno={turno} isDragging={isDragging} style={combinedStyle} />
    </div>
  );
};

interface DroppableDayColumnProps {
  fecha: string;
  turnosDia: TurnoConTrabajador[];
  onCrearTurno: (fecha: string, hora: string) => void;
  onEditarTurno: (turno: TurnoConTrabajador) => void;
}

const DroppableDayColumn = ({
  fecha,
  turnosDia,
  onCrearTurno,
  onEditarTurno,
}: DroppableDayColumnProps) => {
  const { setNodeRef, isOver } = useSortable({
    id: `day-${fecha}`,
    data: {
      fecha,
    },
  });

  const turnosConColumnas = calcularColumnas(turnosDia);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative border-l border-border/50 min-w-[120px] group",
        isOver && "bg-primary/10"
      )}
      style={{ height: HORAS_DIA.length * ALTURA_HORA }}
    >
      {/* Líneas horizontales para cada hora */}
      {HORAS_DIA.map((hora, index) => (
        <div
          key={hora}
          className="absolute left-0 right-0 border-t border-border/30"
          style={{ top: index * ALTURA_HORA }}
        />
      ))}
      
      {/* Botón para crear turno (visible en hover) */}
      <button
        onClick={() => onCrearTurno(fecha, "09:00")}
        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-muted/20"
      >
        <Plus className="h-6 w-6 text-muted-foreground" />
      </button>

      {/* Turnos posicionados */}
      {turnosConColumnas.map(({ turno, columna, totalColumnas }) => {
        const { top, height } = calcularPosicionYAltura(turno.hora_inicio, turno.hora_fin);
        const width = `${100 / totalColumnas}%`;
        const left = `${(columna / totalColumnas) * 100}%`;

        return (
          <DraggableTurno
            key={turno.id}
            turno={turno}
            fecha={fecha}
            onClick={() => onEditarTurno(turno)}
            style={{
              top: `${top}px`,
              height: `${height}px`,
              width,
              left,
            }}
          />
        );
      })}
    </div>
  );
};

export const CalendarioTurnosSemanal = () => {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [turnoSeleccionado, setTurnoSeleccionado] = useState<any>(null);
  const [fechaInicial, setFechaInicial] = useState<string | undefined>();
  const [horaInicial, setHoraInicial] = useState<string | undefined>();
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
    }).map((turno: any) => {
      const trabajador = trabajadores.find((t: any) => t.id === turno.trabajador_id);
      return {
        ...turno,
        trabajador_nombre: trabajador ? `${trabajador.nombre} ${trabajador.apellidos}` : "Desconocido",
        puesto: trabajador?.puesto || "",
      };
    });
  }, [turnosData, weekStart, weekEnd, trabajadores]);

  const handleCrearTurno = (fecha: string, hora: string) => {
    setTurnoSeleccionado(null);
    setFechaInicial(fecha);
    setHoraInicial(hora);
    setDialogOpen(true);
  };

  const handleEditarTurno = (turno: any) => {
    setTurnoSeleccionado(turno);
    setFechaInicial(undefined);
    setHoraInicial(undefined);
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
    const overData = over.data.current as { fecha: string } | undefined;

    if (!activeTurno || !overData) return;

    // Actualizar el turno con la nueva fecha
    if (overData.fecha !== activeTurno.fecha) {
      await actualizarTurnoMutation.mutateAsync({
        id: activeTurno.id,
        fecha: overData.fecha,
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
              <div className="flex">
                {/* Columna de horas */}
                <div className="flex-shrink-0 w-16 pr-2">
                  {/* Header vacío para alinear con los días */}
                  <div className="h-12 border-b border-border/50" />
                  
                  {/* Horas del día */}
                  <div className="relative" style={{ height: HORAS_DIA.length * ALTURA_HORA }}>
                    {HORAS_DIA.map((hora, index) => (
                      <div
                        key={hora}
                        className="absolute right-0 -translate-y-2 text-xs text-muted-foreground font-medium"
                        style={{ top: index * ALTURA_HORA }}
                      >
                        {hora.toString().padStart(2, '0')}:00
                      </div>
                    ))}
                  </div>
                </div>

                {/* Columnas de días */}
                <div className="flex-1 flex">
                  {weekDays.map((day) => {
                    const fechaStr = format(day, "yyyy-MM-dd");
                    const turnosDia = turnosSemana.filter((t) => t.fecha === fechaStr);
                    const isToday = format(day, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

                    return (
                      <div key={day.toString()} className="flex-1">
                        {/* Header del día */}
                        <div className={cn(
                          "h-12 flex flex-col items-center justify-center border-b border-l border-border/50",
                          isToday && "bg-primary/10"
                        )}>
                          <div className={cn(
                            "font-semibold text-sm",
                            isToday && "text-primary"
                          )}>
                            {format(day, "EEE", { locale: es })}
                          </div>
                          <div className={cn(
                            "text-xs text-muted-foreground",
                            isToday && "text-primary font-medium"
                          )}>
                            {format(day, "d MMM", { locale: es })}
                          </div>
                        </div>

                        {/* Columna de turnos */}
                        <DroppableDayColumn
                          fecha={fechaStr}
                          turnosDia={turnosDia}
                          onCrearTurno={handleCrearTurno}
                          onEditarTurno={handleEditarTurno}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

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
                  turno={activeTurno}
                  style={{ width: 100, height: 60 }}
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
        horaInicialProp={horaInicial}
      />
    </>
  );
};
