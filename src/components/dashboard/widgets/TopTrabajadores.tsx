import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Award } from "lucide-react";
import { useDashboardFilters } from "@/contexts/DashboardContext";
import { useDashboardStats } from "@/hooks/useDashboardStats";

export function TopTrabajadores() {
  const { getDateRange } = useDashboardFilters();
  const { start, end } = getDateRange();
  const { data } = useDashboardStats(start, end);

  const calcularTop = () => {
    if (!data?.horas) return [];

    const horasPorTrabajador = data.horas.reduce((acc, h) => {
      const trabajador = h.trabajadores as any;
      const key = h.trabajador_id;
      if (!acc[key]) {
        acc[key] = {
          nombre: `${trabajador?.nombre} ${trabajador?.apellidos}`,
          puesto: trabajador?.puesto,
          horas: 0,
        };
      }
      acc[key].horas += h.horas_trabajadas || 0;
      return acc;
    }, {} as Record<string, { nombre: string; puesto: string; horas: number }>);

    return Object.values(horasPorTrabajador)
      .sort((a, b) => b.horas - a.horas)
      .slice(0, 10);
  };

  const top = calcularTop();

  return (
    <Card className="col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Top Trabajadores por Horas</CardTitle>
        <Award className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {top.map((trabajador, index) => (
            <div key={index} className="flex items-center justify-between p-2 rounded hover:bg-muted/50">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                  {index + 1}
                </div>
                <div>
                  <div className="font-medium text-sm">{trabajador.nombre}</div>
                  <div className="text-xs text-muted-foreground">{trabajador.puesto}</div>
                </div>
              </div>
              <div className="text-sm font-bold">{trabajador.horas.toFixed(1)}h</div>
            </div>
          ))}
          {top.length === 0 && (
            <div className="text-center text-muted-foreground py-4">No hay datos disponibles</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
