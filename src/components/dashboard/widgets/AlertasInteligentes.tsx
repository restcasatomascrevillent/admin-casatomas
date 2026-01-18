import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Info, CheckCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useTodayReservations, useTodayConfirmedReservations, useActiveStaff } from "@/hooks/useDashboardStats";

export function AlertasInteligentes() {
  const { data: todasReservas } = useTodayReservations();
  const { data: reservasConfirmadas } = useTodayConfirmedReservations();
  const { data: activeStaff } = useActiveStaff();

  const alerts = [];

  // Check staff coverage - usar solo confirmadas para ocupación
  const totalStaff = activeStaff?.length || 0;
  const totalReservasConfirmadas = reservasConfirmadas?.length || 0;
  
  if (totalReservasConfirmadas > 10 && totalStaff < 5) {
    alerts.push({
      type: "warning",
      message: `Ocupación alta prevista (${totalReservasConfirmadas} reservas confirmadas) con personal limitado (${totalStaff} activos)`,
    });
  }

  // Check special requests - usar todas las reservas no canceladas
  const peticionesEspeciales = todasReservas?.filter(r => r.notas_cliente?.length > 0).length || 0;
  if (peticionesEspeciales > 0) {
    alerts.push({
      type: "info",
      message: `Tienes ${peticionesEspeciales} reservas con peticiones especiales (alergias, grupos grandes, etc.)`,
    });
  }

  // Check pending reservations - usar todas las reservas
  const reservasPendientes = todasReservas?.filter(r => r.estado === "pendiente").length || 0;
  if (reservasPendientes > 3) {
    alerts.push({
      type: "warning",
      message: `Tienes ${reservasPendientes} reservas pendientes de confirmar`,
    });
  }

  // If everything is ok
  if (alerts.length === 0) {
    alerts.push({
      type: "success",
      message: "Todo está bajo control. No hay alertas importantes para hoy.",
    });
  }

  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle className="text-base font-medium">Alertas del Día</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.map((alert, index) => (
          <Alert
            key={index}
            variant={alert.type === "warning" ? "destructive" : "default"}
            className={alert.type === "success" ? "border-green-500" : ""}
          >
            {alert.type === "warning" && <AlertTriangle className="h-4 w-4" />}
            {alert.type === "info" && <Info className="h-4 w-4" />}
            {alert.type === "success" && <CheckCircle className="h-4 w-4 text-green-500" />}
            <AlertDescription>{alert.message}</AlertDescription>
          </Alert>
        ))}
      </CardContent>
    </Card>
  );
}
