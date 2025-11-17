import { useState, useMemo } from "react";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTurnos, useTrabajadoresActivos, useActualizarTurno } from "@/hooks/useTrabajadores";
import { useAreasTrabajoActivas } from "@/hooks/useAreasTrabajo";
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
  areas_asignadas?: string[]; // IDs de áreas
  notas?: string;
}

const TRABAJADOR_COLORS = [
  "bg-blue-500/90 border-blue-600",
  "bg-purple-500/90 border-purple-600",
  "bg-pink-500/90 border-pink-600",
  "bg-rose-500/90 border-rose-600",
  "bg-orange-500/90 border-orange-600",
  "bg-amber-500/90 border-amber-600",
  "bg-yellow-500/90 border-yellow-600",
  "bg-lime-500/90 border-lime-600",
  "bg-green-500/90 border-green-600",
  "bg-emerald-500/90 border-emerald-600",
  "bg-teal-500/90 border-teal-600",
  "bg-cyan-500/90 border-cyan-600",
  "bg-sky-500/90 border-sky-600",
  "bg-indigo-500/90 border-indigo-600",
  "bg-violet-500/90 border-violet-600",
  "bg-fuchsia-500/90 border-fuchsia-600",
];

const getColorForTrabajador = (trabajadorId: string, allTrabajadores: any[]) => {
  const index = allTrabajadores.findIndex((t) => t.id === trabajadorId);
  return TRABAJADOR_COLORS[index % TRABAJADOR_COLORS.length];
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

// Función para detectar si dos turnos se superponen
const turnosSeSuperponen = (turno1: TurnoConTrabajador, turno2: TurnoConTrabajador) => {
  const inicio1 = timeToMinutes(turno1.hora_inicio);
  const fin1 = timeToMinutes(turno1.hora_fin);
  const inicio2 = timeToMinutes(turno2.hora_inicio);
  const fin2 = timeToMinutes(turno2.hora_fin);
  
  return inicio1 < fin2 && inicio2 < fin1;
};

// Función para calcular subcolumnas para turnos superpuestos
const calcularSubcolumnas = (turnos: TurnoConTrabajador[]) => {
  const turnosOrdenados = [...turnos].sort((a, b) => {
    const inicioA = timeToMinutes(a.hora_inicio);
    const inicioB = timeToMinutes(b.hora_inicio);
    return inicioA - inicioB;
  });

  const columnas: TurnoConTrabajador[][] = [];
  
  turnosOrdenados.forEach((turno) => {
    // Buscar una columna donde este turno no se superponga con ningún otro
    let columnaEncontrada = false;
    
    for (let i = 0; i < columnas.length; i++) {
      const superpone = columnas[i].some((turnoEnColumna) =>
        turnosSeSuperponen(turno, turnoEnColumna)
      );
      
      if (!superpone) {
        columnas[i].push(turno);
        columnaEncontrada = true;
        break;
      }
    }
    
    if (!columnaEncontrada) {
      columnas.push([turno]);
    }
  });

  // Crear un mapa de turno.id -> { columna, totalColumnas }
  const mapaSubcolumnas: Record<string, { columna: number; totalColumnas: number }> = {};
  
  turnosOrdenados.forEach((turno) => {
    // Encontrar en qué columna está este turno
    for (let i = 0; i < columnas.length; i++) {
      if (columnas[i].some((t) => t.id === turno.id)) {
        // Calcular cuántas columnas se necesitan en el rango de este turno
        const turnosSuperpuestos = turnosOrdenados.filter((t) =>
          turnosSeSuperponen(turno, t)
        );
        const columnasNecesarias = new Set<number>();
        turnosSuperpuestos.forEach((ts) => {
          for (let j = 0; j < columnas.length; j++) {
            if (columnas[j].some((t) => t.id === ts.id)) {
              columnasNecesarias.add(j);
            }
          }
        });
        
        mapaSubcolumnas[turno.id] = {
          columna: i,
          totalColumnas: columnasNecesarias.size,
        };
        break;
      }
    }
  });

  return mapaSubcolumnas;
};

// Función para agrupar turnos por área de trabajo
const agruparTurnosPorArea = (turnos: TurnoConTrabajador[], areas: any[]) => {
  // Crear un mapa de área -> turnos
  const turnosPorArea: Record<string, TurnoConTrabajador[]> = {};
  
  // Inicializar con todas las áreas
  areas.forEach((area) => {
    turnosPorArea[area.id] = [];
  });
  
  // Crear categoría para "Sin asignar"
  turnosPorArea["sin_asignar"] = [];
  
  // Clasificar turnos por área
  turnos.forEach((turno) => {
    if (turno.areas_asignadas && turno.areas_asignadas.length > 0) {
      // Asignar a la primera área (por simplicidad, podríamos mejorarlo)
      const areaId = turno.areas_asignadas[0];
      if (turnosPorArea[areaId]) {
        turnosPorArea[areaId].push(turno);
      } else {
        turnosPorArea["sin_asignar"].push(turno);
      }
    } else {
      turnosPorArea["sin_asignar"].push(turno);
    }
  });
  
  return turnosPorArea;
};

interface TurnoCardProps {
  turno: TurnoConTrabajador;
  colorClass: string;
  isDragging?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

const TurnoCard = ({ turno, colorClass, isDragging, onClick, style }: TurnoCardProps) => {
  return (
    <div
      className={cn(
        "absolute rounded border-l-4 cursor-pointer hover:brightness-110 transition-all",
        colorClass,
        isDragging && "opacity-50"
      )}
      style={style}
      onClick={onClick}
      title={`${turno.trabajador_nombre}\n${turno.hora_inicio} - ${turno.hora_fin}\n${turno.estado}\n${turno.puesto}`}
    />
  );
};

interface DraggableTurnoProps {
  turno: TurnoConTrabajador;
  fecha: string;
  colorClass: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

const DraggableTurno = ({ turno, fecha, colorClass, onClick, style }: DraggableTurnoProps) => {
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
      <TurnoCard turno={turno} colorClass={colorClass} isDragging={isDragging} style={combinedStyle} />
    </div>
  );
};

interface AreaColumnProps {
  fecha: string;
  areaId: string;
  areaNombre: string;
  turnosArea: TurnoConTrabajador[];
  trabajadores: any[];
  onCrearTurno: (fecha: string, hora: string) => void;
  onEditarTurno: (turno: TurnoConTrabajador) => void;
}

const AreaColumn = ({
  fecha,
  areaId,
  areaNombre,
  turnosArea,
  trabajadores,
  onCrearTurno,
  onEditarTurno,
}: AreaColumnProps) => {
  const { setNodeRef, isOver } = useSortable({
    id: `area-${fecha}-${areaId}`,
    data: {
      fecha,
      areaId,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative border-l border-border/50 flex-1 min-w-[100px] group",
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
      {(() => {
        const subcolumnas = calcularSubcolumnas(turnosArea);
        
        return turnosArea.map((turno) => {
          const { top, height } = calcularPosicionYAltura(turno.hora_inicio, turno.hora_fin);
          const colorClass = getColorForTrabajador(turno.trabajador_id, trabajadores);
          const { columna, totalColumnas } = subcolumnas[turno.id] || { columna: 0, totalColumnas: 1 };
          
          const anchoSubcolumna = 100 / totalColumnas;
          const leftSubcolumna = columna * anchoSubcolumna;

          return (
            <DraggableTurno
              key={turno.id}
              turno={turno}
              fecha={fecha}
              colorClass={colorClass}
              onClick={() => onEditarTurno(turno)}
              style={{
                top: `${top}px`,
                height: `${height}px`,
                width: `${anchoSubcolumna}%`,
                left: `${leftSubcolumna}%`,
              }}
            />
          );
        });
      })()}
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
  const { data: areas = [] } = useAreasTrabajoActivas();
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
      
      // Obtener IDs de áreas desde areas_ids
      const areasIds = turno.areas_ids || [];
      
      return {
        ...turno,
        trabajador_nombre: trabajador ? `${trabajador.nombre} ${trabajador.apellidos}` : "Desconocido",
        puesto: trabajador?.puesto || "",
        areas_asignadas: areasIds, // Usar los IDs directamente
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

                {/* Columnas de días con áreas */}
                <div className="flex-1">
                  {/* Headers de días */}
                  <div className="flex">
                    {weekDays.map((day) => {
                      const fechaStr = format(day, "yyyy-MM-dd");
                      const isToday = format(day, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

                      return (
                        <div key={day.toString()} className="flex-1">
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
                        </div>
                      );
                    })}
                  </div>

                  {/* Headers de áreas */}
                  <div className="flex border-b border-border/50">
                    {weekDays.map((day) => (
                      <div key={`areas-${day.toString()}`} className="flex-1 flex border-l border-border/50">
                        {areas.map((area: any) => (
                          <div
                            key={area.id}
                            className="flex-1 text-center py-1 px-1 border-l first:border-l-0 border-border/30 bg-muted/30"
                          >
                            <div className="text-[10px] font-medium truncate" title={area.nombre}>
                              {area.nombre}
                            </div>
                          </div>
                        ))}
                        <div className="flex-1 text-center py-1 px-1 border-l border-border/30 bg-muted/20">
                          <div className="text-[10px] font-medium truncate">Sin área</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Columnas de áreas por día */}
                  <div className="flex">
                    {weekDays.map((day) => {
                      const fechaStr = format(day, "yyyy-MM-dd");
                      const turnosDia = turnosSemana.filter((t: any) => t.fecha === fechaStr);
                      const turnosPorArea = agruparTurnosPorArea(turnosDia, areas);

                      return (
                        <div key={`cols-${day.toString()}`} className="flex-1 flex">
                          {/* Columnas de áreas */}
                          {areas.map((area: any) => (
                            <AreaColumn
                              key={`${fechaStr}-${area.id}`}
                              fecha={fechaStr}
                              areaId={area.id}
                              areaNombre={area.nombre}
                              turnosArea={turnosPorArea[area.id] || []}
                              trabajadores={trabajadores}
                              onCrearTurno={handleCrearTurno}
                              onEditarTurno={handleEditarTurno}
                            />
                          ))}
                          {/* Columna "Sin asignar" */}
                          <AreaColumn
                            key={`${fechaStr}-sin_asignar`}
                            fecha={fechaStr}
                            areaId="sin_asignar"
                            areaNombre="Sin asignar"
                            turnosArea={turnosPorArea["sin_asignar"] || []}
                            trabajadores={trabajadores}
                            onCrearTurno={handleCrearTurno}
                            onEditarTurno={handleEditarTurno}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Leyenda de trabajadores */}
              <div className="mt-6 pt-4 border-t">
                <span className="text-xs text-muted-foreground font-medium mb-3 block">Trabajadores:</span>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {trabajadores.map((trabajador: any) => {
                    const colorClass = getColorForTrabajador(trabajador.id, trabajadores);
                    return (
                      <div key={trabajador.id} className="flex items-center gap-2">
                        <div className={cn("w-4 h-4 rounded border-2 flex-shrink-0", colorClass)} />
                        <span className="text-xs truncate">
                          {trabajador.nombre} {trabajador.apellidos}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <DragOverlay>
              {activeTurno ? (
                <TurnoCard
                  turno={activeTurno}
                  colorClass={getColorForTrabajador(activeTurno.trabajador_id, trabajadores)}
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
