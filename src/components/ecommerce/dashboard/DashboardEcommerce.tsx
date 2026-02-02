import { useEcommerceStats } from "@/hooks/useEcommerceStats";
import { ResumenVentas } from "./ResumenVentas";
import { GraficoVentasDiarias } from "./GraficoVentasDiarias";
import { ProductosMasVendidos } from "./ProductosMasVendidos";
import { AlertasStockWidget } from "./AlertasStockWidget";
import { PedidosPendientesWidget } from "./PedidosPendientesWidget";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardEcommerce() {
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
  } = useEcommerceStats();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ResumenVentas
        ventasHoy={ventasHoy}
        ventasSemana={ventasSemana}
        ventasMes={ventasMes}
        numPedidosHoy={numPedidosHoy}
        numPedidosSemana={numPedidosSemana}
        numPedidosMes={numPedidosMes}
        ticketMedio={ticketMedio}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <GraficoVentasDiarias datos={datosGraficoVentas} />
        <ProductosMasVendidos productos={productosVendidos} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <AlertasStockWidget stockBajo={stockBajo} sinStock={sinStock} />
        <PedidosPendientesWidget pendientes={pedidosPendientes} totalHoy={numPedidosHoy} />
      </div>
    </div>
  );
}
