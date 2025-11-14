import { useState, useEffect } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Clock, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { obtenerHorasDisponibles, verificarDisponibilidadSala } from "@/hooks/useDisponibilidad";
import { Skeleton } from "@/components/ui/skeleton";

interface SelectorHorasDisponiblesProps {
  fecha: Date;
  salaId: string;
  numeroMesas: number;
  onSeleccionarHora: (hora: string) => void;
  horaSeleccionada?: string;
}

interface HoraDisponibilidad {
  hora: string;
  disponible: boolean;
  mesasDisponibles: number;
  totalMesas: number;
}

export const SelectorHorasDisponibles = ({
  fecha,
  salaId,
  numeroMesas,
  onSeleccionarHora,
  horaSeleccionada,
}: SelectorHorasDisponiblesProps) => {
  const [horasDisponibilidad, setHorasDisponibilidad] = useState<HoraDisponibilidad[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const cargarHorasDisponibilidad = async () => {
      setCargando(true);
      try {
        const fechaStr = format(fecha, "yyyy-MM-dd");
        const todasLasHoras: HoraDisponibilidad[] = [];

        // Generar todas las horas de 8:00 a 23:30
        for (let h = 8; h <= 23; h++) {
          for (let m = 0; m < 60; m += 30) {
            const hora = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
            
            const disponibilidad = await verificarDisponibilidadSala(
              fechaStr,
              hora,
              salaId,
              numeroMesas
            );

            todasLasHoras.push({
              hora,
              disponible: disponibilidad.disponible,
              mesasDisponibles: disponibilidad.mesasDisponibles,
              totalMesas: disponibilidad.totalMesas,
            });
          }
        }

        setHorasDisponibilidad(todasLasHoras);
      } catch (error) {
        console.error("Error cargando disponibilidad:", error);
      } finally {
        setCargando(false);
      }
    };

    if (fecha && salaId) {
      cargarHorasDisponibilidad();
    }
  }, [fecha, salaId, numeroMesas]);

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
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const horasDisponiblesCount = horasDisponibilidad.filter(h => h.disponible).length;

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
          <Badge variant={horasDisponiblesCount > 0 ? "default" : "secondary"}>
            {horasDisponiblesCount} horarios disponibles
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {horasDisponiblesCount === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No hay horarios disponibles para este día</p>
            <p className="text-sm mt-1">Selecciona otro día o reduce el número de mesas</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {horasDisponibilidad.map((hora) => (
              <Button
                key={hora.hora}
                variant={horaSeleccionada === hora.hora ? "default" : "outline"}
                disabled={!hora.disponible}
                onClick={() => onSeleccionarHora(hora.hora)}
                className="h-auto flex flex-col items-center py-3"
              >
                <Clock className="h-4 w-4 mb-1" />
                <span className="font-semibold">{hora.hora}</span>
                {hora.disponible && (
                  <span className="text-xs opacity-70 flex items-center gap-1 mt-1">
                    <Users className="h-3 w-3" />
                    {hora.mesasDisponibles}/{hora.totalMesas}
                  </span>
                )}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
