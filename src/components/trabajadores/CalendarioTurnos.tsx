import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTurnosCompleta, useTrabajadoresActivos } from "@/hooks/useTrabajadores";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DialogTurno } from "./DialogTurno";

const HORAS_DIA = Array.from({ length: 17 }, (_, i) => i + 7); // 7:00 a 23:00
const PIXELS_POR_HORA = 60;

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

const getColorForTrabajador = (trabajadorId: string, trabajadoresIds: string[]) => {
  const index = trabajadoresIds.indexOf(trabajadorId);
  return TRABAJADOR_COLORS[index % TRABAJADOR_COLORS.length];
};

const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const calcularPosicionYAltura = (horaInicio: string, horaFin: string) => {
  const minutosInicio = timeToMinutes(horaInicio);
  const minutosFin = timeToMinutes(horaFin);
  const minutosDesde7AM = minutosInicio - (7 * 60);
  
  const top = (minutosDesde7AM / 60) * PIXELS_POR_HORA;
  const duracionMinutos = minutosFin - minutosInicio;
  const height = (duracionMinutos / 60) * PIXELS_POR_HORA;
  
  return { top, height };
};

const ESTADOS_COLORS: Record<string, string> = {
  programado: "default",
  activo: "secondary", 
  completado: "outline",
  cancelado: "destructive",
};

const ESTADO_DOT_COLORS: Record<string, string> = {
  programado: "bg-primary",
  activo: "bg-secondary",
  completado: "bg-muted-foreground",
  cancelado: "bg-destructive",
};

export const CalendarioTurnos = () => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [open, setOpen] = useState(false);
  const [dialogTurnoAbierto, setDialogTurnoAbierto] = useState(false);
  const [turnoSeleccionado, setTurnoSeleccionado] = useState<any>(null);
  const [filtroPuesto, setFiltroPuesto] = useState<string>("todos");
  const fechaSeleccionada = format(selectedDate, "yyyy-MM-dd");
  
  const { data: turnosMes } = useTurnosCompleta();
  const { data: turnos, isLoading } = useTurnosCompleta(fechaSeleccionada);
  const { data: trabajadores } = useTrabajadoresActivos();

  // Crear un mapa de días con turnos
  const diasConTurnos = new Map<string, string[]>();
  turnosMes?.forEach((turno: any) => {
    const fecha = turno.fecha;
    if (!diasConTurnos.has(fecha)) {
      diasConTurnos.set(fecha, []);
    }
    diasConTurnos.get(fecha)?.push(turno.estado);
  });

  const modifiers = {
    conTurnos: Array.from(diasConTurnos.keys()).map(fecha => new Date(fecha + 'T00:00:00'))
  };

  const modifiersStyles: Record<string, React.CSSProperties> = {};
  diasConTurnos.forEach((estados, fecha) => {
    modifiersStyles[fecha] = { position: 'relative' };
  });

  // Obtener trabajadores únicos del día seleccionado
  const trabajadoresDelDia = turnos?.reduce((acc: any[], turno: any) => {
    // Filtrar por puesto si hay un filtro activo
    if (filtroPuesto !== "todos") {
      const puestosCoinciden = 
        (filtroPuesto === "cocina" && (turno.puesto === "cocinero" || turno.puesto === "ayudante_cocina")) ||
        (filtroPuesto === "camareros" && (turno.puesto === "camarero" || turno.puesto === "ayudante_camarero")) ||
        (filtroPuesto === "limpieza" && turno.puesto === "limpieza");
      
      if (!puestosCoinciden) return acc;
    }

    if (!acc.find(t => t.id === turno.trabajador_id)) {
      acc.push({
        id: turno.trabajador_id,
        nombre: turno.trabajador_nombre,
        puesto: turno.puesto
      });
    }
    return acc;
  }, []) || [];

  const trabajadoresIds = trabajadoresDelDia.map((t: any) => t.id);

  const handlePrevDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(newDate);
  };

  const handleNextDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(newDate);
  };

  const handleToday = () => {
    setSelectedDate(new Date());
  };

  const handleTurnoClick = (turno: any) => {
    setTurnoSeleccionado(turno);
    setDialogTurnoAbierto(true);
  };

  const handleCloseTurnoDialog = () => {
    setDialogTurnoAbierto(false);
    setTimeout(() => {
      setTurnoSeleccionado(null);
    }, 100);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle>Vista Diaria</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Filtros por puesto */}
            <div className="flex gap-1">
              <Button
                variant={filtroPuesto === "todos" ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltroPuesto("todos")}
              >
                Todos
              </Button>
              <Button
                variant={filtroPuesto === "cocina" ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltroPuesto("cocina")}
              >
                Cocina
              </Button>
              <Button
                variant={filtroPuesto === "camareros" ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltroPuesto("camareros")}
              >
                Camareros
              </Button>
              <Button
                variant={filtroPuesto === "limpieza" ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltroPuesto("limpieza")}
              >
                Limpieza
              </Button>
            </div>

            {/* Navegación de fechas */}
            <Button variant="outline" size="sm" onClick={handleToday}>
              Hoy
            </Button>
            <Button variant="outline" size="icon" onClick={handlePrevDay}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "justify-start text-left font-normal min-w-[240px]",
                  !selectedDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {selectedDate ? (
                  format(selectedDate, "d 'de' MMMM 'de' yyyy", { locale: es })
                ) : (
                  <span>Seleccionar fecha</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) {
                    setSelectedDate(date);
                    setOpen(false);
                  }
                }}
                locale={es}
                modifiers={modifiers}
                className={cn("rounded-md border pointer-events-auto")}
                modifiersStyles={modifiersStyles}
              />
              <div className="p-3 border-t">
                <div className="flex flex-wrap gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    <span>Programado</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-secondary" />
                    <span>Activo</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                    <span>Completado</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-destructive" />
                    <span>Cancelado</span>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
            <Button variant="outline" size="icon" onClick={handleNextDay}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-muted-foreground">Cargando turnos...</p>
        ) : !turnos || turnos.length === 0 ? (
          <p className="text-muted-foreground">No hay turnos programados para esta fecha</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-max">
              {/* Header con nombres de trabajadores */}
              <div className="flex border-b sticky top-0 bg-card z-10">
                <div className="w-20 flex-shrink-0 border-r p-2 font-medium text-sm">
                  Hora
                </div>
                {trabajadoresDelDia.map((trabajador: any) => (
                  <div 
                    key={trabajador.id}
                    className="flex-1 min-w-[200px] border-r p-2 text-center"
                  >
                    <div className="font-medium text-sm">{trabajador.nombre}</div>
                    <Badge variant="outline" className="mt-1 text-xs">
                      {trabajador.puesto}
                    </Badge>
                  </div>
                ))}
              </div>

              {/* Grid de horas y turnos */}
              <div className="flex relative">
                {/* Columna de horas */}
                <div className="w-20 flex-shrink-0 border-r">
                  {HORAS_DIA.map((hora) => (
                    <div
                      key={hora}
                      className="text-xs text-muted-foreground p-2 border-b"
                      style={{ height: `${PIXELS_POR_HORA}px` }}
                    >
                      {hora.toString().padStart(2, '0')}:00
                    </div>
                  ))}
                </div>

                {/* Columnas de trabajadores con turnos */}
                {trabajadoresDelDia.map((trabajador: any) => {
                  const turnosTrabajador = turnos.filter((t: any) => {
                    if (t.trabajador_id !== trabajador.id) return false;
                    
                    // Aplicar filtro de puesto
                    if (filtroPuesto !== "todos") {
                      if (filtroPuesto === "cocina" && t.puesto !== "cocinero" && t.puesto !== "ayudante_cocina") return false;
                      if (filtroPuesto === "camareros" && t.puesto !== "camarero" && t.puesto !== "ayudante_camarero") return false;
                      if (filtroPuesto === "limpieza" && t.puesto !== "limpieza") return false;
                    }
                    
                    return true;
                  });

                  return (
                    <div 
                      key={trabajador.id}
                      className="flex-1 min-w-[200px] border-r relative"
                      style={{ height: `${HORAS_DIA.length * PIXELS_POR_HORA}px` }}
                    >
                      {/* Líneas de hora */}
                      {HORAS_DIA.map((hora) => (
                        <div
                          key={hora}
                          className="border-b absolute w-full"
                          style={{ top: `${(hora - 7) * PIXELS_POR_HORA}px`, height: `${PIXELS_POR_HORA}px` }}
                        />
                      ))}

                      {/* Turnos del trabajador */}
                      {turnosTrabajador.map((turno: any) => {
                        const { top, height } = calcularPosicionYAltura(
                          turno.hora_inicio,
                          turno.hora_fin
                        );
                        const colorClass = getColorForTrabajador(trabajador.id, trabajadoresIds);

                        return (
                          <div
                            key={turno.id}
                            onClick={() => handleTurnoClick(turno)}
                            className={cn(
                              "absolute left-1 right-1 rounded-md border-2 p-2 overflow-hidden cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all",
                              colorClass
                            )}
                            style={{ top: `${top}px`, height: `${height}px` }}
                          >
                            <div className="text-xs font-semibold">
                              {turno.hora_inicio} - {turno.hora_fin}
                            </div>
                            <Badge 
                              variant={ESTADOS_COLORS[turno.estado] as any}
                              className="mt-1 text-xs"
                            >
                              {turno.estado}
                            </Badge>
                            {turno.salas_asignadas && turno.salas_asignadas.length > 0 && (
                              <div className="text-xs font-medium text-foreground mt-1 truncate">
                                📍 {turno.salas_asignadas.join(", ")}
                              </div>
                            )}
                            {turno.notas && height > 60 && (
                              <div className="text-xs font-semibold text-foreground mt-2 line-clamp-2 bg-background/50 p-1 rounded">
                                💬 {turno.notas}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>

    <DialogTurno
      open={dialogTurnoAbierto}
      onOpenChange={(open) => {
        if (!open) handleCloseTurnoDialog();
        setDialogTurnoAbierto(open);
      }}
      turnoId={turnoSeleccionado?.id || null}
      turnoData={turnoSeleccionado}
    />
    </>
  );
};
