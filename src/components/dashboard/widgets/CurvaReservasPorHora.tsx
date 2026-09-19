import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useTodayConfirmedReservations } from "@/hooks/useDashboardStats";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";

export function CurvaReservasPorHora() {
  const { data: reservas, isError, error, refetch } = useTodayConfirmedReservations();

  const calcularReservasPorHora = () => {
    if (!reservas || reservas.length === 0) return [];

    const horasCounts: Record<string, { reservas: number; comensales: number }> = {};

    reservas.forEach((reserva) => {
      const hora = reserva.hora.substring(0, 5); // HH:MM
      if (!horasCounts[hora]) {
        horasCounts[hora] = { reservas: 0, comensales: 0 };
      }
      horasCounts[hora].reservas++;
      horasCounts[hora].comensales += reserva.numero_comensales;
    });

    return Object.entries(horasCounts)
      .map(([hora, datos]) => ({
        hora,
        reservas: datos.reservas,
        comensales: datos.comensales,
      }))
      .sort((a, b) => a.hora.localeCompare(b.hora));
  };

  const datos = calcularReservasPorHora();
  
  // Calcular el máximo de comensales y redondear al siguiente múltiplo de 5
  const maxComensales = datos.length > 0 
    ? Math.max(...datos.map(d => d.comensales)) 
    : 0;
  const yMax = Math.ceil((maxComensales + 5) / 5) * 5;
  const yTicks = Array.from({ length: yMax / 5 + 1 }, (_, i) => i * 5);

  // Sin esto, un fallo de consulta dibujaba una curva vacía como si no hubiera reservas.
  if (isError) {
    return <EstadoErrorCarga titulo="la curva de reservas por hora" error={error} onReintentar={() => refetch()} />;
  }

  return (
    <Card>
      <CardHeader className="pb-2 sm:pb-4">
        <CardTitle className="text-sm sm:text-base font-medium">Curva de Reservas por Hora</CardTitle>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {datos.length > 0 ? (
          <ResponsiveContainer width="100%" height={250} className="sm:h-[300px]">
            <LineChart data={datos} margin={{ left: -20, right: 5 }}>
              <CartesianGrid 
                strokeDasharray="3 3" 
                stroke="hsl(var(--border))" 
                strokeOpacity={0.5}
                horizontal={true}
                vertical={false}
              />
              <XAxis
                dataKey="hora"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                domain={[0, yMax]}
                ticks={yTicks}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Line
                type="monotone"
                dataKey="reservas"
                stroke="hsl(var(--primary))"
                strokeWidth={3}
                dot={{ fill: "hsl(var(--primary))", r: 4 }}
                name="Reservas"
              />
              <Line
                type="monotone"
                dataKey="comensales"
                stroke="hsl(var(--accent))"
                strokeWidth={2}
                dot={{ fill: "hsl(var(--accent))", r: 3 }}
                name="Comensales"
              />
            </LineChart>
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
