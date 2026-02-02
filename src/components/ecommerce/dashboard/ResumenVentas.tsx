import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, ShoppingCart, Receipt, DollarSign } from "lucide-react";

interface ResumenVentasProps {
  ventasHoy: number;
  ventasSemana: number;
  ventasMes: number;
  numPedidosHoy: number;
  numPedidosSemana: number;
  numPedidosMes: number;
  ticketMedio: number;
}

export function ResumenVentas({
  ventasHoy,
  ventasSemana,
  ventasMes,
  numPedidosHoy,
  numPedidosSemana,
  numPedidosMes,
  ticketMedio,
}: ResumenVentasProps) {
  const formatCurrency = (value: number) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Ventas Hoy</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(ventasHoy)}</div>
          <p className="text-xs text-muted-foreground">
            {numPedidosHoy} pedido{numPedidosHoy !== 1 ? 's' : ''}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Ventas Semana</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(ventasSemana)}</div>
          <p className="text-xs text-muted-foreground">
            {numPedidosSemana} pedidos
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Ventas Mes</CardTitle>
          <Receipt className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(ventasMes)}</div>
          <p className="text-xs text-muted-foreground">
            {numPedidosMes} pedidos
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Ticket Medio</CardTitle>
          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(ticketMedio)}</div>
          <p className="text-xs text-muted-foreground">
            Por pedido
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
