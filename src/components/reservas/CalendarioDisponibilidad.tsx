import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { format, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { useDisponibilidadRango, useDisponibilidadDetalladaPorFecha } from "@/hooks/useDisponibilidad";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Users, TrendingUp, TrendingDown, Minus, MapPin } from "lucide-react";

interface CalendarioDisponibilidadProps {
  onSelectFecha?: (fecha: Date) => void;
  salaId?: string;
}

export const CalendarioDisponibilidad = ({ 
  onSelectFecha,
  salaId 
}: CalendarioDisponibilidadProps) => {
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [month, setMonth] = useState<Date>(new Date());

  const fechaInicio = format(month, "yyyy-MM-01");
  const fechaFin = format(addDays(month, 60), "yyyy-MM-dd");

  const { data: disponibilidad, isLoading } = useDisponibilidadRango(
    fechaInicio,
    fechaFin
  );

  const { data: detalleHorario, isLoading: loadingDetalle } = useDisponibilidadDetalladaPorFecha(
    selectedDate ? format(selectedDate, "yyyy-MM-dd") : ""
  );

  const handleSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    if (date && onSelectFecha) {
      onSelectFecha(date);
    }
  };

  // Calcular ocupación promedio por fecha
  const getOcupacionPorFecha = (date: Date) => {
    const fechaStr = format(date, "yyyy-MM-dd");
    const ocupacionDia = disponibilidad?.filter(
      (d: any) => d.fecha === fechaStr && (!salaId || d.sala_id === salaId)
    );

    if (!ocupacionDia || ocupacionDia.length === 0) return null;

    const totalReservas = ocupacionDia.reduce((sum: number, d: any) => sum + (d.total_reservas || 0), 0);
    const promedioOcupacion = ocupacionDia.reduce(
      (sum: number, d: any) => sum + (d.porcentaje_ocupacion || 0),
      0
    ) / ocupacionDia.length;

    return {
      reservas: totalReservas,
      ocupacion: promedioOcupacion,
    };
  };

  const getDayClassName = (date: Date) => {
    const ocupacion = getOcupacionPorFecha(date);
    if (!ocupacion) return "";

    if (ocupacion.ocupacion >= 90) return "bg-gradient-to-br from-red-500/20 to-red-600/30 dark:from-red-500/30 dark:to-red-600/40 border-red-400/50 text-red-900 dark:text-red-100 font-bold hover:scale-105 transition-all duration-200";
    if (ocupacion.ocupacion >= 70) return "bg-gradient-to-br from-orange-500/20 to-orange-600/30 dark:from-orange-500/30 dark:to-orange-600/40 border-orange-400/50 text-orange-900 dark:text-orange-100 font-semibold hover:scale-105 transition-all duration-200";
    if (ocupacion.ocupacion >= 50) return "bg-gradient-to-br from-yellow-500/20 to-yellow-600/30 dark:from-yellow-500/30 dark:to-yellow-600/40 border-yellow-400/50 text-yellow-900 dark:text-yellow-100 hover:scale-105 transition-all duration-200";
    return "bg-gradient-to-br from-green-500/20 to-green-600/30 dark:from-green-500/30 dark:to-green-600/40 border-green-400/50 text-green-900 dark:text-green-100 hover:scale-105 transition-all duration-200";
  };

  const getOcupacionIcon = (porcentaje: number) => {
    if (porcentaje >= 90) return <TrendingUp className="h-4 w-4" />;
    if (porcentaje >= 50) return <Minus className="h-4 w-4" />;
    return <TrendingDown className="h-4 w-4" />;
  };

  const getColorBadgeOcupacion = (porcentaje: number) => {
    if (porcentaje >= 90) return "bg-gradient-to-r from-red-500 to-red-600 text-white border-red-400/50 shadow-lg shadow-red-500/20";
    if (porcentaje >= 70) return "bg-gradient-to-r from-orange-500 to-orange-600 text-white border-orange-400/50 shadow-lg shadow-orange-500/20";
    if (porcentaje >= 50) return "bg-gradient-to-r from-yellow-500 to-yellow-600 text-white border-yellow-400/50 shadow-lg shadow-yellow-500/20";
    return "bg-gradient-to-r from-green-500 to-green-600 text-white border-green-400/50 shadow-lg shadow-green-500/20";
  };

  if (isLoading) {
    return (
      <Card className="border-2 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10 border-b">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Disponibilidad
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <Skeleton className="h-[400px] w-full rounded-xl" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Calendario Principal */}
      <Card className="border-2 shadow-xl hover:shadow-2xl transition-shadow duration-300">
        <CardHeader className="bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border-b">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Calendario de Disponibilidad
          </CardTitle>
          
          {/* Leyenda Mejorada */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            <Badge variant="outline" className="bg-gradient-to-br from-green-500/10 to-green-600/20 border-green-400/50 justify-center py-2 hover:scale-105 transition-transform">
              <TrendingDown className="mr-1 h-3 w-3" />
              Baja (&lt;50%)
            </Badge>
            <Badge variant="outline" className="bg-gradient-to-br from-yellow-500/10 to-yellow-600/20 border-yellow-400/50 justify-center py-2 hover:scale-105 transition-transform">
              <Minus className="mr-1 h-3 w-3" />
              Media (50-70%)
            </Badge>
            <Badge variant="outline" className="bg-gradient-to-br from-orange-500/10 to-orange-600/20 border-orange-400/50 justify-center py-2 hover:scale-105 transition-transform">
              <TrendingUp className="mr-1 h-3 w-3" />
              Alta (70-90%)
            </Badge>
            <Badge variant="outline" className="bg-gradient-to-br from-red-500/10 to-red-600/20 border-red-400/50 justify-center py-2 hover:scale-105 transition-transform">
              <TrendingUp className="mr-1 h-3 w-3" />
              Completa (≥90%)
            </Badge>
          </div>
        </CardHeader>
        
        <CardContent className="pt-6 pb-6">
          <div className="flex justify-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleSelect}
              onMonthChange={setMonth}
              locale={es}
              className={cn("rounded-xl border-2 shadow-inner bg-gradient-to-b from-background to-muted/20 p-4 pointer-events-auto")}
              modifiers={{
                occupied: (date) => {
                  const ocupacion = getOcupacionPorFecha(date);
                  return ocupacion !== null;
                },
              }}
              modifiersClassNames={{
                occupied: "border-2 rounded-lg",
              }}
              components={{
                Day: ({ date, ...props }) => {
                  const ocupacion = getOcupacionPorFecha(date);
                  const dayClass = getDayClassName(date);
                  
                  return (
                    <button
                      {...props}
                      className={cn(
                        "relative h-12 w-12 p-0 font-normal aria-selected:opacity-100 rounded-lg border-2 border-transparent",
                        dayClass,
                        selectedDate && format(date, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd")
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-110"
                          : ""
                      )}
                    >
                      <time dateTime={format(date, "yyyy-MM-dd")} className="relative z-10">
                        {format(date, "d")}
                      </time>
                      {ocupacion && (
                        <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-current opacity-50" />
                      )}
                    </button>
                  );
                },
              }}
            />
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
                  {detalleHorario.map((horario: any, idx: number) => (
                    <Card
                      key={idx}
                      className={cn(
                        "border-2 overflow-hidden hover:scale-[1.02] transition-all duration-200",
                        getColorBadgeOcupacion(horario.porcentaje_ocupacion_global || 0)
                      )}
                    >
                      <CardContent className="p-4 bg-gradient-to-br from-card/95 to-card">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                          {/* Información de Hora */}
                          <div className="flex items-center gap-3 flex-1">
                            <div className="p-3 rounded-xl bg-background/50 backdrop-blur-sm">
                              <Clock className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                              <div className="font-bold text-lg">{horario.hora}</div>
                              <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                                <Users className="h-3 w-3" />
                                {horario.total_reservas || 0} reservas
                              </div>
                            </div>
                          </div>

                          {/* Estadísticas */}
                          <div className="flex flex-wrap gap-3 items-center">
                            <Badge 
                              variant="outline" 
                              className={cn(
                                "px-4 py-2 font-bold text-sm border-2",
                                getColorBadgeOcupacion(horario.porcentaje_ocupacion_global || 0)
                              )}
                            >
                              <div className="flex items-center gap-2">
                                {getOcupacionIcon(horario.porcentaje_ocupacion_global || 0)}
                                {Math.round(horario.porcentaje_ocupacion_global || 0)}%
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
                                horario.porcentaje_ocupacion_global >= 90 ? "bg-gradient-to-r from-red-500 to-red-600" :
                                horario.porcentaje_ocupacion_global >= 70 ? "bg-gradient-to-r from-orange-500 to-orange-600" :
                                horario.porcentaje_ocupacion_global >= 50 ? "bg-gradient-to-r from-yellow-500 to-yellow-600" :
                                "bg-gradient-to-r from-green-500 to-green-600"
                              )}
                              style={{ width: `${Math.min(horario.porcentaje_ocupacion_global || 0, 100)}%` }}
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
                  ))}
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
