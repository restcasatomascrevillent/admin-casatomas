import { useState, useEffect } from "react";
import { format, addDays, startOfMonth, endOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSalasPublicas } from "@/hooks/useSalasPublicas";
import { useDisponibilidadDetalladaPorFecha } from "@/hooks/useDisponibilidad";
import { SelectorHorasDisponibles } from "./SelectorHorasDisponibles";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface CalendarioReservaPublicaProps {
  onSeleccion: (sala_id: string, fecha: Date, hora: string) => void;
}

export const CalendarioReservaPublica = ({ onSeleccion }: CalendarioReservaPublicaProps) => {
  const [salaSeleccionada, setSalaSeleccionada] = useState<string>("");
  const [fechaSeleccionada, setFechaSeleccionada] = useState<Date>();
  const [horaSeleccionada, setHoraSeleccionada] = useState<string>("");
  const [numeroMesas, setNumeroMesas] = useState(1);

  const { data: salas, isLoading: cargandoSalas } = useSalasPublicas() as any;
  
  const fechaParaConsulta = fechaSeleccionada || new Date();
  const { data: disponibilidad } = useDisponibilidadDetalladaPorFecha(
    format(fechaParaConsulta, "yyyy-MM-dd")
  ) as any;

  // Seleccionar primera sala automáticamente
  useEffect(() => {
    if (salas && salas.length > 0 && !salaSeleccionada) {
      setSalaSeleccionada(salas[0].id);
    }
  }, [salas, salaSeleccionada]);

  // Cuando cambia la selección completa, notificar al padre
  useEffect(() => {
    if (salaSeleccionada && fechaSeleccionada && horaSeleccionada) {
      onSeleccion(salaSeleccionada, fechaSeleccionada, horaSeleccionada);
    }
  }, [salaSeleccionada, fechaSeleccionada, horaSeleccionada, onSeleccion]);

  const obtenerDisponibilidadDia = (fecha: Date) => {
    if (!disponibilidad || !salaSeleccionada) return null;
    
    const fechaStr = format(fecha, "yyyy-MM-dd");
    const horariosDia = disponibilidad.filter((d: any) => d.fecha === fechaStr);
    
    if (horariosDia.length === 0) return null;
    
    // Contar horarios disponibles para la sala seleccionada
    let horariosDisponibles = 0;
    horariosDia.forEach((horario: any) => {
      const salaInfo = horario.salas?.find((s: any) => s.sala_id === salaSeleccionada);
      if (salaInfo && salaInfo.mesas_disponibles >= numeroMesas) {
        horariosDisponibles++;
      }
    });
    
    return horariosDisponibles;
  };

  if (cargandoSalas) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48 mt-2" />
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
        <CardTitle className="text-2xl">Reserva tu Mesa</CardTitle>
        <CardDescription>Elige la sala, fecha y hora perfecta para tu experiencia</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Barra Horizontal de Salas */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Espacios Disponibles
          </h3>
          <div className="overflow-x-auto scrollbar-thin pb-2">
            <div className="flex gap-3 min-w-max">
              {salas?.map((sala: any) => (
                <button
                  key={sala.id}
                  onClick={() => setSalaSeleccionada(sala.id)}
                  className={cn(
                    "flex-shrink-0 text-left p-4 rounded-xl transition-all duration-300 min-w-[280px]",
                    "hover:scale-[1.02] hover:shadow-lg",
                    salaSeleccionada === sala.id
                      ? "bg-gradient-to-br from-primary/20 to-primary/5 border-2 border-primary shadow-lg shadow-primary/20"
                      : "bg-card border-2 border-border hover:border-primary/30"
                  )}
                >
                  <div className="flex flex-col gap-2">
                    <span className={cn(
                      "font-bold text-lg",
                      salaSeleccionada === sala.id ? "text-primary" : "text-foreground"
                    )}>
                      {sala.nombre}
                    </span>
                    <div className="flex items-center gap-3 text-sm">
                      <span className={cn(
                        "font-medium",
                        salaSeleccionada === sala.id ? "text-primary/80" : "text-muted-foreground"
                      )}>
                        {sala.numero_mesas} mesas
                      </span>
                      <span className="text-muted-foreground">•</span>
                      <span className={cn(
                        "font-medium",
                        salaSeleccionada === sala.id ? "text-primary/80" : "text-muted-foreground"
                      )}>
                        Cap. {sala.capacidad_maxima}
                      </span>
                    </div>
                    {sala.descripcion && (
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                        {sala.descripcion}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Calendario y Horarios */}
        <div className="space-y-6">
          {/* Calendario */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Selecciona un Día</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Haz clic en un día para ver los horarios disponibles
            </p>
            <Calendar
              mode="single"
              selected={fechaSeleccionada}
              onSelect={(date) => {
                setFechaSeleccionada(date);
                setHoraSeleccionada(""); // Reset hora al cambiar fecha
              }}
              disabled={(date) => date < new Date()}
              locale={es}
              className="rounded-md border pointer-events-auto"
              modifiers={{
                disponible: (date) => {
                  const disponibles = obtenerDisponibilidadDia(date);
                  return disponibles !== null && disponibles > 0;
                },
                completo: (date) => {
                  const disponibles = obtenerDisponibilidadDia(date);
                  return disponibles !== null && disponibles === 0;
                },
              }}
              modifiersClassNames={{
                disponible: "bg-green-100 dark:bg-green-900/30 font-semibold",
                completo: "bg-red-100 dark:bg-red-900/30 text-muted-foreground line-through",
              }}
            />
            
            <div className="flex gap-4 mt-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-green-100 dark:bg-green-900/30" />
                <span>Disponible</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-red-100 dark:bg-red-900/30" />
                <span>Completo</span>
              </div>
            </div>
          </div>

          {/* Horarios Disponibles */}
          {fechaSeleccionada && salaSeleccionada && (
            <SelectorHorasDisponibles
              fecha={fechaSeleccionada}
              salaId={salaSeleccionada}
              numeroMesas={numeroMesas}
              onSeleccionarHora={setHoraSeleccionada}
              horaSeleccionada={horaSeleccionada}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
};
