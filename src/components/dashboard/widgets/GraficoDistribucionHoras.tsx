import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { useDashboardFilters } from "@/contexts/DashboardContext";
import { useDashboardStats } from "@/hooks/useDashboardStats";

const COLORS = {
  cocina: "hsl(var(--primary))",
  sala: "hsl(var(--accent))",
  otros: "hsl(var(--secondary))",
};

export function GraficoDistribucionHoras() {
  const { getDateRange } = useDashboardFilters();
  const { start, end } = getDateRange();
  const { data } = useDashboardStats(start, end);

  const calcularDistribucion = () => {
    if (!data?.horas) return [];

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

    const total = data.horas.reduce((acc, h) => acc + (h.horas_trabajadas || 0), 0);
    const otros = total - cocina - sala;

    return [
      { name: "Cocina", value: Math.round(cocina), color: COLORS.cocina },
      { name: "Sala", value: Math.round(sala), color: COLORS.sala },
      { name: "Otros", value: Math.round(otros), color: COLORS.otros },
    ].filter((item) => item.value > 0);
  };

  const distribucion = calcularDistribucion();

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle className="text-base font-medium">Distribución de Horas por Rol</CardTitle>
      </CardHeader>
      <CardContent>
        {distribucion.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={distribucion}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {distribucion.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => `${value}h`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[250px] flex items-center justify-center text-muted-foreground">
            No hay datos disponibles
          </div>
        )}
      </CardContent>
    </Card>
  );
}
