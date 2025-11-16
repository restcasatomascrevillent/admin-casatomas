import { useState, useMemo } from "react";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTurnos, useTrabajadoresActivos } from "@/hooks/useTrabajadores";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

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

export const CalendarioTurnosSemanal = () => {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  
  const weekStart = startOfWeek(currentDate, { locale: es, weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { locale: es, weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const { data: trabajadores = [] } = useTrabajadoresActivos();
  const { data: turnosData = [] } = useTurnos();

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

  const calcularPosicionTurno = (horaInicio: string, horaFin: string) => {
    const [horaI, minI] = horaInicio.split(":").map(Number);
    const [horaF, minF] = horaFin.split(":").map(Number);
    
    const minutosInicio = horaI * 60 + minI;
    const minutosFin = horaF * 60 + minF;
    const duracionMinutos = minutosFin - minutosInicio;
    
    // Consideramos un día de 24 horas (0:00 - 24:00)
    const left = (minutosInicio / (24 * 60)) * 100;
    const width = (duracionMinutos / (24 * 60)) * 100;
    
    return { left: `${left}%`, width: `${width}%` };
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

  const trabajadoresConTurnos = Array.from(turnosPorTrabajador.entries())
    .map(([trabajadorId, turnos]) => ({
      trabajadorId,
      trabajador: trabajadores.find((t: any) => t.id === trabajadorId),
      turnos,
    }))
    .filter((item) => item.trabajador);

  return (
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
                        <div
                          key={day.toString()}
                          className="relative min-h-[80px] bg-muted/30 rounded-md border border-border/50 p-1"
                        >
                          {turnosDia.length > 0 ? (
                            <div className="space-y-1">
                              {turnosDia.map((turno) => {
                                const pos = calcularPosicionTurno(turno.hora_inicio, turno.hora_fin);
                                const duracion = calcularDuracion(turno.hora_inicio, turno.hora_fin);

                                return (
                                  <div
                                    key={turno.id}
                                    className={cn(
                                      "rounded px-2 py-1 text-white text-xs border-l-4",
                                      ESTADOS_COLORS[turno.estado] || "bg-gray-500/80 border-gray-600"
                                    )}
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
                              })}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground/50 text-center py-8">
                              -
                            </div>
                          )}
                        </div>
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
      </CardContent>
    </Card>
  );
};
