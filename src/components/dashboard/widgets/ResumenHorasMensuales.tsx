import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";
import { useDashboardFilters } from "@/contexts/DashboardContext";
import { useDashboardStats } from "@/hooks/useDashboardStats";

export function ResumenHorasMensuales() {
  const { getDateRange } = useDashboardFilters();
  const { start, end } = getDateRange();
  const { data } = useDashboardStats(start, end);

  const calcularHoras = () => {
    if (!data?.horas) return { total: 0, cocina: 0, sala: 0, otros: 0 };

    const total = data.horas.reduce((acc, h) => acc + (h.horas_trabajadas || 0), 0);
    
    const cocina = data.horas
      .filter((h) => {
        const puesto = (h.trabajadores as any)?.puesto;
        return puesto === "cocinero" || puesto === "ayudante_cocina";
      })
      .reduce((acc, h) => acc + (h.horas_trabajadas || 0), 0);

    const sala = data.horas
      .filter((h) => {
        const puesto = (h.trabajadores as any)?.puesto;
        return puesto === "camarero" || puesto === "ayudante_camarero";
      })
      .reduce((acc, h) => acc + (h.horas_trabajadas || 0), 0);

    const otros = total - cocina - sala;

    return { total, cocina, sala, otros };
  };

  const horas = calcularHoras();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Horas Trabajadas</CardTitle>
        <Clock className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div>
            <div className="text-2xl font-bold text-primary">{horas.total.toFixed(1)}h</div>
            <p className="text-xs text-muted-foreground">Total del período</p>
          </div>
          <div className="space-y-2 pt-2 border-t">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Cocina</span>
              <span className="font-medium">{horas.cocina.toFixed(1)}h</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Sala</span>
              <span className="font-medium">{horas.sala.toFixed(1)}h</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Otros</span>
              <span className="font-medium">{horas.otros.toFixed(1)}h</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
