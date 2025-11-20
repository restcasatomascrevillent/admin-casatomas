import { useState, useRef } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTurnosCompleta, useTrabajadoresActivos } from "@/hooks/useTrabajadores";
import { CalendarIcon, ChevronLeft, ChevronRight, ArrowLeft, ArrowRight } from "lucide-react";
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
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

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -300, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 300, behavior: 'smooth' });
    }
  };

  return (
    <>
      <Card className="border-none shadow-lg">
        <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10 border-b">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <CardTitle className="text-2xl">Vista Diaria</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Filtros por puesto */}
              <div className="flex gap-1 bg-muted/50 p-1 rounded-lg">
                <Button
                  variant={filtroPuesto === "todos" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setFiltroPuesto("todos")}
                  className="transition-all"
                >
                  Todos
                </Button>
                <Button
                  variant={filtroPuesto === "cocina" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setFiltroPuesto("cocina")}
                  className="transition-all"
                >
                  Cocina
                </Button>
                <Button
                  variant={filtroPuesto === "camareros" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setFiltroPuesto("camareros")}
                  className="transition-all"
                >
                  Camareros
                </Button>
                <Button
                  variant={filtroPuesto === "limpieza" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setFiltroPuesto("limpieza")}
                  className="transition-all"
                >
                  Limpieza
                </Button>
              </div>

              {/* Navegación de fechas */}
              <div className="flex gap-1 bg-muted/50 p-1 rounded-lg">
                <Button variant="ghost" size="sm" onClick={handleToday}>
                  Hoy
                </Button>
                <Button variant="ghost" size="icon" onClick={handlePrevDay}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "justify-start text-left font-normal min-w-[240px] bg-card hover:bg-muted",
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
                <div className="p-3 border-t bg-muted/50">
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
            <Button variant="ghost" size="icon" onClick={handleNextDay}>
              <ChevronRight className="h-4 w-4" />
            </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : !turnos || turnos.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="rounded-full bg-muted p-3 mb-4">
                <CalendarIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-lg font-medium text-muted-foreground">No hay turnos programados</p>
              <p className="text-sm text-muted-foreground">para esta fecha</p>
            </div>
          ) : (
            <div className="relative">
              {/* Botones de scroll */}
              {trabajadoresDelDia.length > 3 && (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full shadow-lg bg-background/95 backdrop-blur-sm hover:bg-background"
                    onClick={scrollLeft}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full shadow-lg bg-background/95 backdrop-blur-sm hover:bg-background"
                    onClick={scrollRight}
                  >
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </>
              )}
              
              {/* Gradientes de indicación de scroll */}
              <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
              <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
              
              <div 
                ref={scrollContainerRef}
                className="overflow-x-auto bg-muted/30 scrollbar-thin scrollbar-thumb-primary/50 scrollbar-track-muted/30 hover:scrollbar-thumb-primary/70"
              >
              <div className="min-w-max">
                {/* Header con nombres de trabajadores */}
                <div className="flex border-b sticky top-0 bg-card z-10 shadow-sm">
                  <div className="w-20 flex-shrink-0 border-r p-3 font-semibold text-sm bg-muted/50">
                    Hora
                  </div>
                  {trabajadoresDelDia.map((trabajador: any) => (
                    <div 
                      key={trabajador.id}
                      className="flex-1 min-w-[140px] border-r p-2 text-center bg-gradient-to-b from-card to-muted/20"
                    >
                      <div className="font-semibold text-xs mb-1">{trabajador.nombre}</div>
                      <Badge variant="secondary" className="text-[10px] font-normal px-1 py-0">
                        {trabajador.puesto.replace('_', ' ')}
                      </Badge>
                    </div>
                  ))}
                </div>

                {/* Grid de horas y turnos */}
                <div className="flex relative">
                  {/* Columna de horas */}
                  <div className="w-20 flex-shrink-0 border-r bg-muted/30">
                    {HORAS_DIA.map((hora) => (
                      <div
                        key={hora}
                        className="text-xs font-medium text-muted-foreground p-2 border-b flex items-center justify-center"
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
                        className="flex-1 min-w-[140px] border-r relative bg-card/50"
                        style={{ height: `${HORAS_DIA.length * PIXELS_POR_HORA}px` }}
                      >
                        {/* Líneas de hora */}
                        {HORAS_DIA.map((hora) => (
                          <div
                            key={hora}
                            className="border-b absolute w-full bg-muted/10 hover:bg-muted/20 transition-colors"
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
                                "absolute left-1 right-1 rounded-lg border-2 p-1.5 overflow-hidden cursor-pointer transition-all duration-200",
                                "hover:shadow-xl hover:scale-[1.02] hover:z-10",
                                "backdrop-blur-sm",
                                colorClass
                              )}
                              style={{ top: `${top}px`, height: `${height}px` }}
                            >
                              <div className="flex flex-col h-full text-foreground space-y-0.5">
                                <div className="font-semibold text-[11px] truncate">
                                  {turno.trabajador_nombre}
                                </div>
                                
                                <div className="text-[9px] opacity-80 truncate">
                                  {turno.puesto.replace('_', ' ')}
                                </div>
                                
                                <div className="font-bold text-[10px]">
                                  {turno.hora_inicio} - {turno.hora_fin}
                                </div>
                                
                                <div className="flex items-center gap-1">
                                  <Badge 
                                    variant={ESTADOS_COLORS[turno.estado] as any}
                                    className="text-[9px] px-1 py-0 h-auto"
                                  >
                                    {turno.estado}
                                  </Badge>
                                </div>
                                
                                {turno.notas && height > 60 && (
                                  <div className="text-[9px] italic truncate opacity-75 mt-auto">
                                    {turno.notas}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
              </div>
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
