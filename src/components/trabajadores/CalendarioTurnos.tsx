import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTurnosCompleta } from "@/hooks/useTrabajadores";
import { Clock, MapPin } from "lucide-react";

export const CalendarioTurnos = () => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const fechaSeleccionada = format(selectedDate, "yyyy-MM-dd");
  const { data: turnos, isLoading } = useTurnosCompleta(fechaSeleccionada);

  const ESTADOS_COLORS: Record<string, string> = {
    programado: "default",
    activo: "secondary",
    completado: "outline",
    cancelado: "destructive",
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Seleccionar Fecha</CardTitle>
        </CardHeader>
        <CardContent>
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => date && setSelectedDate(date)}
            locale={es}
            className="rounded-md border"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Turnos del {format(selectedDate, "d 'de' MMMM", { locale: es })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Cargando turnos...</p>
          ) : !turnos || turnos.length === 0 ? (
            <p className="text-muted-foreground">No hay turnos programados para esta fecha</p>
          ) : (
            <div className="space-y-4">
              {turnos.map((turno: any) => (
                <div
                  key={turno.id}
                  className="border rounded-lg p-4 space-y-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      {turno.trabajador_nombre}
                    </div>
                    <Badge variant={ESTADOS_COLORS[turno.estado] as any}>
                      {turno.estado}
                    </Badge>
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {turno.hora_inicio} - {turno.hora_fin}
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">{turno.puesto}</Badge>
                  </div>

                  {turno.salas_asignadas && turno.salas_asignadas.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      {turno.salas_asignadas.join(", ")}
                    </div>
                  )}

                  {turno.notas && (
                    <p className="text-sm text-muted-foreground italic">
                      {turno.notas}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
