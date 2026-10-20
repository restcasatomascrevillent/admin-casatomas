import { useMovimientosStock } from "@/hooks/useMovimientosStock";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowUpCircle, ArrowDownCircle, RefreshCw, ShoppingCart, RotateCcw } from "lucide-react";

const MOVIMIENTO_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  entrada: { icon: <ArrowUpCircle className="h-4 w-4" />, color: "text-green-600", label: "Entrada" },
  salida: { icon: <ArrowDownCircle className="h-4 w-4" />, color: "text-red-600", label: "Salida" },
  ajuste: { icon: <RefreshCw className="h-4 w-4" />, color: "text-blue-600", label: "Ajuste" },
  venta: { icon: <ShoppingCart className="h-4 w-4" />, color: "text-purple-600", label: "Venta" },
  devolucion: { icon: <RotateCcw className="h-4 w-4" />, color: "text-amber-600", label: "Devolución" },
};

export function HistorialMovimientos() {
  const { movimientos, isLoading } = useMovimientosStock();

  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground">Cargando historial...</div>;
  }

  if (movimientos.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No hay movimientos de stock registrados
      </div>
    );
  }

  // Alto de la pantalla (Ecommerce.tsx le da el alto que queda bajo las
  // pestañas de Stock): la caja encoge hasta lo que sobra (`flex flex-col
  // min-h-0`) y el contenedor con scroll de <Table> desplaza por dentro con la
  // cabecera pegada arriba (fondo opaco, como la página, y sombra de 1 px como
  // línea inferior, que el borde de la fila no acompaña), sin paginar y sin
  // scroll de página. Con pocas filas mide lo que ellas.
  return (
    <div className="flex min-h-0 flex-col border rounded-lg overflow-hidden">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Producto</TableHead>
            <TableHead className="text-center">Cantidad</TableHead>
            <TableHead className="text-center">Stock Anterior</TableHead>
            <TableHead className="text-center">Stock Nuevo</TableHead>
            <TableHead>Motivo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {movimientos.map((mov) => {
            const config = MOVIMIENTO_CONFIG[mov.tipo_movimiento] || MOVIMIENTO_CONFIG.ajuste;
            return (
              <TableRow key={mov.id}>
                <TableCell className="text-sm">
                  {mov.created_at && format(new Date(mov.created_at), "dd/MM/yy HH:mm", { locale: es })}
                </TableCell>
                <TableCell>
                  <div className={`flex items-center gap-2 ${config.color}`}>
                    {config.icon}
                    <span className="font-medium">{config.label}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <span className="text-xs text-muted-foreground capitalize">{mov.producto_tipo}</span>
                    <p className="font-mono text-xs">{mov.producto_id.slice(0, 8)}...</p>
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={mov.tipo_movimiento === 'entrada' || mov.tipo_movimiento === 'devolucion' ? 'default' : 'secondary'}>
                    {mov.tipo_movimiento === 'entrada' || mov.tipo_movimiento === 'devolucion' ? '+' : ''}
                    {mov.tipo_movimiento === 'salida' || mov.tipo_movimiento === 'venta' ? '-' : ''}
                    {mov.cantidad}
                  </Badge>
                </TableCell>
                <TableCell className="text-center text-muted-foreground">
                  {mov.stock_anterior ?? '-'}
                </TableCell>
                <TableCell className="text-center font-medium">
                  {mov.stock_nuevo ?? '-'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                  {mov.motivo || '-'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
