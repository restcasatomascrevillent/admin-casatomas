import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wine, Beef } from "lucide-react";

interface ProductoVendido {
  producto_id: string;
  producto_tipo: string;
  nombre_producto: string;
  unidades_vendidas: number;
  total_ingresos: number;
}

interface ProductosMasVendidosProps {
  productos: ProductoVendido[];
}

export function ProductosMasVendidos({ productos }: ProductosMasVendidosProps) {
  const formatCurrency = (value: number) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);

  const top5 = productos.slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 5 Productos Vendidos</CardTitle>
      </CardHeader>
      <CardContent>
        {top5.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No hay ventas registradas
          </p>
        ) : (
          <div className="space-y-4">
            {top5.map((producto, index) => (
              <div key={producto.producto_id} className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {producto.producto_tipo === 'bebida' ? (
                      <Wine className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Beef className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-medium truncate">{producto.nombre_producto}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {producto.unidades_vendidas} unidades
                  </p>
                </div>
                <Badge variant="secondary">
                  {formatCurrency(Number(producto.total_ingresos))}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
