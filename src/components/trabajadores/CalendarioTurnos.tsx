import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTurnosCompleta } from "@/hooks/useTrabajadores";
import { Clock, MapPin, CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const CalendarioTurnos = () => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [open, setOpen] = useState(false);
  const fechaSeleccionada = format(selectedDate, "yyyy-MM-dd");
  
  // Obtener turnos del mes completo para los indicadores
  const { data: turnosMes } = useTurnosCompleta();
  const { data: turnos, isLoading } = useTurnosCompleta(fechaSeleccionada);

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

  // Crear un mapa de días con turnos y sus estados
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
    const uniqueEstados = Array.from(new Set(estados));
    modifiersStyles[fecha] = {
      position: 'relative',
    };
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle>Turnos Diarios</CardTitle>
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
            <style>{`
              [data-con-turnos="true"] {
                position: relative;
                font-weight: 600;
              }
              [data-con-turnos="true"]::after {
                content: '';
                position: absolute;
                bottom: 2px;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                gap: 2px;
              }
            `}</style>
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
              className={cn("rounded-md border pointer-events-auto [&_.rdp-day_button[data-con-turnos=true]]:font-semibold")}
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
  );
};
