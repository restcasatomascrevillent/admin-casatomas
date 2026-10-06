import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useTodayConfirmedReservations } from "@/hooks/useDashboardStats";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useIdsSalasPrivadas } from "@/hooks/useSalasPrivadas";
import { reservasQueConsumenAforo } from "@/lib/reservas/salaPrivada";

export function CurvaReservasPorHora() {
  const { data: todas, isError, error, refetch } = useTodayConfirmedReservations();
  // El Reservado (sala privada) está fuera de aforo: sus reservas no entran en la curva.
  const idsPrivadas = useIdsSalasPrivadas();
  const reservas = todas ? reservasQueConsumenAforo(todas, idsPrivadas) : todas;

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
    return <EstadoErrorCarga titulo="la curva de reservas por hora" error={error} onReintentar={() => refetch()} className="h-full" />;
  }

  // Mismo reparto de alto que `GraficoReservasPorDia` (06/10/2026). La leyenda (qué línea es cada cosa: antes no
  // había) va en la fila del título, para no quitarle alto a la curva.
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1 space-y-0 px-4 py-2.5 sm:px-5">
        <CardTitle className="text-sm font-medium">Curva de Reservas por Hora</CardTitle>
        <ul aria-label="Leyenda" className="flex items-center gap-3 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-1 w-4 rounded-full bg-primary" />
            Reservas
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-accent" />
            Comensales
          </li>
        </ul>
      </CardHeader>
      <CardContent className="relative min-h-[120px] flex-1 p-0 sm:min-h-[150px]">
        {datos.length > 0 ? (
          <div data-testid="area-grafica" className="absolute inset-x-2 bottom-2 top-0 sm:inset-x-4 sm:bottom-3">
            <ResponsiveContainer width="100%" height="100%">
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
