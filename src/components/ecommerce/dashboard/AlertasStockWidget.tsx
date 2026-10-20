import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Package } from "lucide-react";

interface ProductoStock {
  id: string;
  nombre: string;
  tipo: string;
  stock: number | null;
  categoria: string | null;
}

interface AlertasStockWidgetProps {
  stockBajo: ProductoStock[];
  sinStock: ProductoStock[];
}

export function AlertasStockWidget({ stockBajo, sinStock }: AlertasStockWidgetProps) {
  const alertas = [
    ...sinStock.map(p => ({ ...p, tipo_alerta: 'sin_stock' as const })),
    ...stockBajo.filter(p => (p.stock || 0) > 0).map(p => ({ ...p, tipo_alerta: 'bajo' as const })),
  ].slice(0, 6);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Alertas de Stock
        </CardTitle>
        {alertas.length > 0 && (
          <Badge variant="destructive">{alertas.length}</Badge>
        )}
      </CardHeader>
      <CardContent>
        {alertas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Package className="h-8 w-8 mb-2" />
            <p className="text-sm">Stock saludable</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alertas.map((producto) => (
              <div key={`${producto.tipo}-${producto.id}`} className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{producto.nombre}</p>
                  <p className="text-xs text-muted-foreground capitalize">{producto.tipo}</p>
                </div>
                {producto.tipo_alerta === 'sin_stock' ? (
                  <Badge variant="destructive">Sin stock</Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-600 border-amber-600">
                    {producto.stock} uds
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
