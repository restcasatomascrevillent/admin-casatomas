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
        <CardTitle>Selecciona una Sala</CardTitle>
        <CardDescription>Elige el espacio que prefieres para tu reserva</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Barra Lateral de Salas */}
          <div className="w-full lg:w-64 flex-shrink-0">
            <div className="space-y-2">
              {salas?.map((sala: any) => (
                <button
                  key={sala.id}
                  onClick={() => setSalaSeleccionada(sala.id)}
                  className={cn(
                    "w-full text-left p-4 rounded-lg border-2 transition-all duration-200",
                    "hover:border-primary/50 hover:shadow-md",
                    salaSeleccionada === sala.id
                      ? "border-primary bg-primary/10 shadow-md"
                      : "border-border bg-card"
                  )}
                >
                  <div className="flex flex-col gap-1">
                    <span className={cn(
                      "font-semibold text-base",
                      salaSeleccionada === sala.id ? "text-primary" : "text-foreground"
                    )}>
                      {sala.nombre}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {sala.numero_mesas} mesas · Cap. {sala.capacidad_maxima}
                    </span>
                    {sala.descripcion && (
                      <span className="text-xs text-muted-foreground mt-1">
                        {sala.descripcion}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Contenido Principal - Calendario y Horarios */}
          <div className="flex-1 space-y-6">
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
        </div>
      </CardContent>
    </Card>
  );
};
