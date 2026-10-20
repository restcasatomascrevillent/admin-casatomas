import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2 } from "lucide-react";

interface PedidosPendientesWidgetProps {
  pendientes: number;
  totalHoy: number;
}

export function PedidosPendientesWidget({ pendientes, totalHoy }: PedidosPendientesWidgetProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Pedidos Pendientes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-4">
          {pendientes > 0 ? (
            <>
              <div className="text-4xl font-bold text-amber-500">{pendientes}</div>
              <p className="text-sm text-muted-foreground mt-1">
                Por procesar
              </p>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-500 mb-2" />
              <p className="text-sm text-muted-foreground">
                Todo al día
              </p>
            </>
          )}
        </div>
        <div className="border-t pt-3 mt-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Pedidos hoy</span>
            <Badge variant="secondary">{totalHoy}</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
