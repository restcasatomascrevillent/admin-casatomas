import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, XCircle } from "lucide-react";
import { useDashboardFilters } from "@/contexts/DashboardContext";
import { useDashboardStats } from "@/hooks/useDashboardStats";

export function NoShowsCancelaciones() {
  const { getDateRange } = useDashboardFilters();
  const { start, end } = getDateRange();
  const { data } = useDashboardStats(start, end);

  const calcularEstadisticas = () => {
    if (!data?.reservas) return { canceladas: 0, total: 0, porcentaje: 0 };

    const canceladas = data.reservas.filter((r) => r.estado === "cancelada").length;
    const total = data.reservas.length;
    const porcentaje = total > 0 ? ((canceladas / total) * 100).toFixed(1) : 0;

    return { canceladas, total, porcentaje: Number(porcentaje) };
  };

  const stats = calcularEstadisticas();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Cancelaciones</CardTitle>
        <XCircle className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div>
            <div className="text-2xl font-bold text-destructive">{stats.canceladas}</div>
            <p className="text-xs text-muted-foreground">Reservas canceladas</p>
          </div>
          <div className="space-y-2 pt-2 border-t">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total reservas</span>
              <span className="font-medium">{stats.total}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">% Cancelación</span>
              <span
                className={`font-medium ${
                  stats.porcentaje > 10 ? "text-destructive" : "text-green-600"
                }`}
              >
                {stats.porcentaje}%
              </span>
            </div>
          </div>
          {stats.porcentaje > 10 && (
            <div className="flex items-center gap-2 p-2 bg-destructive/10 rounded text-xs text-destructive">
              <AlertCircle className="h-3 w-3" />
              <span>Tasa de cancelación elevada</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
