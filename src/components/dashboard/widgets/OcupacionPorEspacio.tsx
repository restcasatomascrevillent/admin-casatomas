import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, CalendarCheck } from "lucide-react";
import { useOcupacionHoy } from "@/hooks/useOcupacionHoy";
import { Badge } from "@/components/ui/badge";

export function OcupacionPorEspacio() {
  const { data: ocupacion, isLoading } = useOcupacionHoy();

  const getStatusColor = (porcentaje: number) => {
    if (porcentaje < 50) return { bg: "bg-green-500/10", text: "text-green-600", bar: "bg-green-500" };
    if (porcentaje < 80) return { bg: "bg-amber-500/10", text: "text-amber-600", bar: "bg-amber-500" };
    return { bg: "bg-red-500/10", text: "text-red-600", bar: "bg-red-500" };
  };

  const getStatusLabel = (porcentaje: number) => {
    if (porcentaje < 50) return "Disponible";
    if (porcentaje < 80) return "Moderado";
    return "Lleno";
  };

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-semibold">Ocupación por Espacio</CardTitle>
          <Building2 className="h-5 w-5 text-primary" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="animate-pulse space-y-2">
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="h-2 bg-muted rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!ocupacion || ocupacion.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-semibold">Ocupación por Espacio</CardTitle>
          <Building2 className="h-5 w-5 text-primary" />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No hay datos de ocupación
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalReservas = ocupacion.reduce((acc, e) => acc + (e.total_reservas || 0), 0);
  const totalComensales = ocupacion.reduce((acc, e) => acc + (e.total_comensales || 0), 0);
  const capacidadTotal = ocupacion.reduce((acc, e) => acc + (e.capacidad_maxima || 0), 0);
  const ocupacionPromedio = capacidadTotal > 0 
    ? Math.round((totalComensales / capacidadTotal) * 100)
    : 0;

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-semibold">Ocupación por Espacio</CardTitle>
        <Building2 className="h-5 w-5 text-primary" />
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Resumen general */}
        <div className="grid grid-cols-3 gap-2 pb-2 border-b">
          <div className="text-center">
            <div className="text-xl font-bold text-primary">{ocupacion.length}</div>
            <p className="text-[10px] text-muted-foreground">Espacios</p>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold">{totalReservas}</div>
            <p className="text-[10px] text-muted-foreground">Reservas</p>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold">{ocupacionPromedio}%</div>
            <p className="text-[10px] text-muted-foreground">Ocupación</p>
          </div>
        </div>

        {/* Lista compacta de espacios */}
        <div className="space-y-2">
          {ocupacion.slice(0, 4).map((espacio) => {
            const colors = getStatusColor(espacio.porcentaje_ocupacion);
            
            return (
              <div key={espacio.espacio_id} className={`p-2 rounded-lg ${colors.bg}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm truncate flex-1">{espacio.espacio_nombre}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {espacio.total_comensales}/{espacio.capacidad_maxima}
                    </span>
                    <span className={`text-sm font-semibold ${colors.text}`}>
                      {espacio.porcentaje_ocupacion}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-background/50 rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${colors.bar} transition-all duration-500`}
                    style={{ width: `${Math.min(100, espacio.porcentaje_ocupacion)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
