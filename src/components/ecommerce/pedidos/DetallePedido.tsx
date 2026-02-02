import { useEffect, useState } from "react";
import { PedidoEcommerce, LineaPedido, usePedidosEcommerce } from "@/hooks/usePedidosEcommerce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { User, MapPin, CreditCard, Truck, FileText } from "lucide-react";

interface DetallePedidoProps {
  pedido: PedidoEcommerce;
}

export function DetallePedido({ pedido }: DetallePedidoProps) {
  const [lineas, setLineas] = useState<LineaPedido[]>([]);
  const [loading, setLoading] = useState(true);
  const { getLineasPedido } = usePedidosEcommerce();

  useEffect(() => {
    const cargarLineas = async () => {
      try {
        const data = await getLineasPedido(pedido.id);
        setLineas(data);
      } catch (error) {
        console.error("Error cargando líneas:", error);
      } finally {
        setLoading(false);
      }
    };
    cargarLineas();
  }, [pedido.id]);

  const formatCurrency = (value: number) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Pedido #{pedido.numero_pedido}</h3>
          <p className="text-sm text-muted-foreground">
            {pedido.created_at && format(new Date(pedido.created_at), "dd MMMM yyyy 'a las' HH:mm", { locale: es })}
          </p>
        </div>
        <Badge variant={pedido.pagado ? "default" : "destructive"}>
          {pedido.pagado ? "Pagado" : "Pendiente de pago"}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Cliente */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <User className="h-4 w-4" />
              Cliente
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p className="font-medium">{pedido.nombre_completo || 'No especificado'}</p>
            <p className="text-muted-foreground">{pedido.email}</p>
            <p className="text-muted-foreground">{pedido.telefono}</p>
          </CardContent>
        </Card>

        {/* Dirección de envío */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Dirección de Envío
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>{pedido.direccion_envio || 'No especificada'}</p>
            <p>{pedido.codigo_postal_envio} {pedido.ciudad_envio}</p>
            <p>{pedido.pais_envio}</p>
          </CardContent>
        </Card>

        {/* Pago */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Pago
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>Método: {pedido.metodo_pago || 'No especificado'}</p>
            {pedido.referencia_pago && <p>Ref: {pedido.referencia_pago}</p>}
            {pedido.fecha_pago && (
              <p className="text-muted-foreground">
                Pagado el {format(new Date(pedido.fecha_pago), "dd/MM/yyyy HH:mm")}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Envío */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Truck className="h-4 w-4" />
              Envío
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>Transportista: {pedido.transportista || 'No asignado'}</p>
            {pedido.numero_seguimiento && <p>Seguimiento: {pedido.numero_seguimiento}</p>}
            {pedido.fecha_envio && (
              <p className="text-muted-foreground">
                Enviado el {format(new Date(pedido.fecha_envio), "dd/MM/yyyy")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Productos */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Productos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : lineas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay productos</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-center">Cantidad</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineas.map((linea) => (
                  <TableRow key={linea.id}>
                    <TableCell>
                      <p className="font-medium">{linea.nombre_producto}</p>
                      <p className="text-xs text-muted-foreground capitalize">{linea.producto_tipo}</p>
                    </TableCell>
                    <TableCell className="text-center">{linea.cantidad}</TableCell>
                    <TableCell className="text-right">{formatCurrency(linea.precio_unitario)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(linea.total_linea)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Resumen */}
      <Card>
        <CardContent className="pt-4">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(pedido.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gastos de envío</span>
              <span>{formatCurrency(pedido.gastos_envio || 0)}</span>
            </div>
            {(pedido.descuento || 0) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Descuento</span>
                <span>-{formatCurrency(pedido.descuento || 0)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">IVA</span>
              <span>{formatCurrency(pedido.iva || 0)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span>{formatCurrency(pedido.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notas */}
      {(pedido.notas_cliente || pedido.notas_internas) && (
        <div className="space-y-4">
          {pedido.notas_cliente && (
            <div>
              <h4 className="text-sm font-medium mb-1">Notas del cliente</h4>
              <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                {pedido.notas_cliente}
              </p>
            </div>
          )}
          {pedido.notas_internas && (
            <div>
              <h4 className="text-sm font-medium mb-1">Notas internas</h4>
              <p className="text-sm text-muted-foreground bg-amber-50 dark:bg-amber-950 p-3 rounded-lg">
                {pedido.notas_internas}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
