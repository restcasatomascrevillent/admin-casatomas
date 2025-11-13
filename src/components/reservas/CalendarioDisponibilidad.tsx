import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { useDisponibilidadRango } from "@/hooks/useDisponibilidad";
import { Skeleton } from "@/components/ui/skeleton";

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

  const handleSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    if (date && onSelectFecha) {
      onSelectFecha(date);
    }
  };

  // Calcular ocupación por fecha
  const getOcupacionPorFecha = (date: Date) => {
    const fechaStr = format(date, "yyyy-MM-dd");
    const ocupacionDia = disponibilidad?.filter(
      (d) => d.fecha === fechaStr && (!salaId || d.sala_id === salaId)
    );

    if (!ocupacionDia || ocupacionDia.length === 0) return null;

    const totalReservas = ocupacionDia.reduce((sum, d) => sum + d.total_reservas, 0);
    const promedioOcupacion = ocupacionDia.reduce(
      (sum, d) => sum + d.porcentaje_ocupacion,
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

    if (ocupacion.ocupacion >= 90) return "bg-destructive/20 text-destructive font-bold";
    if (ocupacion.ocupacion >= 70) return "bg-orange-100 dark:bg-orange-900/20 font-semibold";
    if (ocupacion.ocupacion >= 50) return "bg-yellow-100 dark:bg-yellow-900/20";
    return "bg-green-100 dark:bg-green-900/20";
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
    <Card>
      <CardHeader>
        <CardTitle>Calendario de Disponibilidad</CardTitle>
        <div className="flex gap-2 flex-wrap mt-4">
          <Badge variant="outline" className="bg-green-100 dark:bg-green-900/20">
            Baja ocupación (&lt;50%)
          </Badge>
          <Badge variant="outline" className="bg-yellow-100 dark:bg-yellow-900/20">
            Media (50-70%)
          </Badge>
          <Badge variant="outline" className="bg-orange-100 dark:bg-orange-900/20">
            Alta (70-90%)
          </Badge>
          <Badge variant="outline" className="bg-destructive/20 text-destructive">
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
          disabled={(date) => date < new Date()}
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
                <div className={cn("relative", dayClassName)} {...props}>
                  <span>{format(date, "d")}</span>
                </div>
              );
            },
          }}
        />

        {selectedDate && (
          <div className="mt-4 p-4 border rounded-lg">
            <h4 className="font-semibold mb-2">
              {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
            </h4>
            {(() => {
              const ocupacion = getOcupacionPorFecha(selectedDate);
              if (!ocupacion) {
                return (
                  <p className="text-sm text-muted-foreground">
                    Sin reservas para este día
                  </p>
                );
              }
              return (
                <div className="space-y-1 text-sm">
                  <p>Total de reservas: {ocupacion.reservas}</p>
                  <p>Ocupación promedio: {ocupacion.ocupacion.toFixed(0)}%</p>
                </div>
              );
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
