import { useState, useEffect } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Clock, Users, TrendingUp, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { generarTurnosDinamicos, TurnoDinamico } from "@/hooks/useDisponibilidad";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";

interface SelectorHorasDisponiblesProps {
  fecha: Date;
  salaId: string;
  onSeleccionarHora: (hora: string) => void;
  horaSeleccionada?: string;
}

export const SelectorHorasDisponibles = ({
  fecha,
  salaId,
  onSeleccionarHora,
  horaSeleccionada,
}: SelectorHorasDisponiblesProps) => {
  const [turnos, setTurnos] = useState<TurnoDinamico[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const cargarTurnosDinamicos = async () => {
      setCargando(true);
      try {
        const fechaStr = format(fecha, "yyyy-MM-dd");
        const diaSemana = fecha.getDay();
        
        const turnosGenerados = await generarTurnosDinamicos(fechaStr, salaId, diaSemana);
        setTurnos(turnosGenerados);
      } catch (error) {
        console.error("Error cargando turnos dinámicos:", error);
      } finally {
        setCargando(false);
      }
    };

    if (fecha && salaId) {
      cargarTurnosDinamicos();
    }
  }, [fecha, salaId]);

  if (cargando) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Horarios Disponibles</CardTitle>
          <CardDescription>
            {format(fecha, "EEEE, d 'de' MMMM", { locale: es })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const turnosDisponibles = turnos.filter(t => t.disponible);
  const turnosSecundarios = turnos.filter(t => t.esTurnoSecundario);

  // Agrupar turnos por periodo (comida/cena basado en la hora)
  const turnosComida = turnos.filter(t => {
    const [hora] = t.hora.split(":").map(Number);
    return hora >= 12 && hora < 18;
  });
  
  const turnosCena = turnos.filter(t => {
    const [hora] = t.hora.split(":").map(Number);
    return hora >= 18 || hora < 4;
  });

  const renderTurno = (turno: TurnoDinamico) => (
    <TooltipProvider key={turno.hora}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={horaSeleccionada === turno.hora ? "default" : "outline"}
            disabled={!turno.disponible}
            onClick={() => onSeleccionarHora(turno.hora)}
            className={`h-auto flex flex-col items-center py-3 relative ${
              turno.esTurnoSecundario 
                ? "border-dashed border-primary/50 bg-primary/5" 
                : ""
            }`}
          >
            {turno.esTurnoSecundario && (
              <Badge 
                variant="secondary" 
                className="absolute -top-2 -right-2 text-[10px] px-1.5 py-0.5 gap-0.5"
              >
                <Sparkles className="h-2.5 w-2.5" />
                +15
              </Badge>
            )}
            <div className="flex items-center gap-1">
              {turno.esTurnoSecundario ? (
                <TrendingUp className="h-4 w-4 text-primary" />
              ) : (
                <Clock className="h-4 w-4" />
              )}
            </div>
            <span className="font-semibold text-lg">{turno.hora}</span>
            {turno.disponible && (
              <>
                <span className="text-xs opacity-70 flex items-center gap-1 mt-1">
                  <Users className="h-3 w-3" />
                  {turno.capacidadDisponible}/{turno.capacidadMaxima}
                </span>
                <Progress 
                  value={turno.porcentajeOcupacion} 
                  className="h-1 w-full mt-1.5"
                />
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {turno.esTurnoSecundario ? (
            <p className="text-sm">
              <span className="font-medium">Turno extra</span>
              <br />
              {turno.motivoApertura}
            </p>
          ) : (
            <p className="text-sm">
              {turno.disponible 
                ? `${turno.capacidadDisponible} plazas disponibles`
                : "Sin disponibilidad"
              }
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Horarios Disponibles</CardTitle>
            <CardDescription>
              {format(fecha, "EEEE, d 'de' MMMM", { locale: es })}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {turnosSecundarios.length > 0 && (
              <Badge variant="outline" className="gap-1">
                <TrendingUp className="h-3 w-3" />
                {turnosSecundarios.length} extra
              </Badge>
            )}
            <Badge variant={turnosDisponibles.length > 0 ? "default" : "secondary"}>
              {turnosDisponibles.length} disponibles
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {turnos.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No hay horarios disponibles para este día</p>
            <p className="text-sm mt-1">Selecciona otro día</p>
          </div>
        ) : (
          <>
            {/* Turnos de Comida */}
            {turnosComida.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  Comida
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {turnosComida.map(renderTurno)}
                </div>
              </div>
            )}

            {/* Turnos de Cena */}
            {turnosCena.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-500" />
                  Cena
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {turnosCena.map(renderTurno)}
                </div>
              </div>
            )}

            {/* Leyenda */}
            {turnosSecundarios.length > 0 && (
              <div className="pt-3 border-t">
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Sparkles className="h-3 w-3" />
                  Los turnos marcados con <Badge variant="secondary" className="text-[10px] px-1 py-0">+15</Badge> se han abierto por alta demanda
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
