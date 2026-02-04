import { useEcommerceStats } from "@/hooks/useEcommerceStats";
import { ResumenVentas } from "../dashboard/ResumenVentas";
import { GraficoVentasDiarias } from "../dashboard/GraficoVentasDiarias";
import { ProductosMasVendidos } from "../dashboard/ProductosMasVendidos";
import { AlertasStockWidget } from "../dashboard/AlertasStockWidget";
import { PedidosPendientesWidget } from "../dashboard/PedidosPendientesWidget";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, MapPin, Percent } from "lucide-react";
export function SeccionAnaliticas() {
  const {
    isLoading,
    ventasHoy,
    ventasSemana,
    ventasMes,
    numPedidosHoy,
    numPedidosSemana,
    numPedidosMes,
    ticketMedio,
    stockBajo,
    sinStock,
    pedidosPendientes,
    productosVendidos,
    datosGraficoVentas,
    ventasPorPais
  } = useEcommerceStats();
  const formatCurrency = (value: number) => new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR"
  }).format(value);
  if (isLoading) {
    return <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>;
  }

  // Calcular ganancias estimadas (margen del 30% sobre ventas)
  const margenEstimado = 0.3;
  const gananciasHoy = ventasHoy * margenEstimado;
  const gananciasSemana = ventasSemana * margenEstimado;
  const gananciasMes = ventasMes * margenEstimado;
  const paisesOrdenados = Object.entries(ventasPorPais).sort(([, a], [, b]) => b - a).slice(0, 5);
  return <div className="space-y-6">
      {/* Resumen de ventas */}
      <ResumenVentas ventasHoy={ventasHoy} ventasSemana={ventasSemana} ventasMes={ventasMes} numPedidosHoy={numPedidosHoy} numPedidosSemana={numPedidosSemana} numPedidosMes={numPedidosMes} ticketMedio={ticketMedio} />

      {/* Ganancias estimadas */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ganancias Hoy</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{formatCurrency(gananciasHoy)}</div>
            <p className="text-xs text-muted-foreground">Margen estimado 30%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ganancias Semana</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{formatCurrency(gananciasSemana)}</div>
            <p className="text-xs text-muted-foreground">Margen estimado 30%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ganancias Mes</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{formatCurrency(gananciasMes)}</div>
            <p className="text-xs text-muted-foreground">Margen estimado 30%</p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos principales */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <GraficoVentasDiarias datos={datosGraficoVentas} />
        <ProductosMasVendidos productos={productosVendidos} />
      </div>

      {/* Ventas por país y alertas */}
      
    </div>;
}