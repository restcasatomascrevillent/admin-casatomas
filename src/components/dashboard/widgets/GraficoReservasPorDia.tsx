import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useDashboardFilters } from "@/contexts/DashboardContext";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { format, eachDayOfInterval } from "date-fns";
import { es } from "date-fns/locale";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useIdsSalasPrivadas } from "@/hooks/useSalasPrivadas";
import { reservasQueConsumenAforo } from "@/lib/reservas/salaPrivada";

export function GraficoReservasPorDia() {
  const { getDateRange } = useDashboardFilters();
  const { start, end } = getDateRange();
  const { data, isError, error, refetch } = useDashboardStats(start, end);
  // El Reservado (sala privada) está fuera de aforo: sus reservas no entran en las cifras.
  const idsPrivadas = useIdsSalasPrivadas();

  const calcularReservasPorDia = () => {
    if (!data?.reservas) return [];

    const dias = eachDayOfInterval({ start, end });
    
    return dias.map((dia) => {
      // Solo contar reservas confirmadas para las métricas
      const reservasDelDia = reservasQueConsumenAforo(data.reservas, idsPrivadas).filter(
        (r) => format(new Date(r.fecha), "yyyy-MM-dd") === format(dia, "yyyy-MM-dd") 
          && r.estado === "confirmada"
      );

      return {
        fecha: format(dia, "dd/MM", { locale: es }),
        reservas: reservasDelDia.length,
        comensales: reservasDelDia.reduce((acc, r) => acc + r.numero_comensales, 0),
      };
    });
  };

  const datos = calcularReservasPorDia();

  // Sin esto, un fallo de consulta dibujaba un gráfico plano a cero.
  if (isError) {
    return <EstadoErrorCarga titulo="las reservas por día" error={error} onReintentar={() => refetch()} className="h-full" />;
  }

  // ALTO (06/10/2026, el Dashboard ocupa el alto de la pantalla): la tarjeta llena el hueco que le da el Dashboard
  // y la gráfica se queda con todo lo que hay bajo el título (antes, 250 px fijos). Va en una capa absoluta para
  // que el ResponsiveContainer mida el hueco real y no su propio contenido. `min-h`: por debajo no se lee.
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-4 py-2.5 sm:px-5">
        <CardTitle className="text-sm font-medium">Reservas por Día</CardTitle>
      </CardHeader>
      <CardContent className="relative min-h-[120px] flex-1 p-0 sm:min-h-[150px]">
        {datos.length > 0 ? (
          <div data-testid="area-grafica" className="absolute inset-x-2 bottom-2 top-0 sm:inset-x-4 sm:bottom-3">
            <ResponsiveContainer width="100%" height="100%">
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
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No hay datos disponibles
          </div>
        )}
      </CardContent>
    </Card>
  );
}
