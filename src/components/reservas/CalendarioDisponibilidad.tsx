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
import { Clock, Users, UtensilsCrossed } from "lucide-react";

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

    if (ocupacion.ocupacion >= 90) return "bg-red-100 dark:bg-red-900/30 text-red-900 dark:text-red-100 font-bold";
    if (ocupacion.ocupacion >= 70) return "bg-orange-100 dark:bg-orange-900/30 text-orange-900 dark:text-orange-100 font-semibold";
    if (ocupacion.ocupacion >= 50) return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-900 dark:text-yellow-100";
    return "bg-green-100 dark:bg-green-900/30 text-green-900 dark:text-green-100";
  };

  const getColorBadgeOcupacion = (porcentaje: number) => {
    if (porcentaje >= 90) return "bg-red-500 text-white";
    if (porcentaje >= 70) return "bg-orange-500 text-white";
    if (porcentaje >= 50) return "bg-yellow-500 text-black";
    return "bg-green-500 text-white";
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Disponibilidad</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[350px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Calendario de Disponibilidad</CardTitle>
          <div className="flex gap-2 flex-wrap mt-4">
            <Badge variant="outline" className="bg-green-100 dark:bg-green-900/30">
              Baja ocupación (&lt;50%)
            </Badge>
            <Badge variant="outline" className="bg-yellow-100 dark:bg-yellow-900/30">
              Media (50-70%)
            </Badge>
            <Badge variant="outline" className="bg-orange-100 dark:bg-orange-900/30">
              Alta (70-90%)
            </Badge>
            <Badge variant="outline" className="bg-red-100 dark:bg-red-900/30">
              Completa (&gt;90%)
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            onMonthChange={setMonth}
            locale={es}
            disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
            className={cn("rounded-md border pointer-events-auto")}
            modifiers={{
              ocupado: (date) => {
                const ocupacion = getOcupacionPorFecha(date);
                return !!ocupacion && ocupacion.ocupacion >= 90;
              },
            }}
            modifiersClassNames={{
              ocupado: "opacity-50",
            }}
            components={{
              Day: ({ date, ...props }) => {
                const dayClassName = getDayClassName(date);
                return (
                  <div className={cn("relative rounded-md", dayClassName)} {...props}>
                    <span>{format(date, "d")}</span>
                  </div>
                );
              },
            }}
          />
        </CardContent>
      </Card>

      {selectedDate && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingDetalle ? (
              <Skeleton className="h-[400px] w-full" />
            ) : !detalleHorario || detalleHorario.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Sin reservas para este día. ¡Totalmente disponible!
              </p>
            ) : (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-3">
                  {detalleHorario.map((horario) => (
                    <div
                      key={horario.hora}
                      className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">{horario.hora}</span>
                        </div>
                        <Badge className={getColorBadgeOcupacion(horario.porcentaje_ocupacion_global)}>
                          {horario.porcentaje_ocupacion_global.toFixed(0)}% ocupado
                        </Badge>
                      </div>

                      <div className="space-y-2">
                        {horario.salas.map((sala) => (
                          <div
                            key={sala.sala_id}
                            className="flex items-center justify-between text-sm p-2 bg-background rounded border"
                          >
                            <div className="flex items-center gap-2">
                              <UtensilsCrossed className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{sala.sala_nombre}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Users className="h-3 w-3" />
                                <span className="text-xs">
                                  {sala.comensales_actuales}/{sala.capacidad_maxima}
                                </span>
                              </div>
                              <Badge
                                variant="outline"
                                className={cn(
                                  sala.mesas_disponibles === 0
                                    ? "bg-red-100 dark:bg-red-900/30 text-red-900 dark:text-red-100"
                                    : sala.mesas_disponibles <= 2
                                    ? "bg-orange-100 dark:bg-orange-900/30 text-orange-900 dark:text-orange-100"
                                    : "bg-green-100 dark:bg-green-900/30 text-green-900 dark:text-green-100"
                                )}
                              >
                                {sala.mesas_disponibles > 0
                                  ? `${sala.mesas_disponibles} ${
                                      sala.mesas_disponibles === 1 ? "mesa libre" : "mesas libres"
                                    }`
                                  : "Sin mesas"}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>

                      {horario.total_mesas_disponibles > 0 && (
                        <div className="mt-2 text-xs text-muted-foreground text-right">
                          Total: {horario.total_mesas_disponibles} mesas disponibles
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
