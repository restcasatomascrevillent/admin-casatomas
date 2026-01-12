import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useDashboardFilters } from "@/contexts/DashboardContext";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { format, eachDayOfInterval } from "date-fns";
import { es } from "date-fns/locale";

export function GraficoReservasPorDia() {
  const { getDateRange } = useDashboardFilters();
  const { start, end } = getDateRange();
  const { data } = useDashboardStats(start, end);

  const calcularReservasPorDia = () => {
    if (!data?.reservas) return [];

    const dias = eachDayOfInterval({ start, end });
    
    return dias.map((dia) => {
      const reservasDelDia = data.reservas.filter(
        (r) => format(new Date(r.fecha), "yyyy-MM-dd") === format(dia, "yyyy-MM-dd")
      );

      return {
        fecha: format(dia, "dd/MM", { locale: es }),
        reservas: reservasDelDia.length,
        comensales: reservasDelDia.reduce((acc, r) => acc + r.numero_comensales, 0),
      };
    });
  };

  const datos = calcularReservasPorDia();

  return (
    <Card>
      <CardHeader className="pb-2 sm:pb-4">
        <CardTitle className="text-sm sm:text-base font-medium">Reservas por Día</CardTitle>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {datos.length > 0 ? (
          <ResponsiveContainer width="100%" height={250} className="sm:h-[300px]">
            <BarChart data={datos} margin={{ left: -20, right: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="fecha"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Bar dataKey="reservas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            No hay datos disponibles
          </div>
        )}
      </CardContent>
    </Card>
  );
}
