import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarCheck } from "lucide-react";
import { useTodayReservations } from "@/hooks/useDashboardStats";

export function ReservasHoy() {
  const { data: reservas } = useTodayReservations();

  const totalComensales = reservas?.reduce((acc, r) => acc + r.numero_comensales, 0) || 0;
  const aforoTotal = reservas?.reduce((acc, r) => {
    const espacio = r.espacios_reserva as any;
    return acc + (espacio?.capacidad_maxima || 0);
  }, 0) || 100;

  const porcentajeAforo = aforoTotal > 0 ? ((totalComensales / aforoTotal) * 100).toFixed(1) : 0;

  const reservasConfirmadas = reservas?.filter(r => r.estado === "confirmada").length || 0;
  const reservasPendientes = reservas?.filter(r => r.estado === "pendiente").length || 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Reservas de Hoy</CardTitle>
        <CalendarCheck className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div>
            <div className="text-2xl font-bold text-primary">{reservas?.length || 0}</div>
            <p className="text-xs text-muted-foreground">
              {reservasConfirmadas} confirmadas · {reservasPendientes} pendientes
            </p>
          </div>
          <div className="space-y-2 pt-2 border-t">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Comensales esperados</span>
              <span className="font-medium">{totalComensales}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">% Aforo</span>
              <span className="font-medium">{porcentajeAforo}%</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
