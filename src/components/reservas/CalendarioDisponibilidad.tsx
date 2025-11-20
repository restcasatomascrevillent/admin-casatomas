import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { format, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, addMonths, subMonths, startOfWeek, endOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { useDisponibilidadRango, useDisponibilidadDetalladaPorFecha } from "@/hooks/useDisponibilidad";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Users, TrendingUp, TrendingDown, Minus, MapPin, ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

interface CalendarioDisponibilidadProps {
  onSelectFecha?: (fecha: Date) => void;
  salaId?: string;
}

export const CalendarioDisponibilidad = ({ 
  onSelectFecha,
  salaId 
}: CalendarioDisponibilidadProps) => {
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { locale: es });
  const calendarEnd = endOfWeek(monthEnd, { locale: es });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const fechaInicio = format(calendarStart, "yyyy-MM-dd");
  const fechaFin = format(addDays(calendarEnd, 7), "yyyy-MM-dd");

  const { data: disponibilidad, isLoading } = useDisponibilidadRango(
    fechaInicio,
    fechaFin
  );

  const { data: detalleHorario, isLoading: loadingDetalle } = useDisponibilidadDetalladaPorFecha(
    selectedDate ? format(selectedDate, "yyyy-MM-dd") : ""
  );

  const handleSelect = (date: Date) => {
    setSelectedDate(date);
    if (onSelectFecha) {
      onSelectFecha(date);
    }
  };

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  // Calcular ocupación por fecha
  const getOcupacionPorFecha = (date: Date) => {
    const fechaStr = format(date, "yyyy-MM-dd");
    const ocupacionDia = disponibilidad?.filter(
      (d: any) => d.fecha === fechaStr && (!salaId || d.sala_id === salaId)
    );

    if (!ocupacionDia || ocupacionDia.length === 0) return null;

    const totalReservas = ocupacionDia.reduce((sum: number, d: any) => sum + (d.total_reservas || 0), 0);
    const totalComensales = ocupacionDia.reduce((sum: number, d: any) => sum + (d.total_comensales || 0), 0);
    const promedioOcupacion = ocupacionDia.reduce(
      (sum: number, d: any) => sum + (d.porcentaje_ocupacion || 0),
      0
    ) / ocupacionDia.length;

    return {
      reservas: totalReservas,
      comensales: totalComensales,
      ocupacion: promedioOcupacion,
    };
  };

  const getOcupacionColor = (ocupacion: number) => {
    if (ocupacion >= 90) return "from-red-500 to-red-600";
    if (ocupacion >= 70) return "from-orange-500 to-orange-600";
    if (ocupacion >= 50) return "from-yellow-500 to-yellow-600";
    return "from-green-500 to-green-600";
  };

  const getOcupacionIcon = (porcentaje: number) => {
    if (porcentaje >= 90) return <TrendingUp className="h-4 w-4" />;
    if (porcentaje >= 50) return <Minus className="h-4 w-4" />;
    return <TrendingDown className="h-4 w-4" />;
  };

  const weekDays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  if (isLoading) {
    return (
      <Card className="border-2 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10 border-b">
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            Calendario de Reservas
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <Skeleton className="h-[800px] w-full rounded-xl" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Calendario Principal */}
      <Card className="border-2 shadow-xl hover:shadow-2xl transition-shadow duration-300">
        <CardHeader className="bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-primary" />
              {format(currentMonth, "MMMM yyyy", { locale: es }).charAt(0).toUpperCase() + format(currentMonth, "MMMM yyyy", { locale: es }).slice(1)}
            </CardTitle>
            
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={prevMonth} className="hover:scale-105 transition-transform">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(new Date())} className="hover:scale-105 transition-transform">
                Hoy
              </Button>
              <Button variant="outline" size="sm" onClick={nextMonth} className="hover:scale-105 transition-transform">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Leyenda */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            <Badge variant="outline" className="bg-gradient-to-br from-green-500/10 to-green-600/20 border-green-400/50 justify-center py-2">
              <TrendingDown className="mr-1 h-3 w-3" />
              Baja (&lt;50%)
            </Badge>
            <Badge variant="outline" className="bg-gradient-to-br from-yellow-500/10 to-yellow-600/20 border-yellow-400/50 justify-center py-2">
              <Minus className="mr-1 h-3 w-3" />
              Media (50-70%)
            </Badge>
            <Badge variant="outline" className="bg-gradient-to-br from-orange-500/10 to-orange-600/20 border-orange-400/50 justify-center py-2">
              <TrendingUp className="mr-1 h-3 w-3" />
              Alta (70-90%)
            </Badge>
            <Badge variant="outline" className="bg-gradient-to-br from-red-500/10 to-red-600/20 border-red-400/50 justify-center py-2">
              <TrendingUp className="mr-1 h-3 w-3" />
              Completa (≥90%)
            </Badge>
          </div>
        </CardHeader>
        
        <CardContent className="p-6">
          {/* Nombres de los días */}
          <div className="grid grid-cols-7 gap-3 mb-3">
            {weekDays.map((day) => (
              <div
                key={day}
                className="text-center text-sm font-semibold text-muted-foreground py-2"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Grid de días */}
          <div className="grid grid-cols-7 gap-3">
            {calendarDays.map((day, idx) => {
              const ocupacion = getOcupacionPorFecha(day);
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isSelected = selectedDate && format(day, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd");
              const isCurrentDay = isToday(day);
              const isPast = day < new Date(new Date().setHours(0, 0, 0, 0));

              return (
                <button
                  key={idx}
                  onClick={() => handleSelect(day)}
                  disabled={!isCurrentMonth || isPast}
                  className={cn(
                    "relative min-h-[140px] p-3 rounded-xl border-2 transition-all duration-200",
                    "flex flex-col gap-2 hover:scale-105 hover:shadow-lg disabled:hover:scale-100 disabled:hover:shadow-none",
                    isSelected && "ring-2 ring-primary ring-offset-2 scale-105 shadow-xl",
                    !isCurrentMonth && "opacity-40",
                    isPast && !isCurrentDay && "opacity-50 cursor-not-allowed",
                    isCurrentDay && "ring-2 ring-primary/50",
                    ocupacion && isCurrentMonth && !isPast
                      ? `bg-gradient-to-br ${getOcupacionColor(ocupacion.ocupacion)} bg-opacity-10 border-opacity-50`
                      : "bg-card border-border hover:bg-muted/50"
                  )}
                >
                  {/* Fecha */}
                  <div className="flex items-center justify-between">
                    <span className={cn(
                      "text-lg font-bold",
                      isCurrentDay && "bg-primary text-primary-foreground rounded-full w-8 h-8 flex items-center justify-center"
                    )}>
                      {format(day, "d")}
                    </span>
                    
                    {ocupacion && isCurrentMonth && !isPast && (
                      <div className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold text-white",
                        `bg-gradient-to-r ${getOcupacionColor(ocupacion.ocupacion)}`
                      )}>
                        {getOcupacionIcon(ocupacion.ocupacion)}
                        {Math.round(ocupacion.ocupacion)}%
                      </div>
                    )}
                  </div>

                  {/* Estadísticas del día */}
                  {ocupacion && isCurrentMonth && !isPast ? (
                    <div className="space-y-2 flex-1 flex flex-col justify-center">
                      {/* Reservas */}
                      <div className="flex items-center gap-2 text-xs bg-background/50 backdrop-blur-sm rounded-lg px-2 py-1.5 border">
                        <Clock className="h-3 w-3 text-primary flex-shrink-0" />
                        <span className="font-semibold">{ocupacion.reservas}</span>
                        <span className="text-muted-foreground truncate">reservas</span>
                      </div>

                      {/* Comensales */}
                      <div className="flex items-center gap-2 text-xs bg-background/50 backdrop-blur-sm rounded-lg px-2 py-1.5 border">
                        <Users className="h-3 w-3 text-primary flex-shrink-0" />
                        <span className="font-semibold">{ocupacion.comensales}</span>
                        <span className="text-muted-foreground truncate">personas</span>
                      </div>

                      {/* Indicador visual de ocupación */}
                      <div className="mt-1">
                        <div className="w-full bg-muted/50 rounded-full h-2 overflow-hidden border">
                          <div
                            className={cn(
                              "h-full transition-all duration-500 rounded-full",
                              `bg-gradient-to-r ${getOcupacionColor(ocupacion.ocupacion)}`
                            )}
                            style={{ width: `${Math.min(ocupacion.ocupacion, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      {isCurrentMonth && !isPast && (
                        <span className="text-xs text-muted-foreground">Sin reservas</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Detalle por Hora */}
      {selectedDate && (
        <Card className="border-2 shadow-xl hover:shadow-2xl transition-shadow duration-300 animate-scale-in">
          <CardHeader className="bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border-b">
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Detalle del {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {loadingDetalle ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-xl" />
                ))}
              </div>
            ) : detalleHorario && detalleHorario.length > 0 ? (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-3">
                  {detalleHorario.map((horario: any, idx: number) => {
                    const porcentaje = horario.porcentaje_ocupacion_global || 0;
                    return (
                      <Card
                        key={idx}
                        className="border-2 overflow-hidden hover:scale-[1.02] transition-all duration-200"
                      >
                        <CardContent className="p-4 bg-gradient-to-br from-card/95 to-card">
                          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            {/* Información de Hora */}
                            <div className="flex items-center gap-3 flex-1">
                              <div className="p-3 rounded-xl bg-background/50 backdrop-blur-sm border">
                                <Clock className="h-6 w-6 text-primary" />
                              </div>
                              <div>
                                <div className="font-bold text-lg">{horario.hora}</div>
                                <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                                  <Clock className="h-3 w-3" />
                                  {horario.total_reservas || 0} reservas
                                </div>
                              </div>
                            </div>

                            {/* Estadísticas */}
                            <div className="flex flex-wrap gap-3 items-center">
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "px-4 py-2 font-bold text-sm border-2 text-white",
                                  `bg-gradient-to-r ${getOcupacionColor(porcentaje)}`
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  {getOcupacionIcon(porcentaje)}
                                  {Math.round(porcentaje)}%
                                </div>
                              </Badge>
                              
                              <div className="text-right bg-background/50 backdrop-blur-sm rounded-lg px-3 py-2 border">
                                <div className="text-xs text-muted-foreground">Comensales</div>
                                <div className="font-bold text-lg flex items-center gap-1">
                                  <Users className="h-4 w-4" />
                                  {horario.total_comensales || 0}
                                </div>
                              </div>

                              <div className="text-right bg-background/50 backdrop-blur-sm rounded-lg px-3 py-2 border">
                                <div className="text-xs text-muted-foreground">Disponible</div>
                                <div className="font-bold text-lg text-green-600 dark:text-green-400">
                                  {horario.capacidad_disponible || 0}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Barra de Progreso */}
                          <div className="mt-4">
                            <div className="w-full bg-muted/50 rounded-full h-3 overflow-hidden border">
                              <div
                                className={cn(
                                  "h-full transition-all duration-500 rounded-full",
                                  `bg-gradient-to-r ${getOcupacionColor(porcentaje)}`
                                )}
                                style={{ width: `${Math.min(porcentaje, 100)}%` }}
                              />
                            </div>
                          </div>

                          {/* Espacios Individuales */}
                          {horario.salas && horario.salas.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-border/50">
                              <div className="text-xs font-semibold text-muted-foreground mb-2">Espacios</div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {horario.salas.map((sala: any, salaIdx: number) => (
                                  <div
                                    key={salaIdx}
                                    className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border hover:bg-muted/50 transition-colors"
                                  >
                                    <div className="flex items-center gap-2">
                                      <MapPin className="h-4 w-4 text-muted-foreground" />
                                      <span className="text-sm font-medium truncate">{sala.sala_nombre}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Users className="h-3 w-3" />
                                        {sala.comensales_actuales}/{sala.capacidad_maxima}
                                      </div>
                                      <Badge variant="secondary" className="ml-2 shrink-0 text-xs">
                                        {Math.round(sala.porcentaje_ocupacion_sala || 0)}%
                                      </Badge>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-center py-12">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                  <Clock className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground">No hay datos de ocupación para esta fecha</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};