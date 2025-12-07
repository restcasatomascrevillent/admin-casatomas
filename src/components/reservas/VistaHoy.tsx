import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import { Users, CalendarCheck, TrendingUp, MapPin } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface VistaHoyProps {
  onEspacioClick: (espacioId: string) => void;
}

export function VistaHoy({ onEspacioClick }: VistaHoyProps) {
  const { data: resumen, isLoading } = useResumenOcupacionHoy();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-16 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const today = new Date();

  return (
    <div className="space-y-6">
      {/* Header con fecha */}
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-xl bg-primary/10">
          <CalendarCheck className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h3 className="text-2xl font-bold">
            {format(today, "EEEE, d 'de' MMMM", { locale: es })}
          </h3>
          <p className="text-muted-foreground">Resumen de ocupación del día</p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-l-4 border-l-primary">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Reservas Hoy
                </p>
                <p className="text-3xl font-bold">{resumen?.totalReservas || 0}</p>
              </div>
              <div className="p-3 rounded-full bg-primary/10">
                <CalendarCheck className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-accent">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Comensales Esperados
                </p>
                <p className="text-3xl font-bold">{resumen?.totalComensales || 0}</p>
              </div>
              <div className="p-3 rounded-full bg-accent/10">
                <Users className="h-5 w-5 text-accent" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-secondary">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Capacidad Total
                </p>
                <p className="text-3xl font-bold">{resumen?.capacidadTotal || 0}</p>
              </div>
              <div className="p-3 rounded-full bg-secondary/10">
                <MapPin className="h-5 w-5 text-secondary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Ocupación Media
                </p>
                <p className="text-3xl font-bold">{resumen?.porcentajeTotal || 0}%</p>
              </div>
              <div className="p-3 rounded-full bg-green-500/10">
                <TrendingUp className="h-5 w-5 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lista de espacios */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Espacios del Restaurante
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!resumen?.espacios?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <MapPin className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No hay espacios configurados</p>
              <p className="text-sm">Crea espacios desde la sección de Espacios</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {resumen.espacios.map((espacio) => (
                <Card
                  key={espacio.espacio_id}
                  className={cn(
                    "cursor-pointer transition-all hover:shadow-md hover:border-primary/50",
                    "border-2 hover:scale-[1.02]"
                  )}
                  onClick={() => onEspacioClick(espacio.espacio_id)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <h4 className="font-semibold text-lg">{espacio.espacio_nombre}</h4>
                      <Badge
                        variant={
                          espacio.porcentaje_ocupacion > 80
                            ? "destructive"
                            : espacio.porcentaje_ocupacion > 50
                            ? "default"
                            : "secondary"
                        }
                      >
                        {espacio.porcentaje_ocupacion}%
                      </Badge>
                    </div>

                    {/* Progress bar */}
                    <div className="mb-4">
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full transition-all",
                            espacio.porcentaje_ocupacion > 80
                              ? "bg-destructive"
                              : espacio.porcentaje_ocupacion > 50
                              ? "bg-primary"
                              : "bg-green-500"
                          )}
                          style={{ width: `${Math.min(espacio.porcentaje_ocupacion, 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Reservas</p>
                        <p className="font-semibold text-lg">{espacio.total_reservas}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Comensales</p>
                        <p className="font-semibold text-lg">
                          {espacio.total_comensales}/{espacio.capacidad_maxima}
                        </p>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground mt-3 text-center">
                      Click para ver plano y mesas
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
