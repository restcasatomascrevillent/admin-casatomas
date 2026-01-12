import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarCheck, Clock, Users, TrendingUp } from "lucide-react";
import { useTodayReservations } from "@/hooks/useDashboardStats";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export function ReservasHoy() {
  const { data: reservas } = useTodayReservations();

  const totalComensales = reservas?.reduce((acc, r) => acc + r.numero_comensales, 0) || 0;
  const aforoTotal = reservas?.reduce((acc, r) => {
    const espacio = r.espacios_reserva as any;
    return acc + (espacio?.capacidad_maxima || 0);
  }, 0) || 100;

  const porcentajeAforo = aforoTotal > 0 ? Math.min(100, (totalComensales / aforoTotal) * 100) : 0;

  const reservasConfirmadas = reservas?.filter(r => r.estado === "confirmada").length || 0;
  const reservasPendientes = reservas?.filter(r => r.estado === "pendiente").length || 0;
  const reservasVerificadas = reservas?.filter(r => r.estado === "verificada").length || 0;

  // Próximas reservas (próximas 2 horas)
  const ahora = new Date();
  const proximasReservas = reservas?.filter(r => {
    const [h, m] = r.hora.split(':').map(Number);
    const horaReserva = new Date();
    horaReserva.setHours(h, m, 0, 0);
    const diffMs = horaReserva.getTime() - ahora.getTime();
    return diffMs > 0 && diffMs <= 2 * 60 * 60 * 1000;
  }).slice(0, 3) || [];

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-semibold">Reservas de Hoy</CardTitle>
        <CalendarCheck className="h-5 w-5 text-primary" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-primary/10 rounded-lg">
            <div className="text-3xl font-bold text-primary">{reservas?.length || 0}</div>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="text-center p-3 bg-green-500/10 rounded-lg">
            <div className="text-3xl font-bold text-green-600">{reservasConfirmadas + reservasVerificadas}</div>
            <p className="text-xs text-muted-foreground">Confirmadas</p>
          </div>
          <div className="text-center p-3 bg-amber-500/10 rounded-lg">
            <div className="text-3xl font-bold text-amber-600">{reservasPendientes}</div>
            <p className="text-xs text-muted-foreground">Pendientes</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Comensales esperados
            </span>
            <span className="font-semibold">{totalComensales}</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                Ocupación estimada
              </span>
              <span className="font-semibold">{porcentajeAforo.toFixed(0)}%</span>
            </div>
            <Progress value={porcentajeAforo} className="h-2" />
          </div>
        </div>

        {proximasReservas.length > 0 && (
          <div className="pt-3 border-t space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Próximas 2 horas
            </p>
            {proximasReservas.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm bg-muted/50 p-2 rounded">
                <div>
                  <span className="font-medium">{r.nombre || "Sin nombre"}</span>
                  <span className="text-muted-foreground ml-2">· {r.numero_comensales} pax</span>
                </div>
                <Badge variant="outline">{r.hora.substring(0, 5)}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
