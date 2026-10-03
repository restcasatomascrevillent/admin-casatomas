import { useState } from "react";
import { usePedidosEcommerce, EstadoPedido } from "@/hooks/usePedidosEcommerce";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, Search, Truck, CheckCircle, XCircle, Clock, Package, RotateCcw, Store, Globe } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { DetallePedido } from "./DetallePedido";

const ESTADO_COLORES: Record<string, string> = {
  pendiente: "bg-amber-500",
  confirmado: "bg-blue-500",
  preparando: "bg-purple-500",
  enviado: "bg-cyan-500",
  entregado: "bg-green-500",
  cancelado: "bg-red-500",
  devuelto: "bg-gray-500",
};

const ESTADO_ICONOS: Record<string, React.ReactNode> = {
  pendiente: <Clock className="h-3 w-3" />,
  confirmado: <CheckCircle className="h-3 w-3" />,
  preparando: <Package className="h-3 w-3" />,
  enviado: <Truck className="h-3 w-3" />,
  entregado: <CheckCircle className="h-3 w-3" />,
  cancelado: <XCircle className="h-3 w-3" />,
  devuelto: <RotateCcw className="h-3 w-3" />,
};

export function ListaPedidos() {
  const [estadoFiltro, setEstadoFiltro] = useState<string>("all");
  const [tipoVentaFiltro, setTipoVentaFiltro] = useState<'online' | 'presencial' | 'todos'>('todos');
  const [busqueda, setBusqueda] = useState("");
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState<string | null>(null);

  const { pedidos, isLoading, cambiarEstado, ESTADOS_PEDIDO } = usePedidosEcommerce({
    estado: estadoFiltro !== "all" ? estadoFiltro : undefined,
    tipoVenta: tipoVentaFiltro,
  });

  const formatCurrency = (value: number) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);

  const pedidosFiltrados = pedidos.filter(p => 
    p.numero_pedido.toLowerCase().includes(busqueda.toLowerCase()) ||
    p.nombre_completo?.toLowerCase().includes(busqueda.toLowerCase()) ||
    p.email?.toLowerCase().includes(busqueda.toLowerCase()) ||
    p.numero_ticket?.toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nº pedido, ticket, cliente o email..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={tipoVentaFiltro} onValueChange={(v) => setTipoVentaFiltro(v as 'online' | 'presencial' | 'todos')}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Tipo de venta" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas las ventas</SelectItem>
            <SelectItem value="online">
              <div className="flex items-center gap-2">
                <Globe className="h-3 w-3" />
                Online
              </div>
            </SelectItem>
            <SelectItem value="presencial">
              <div className="flex items-center gap-2">
                <Store className="h-3 w-3" />
                Presencial (TPV)
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={estadoFiltro} onValueChange={setEstadoFiltro}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {ESTADOS_PEDIDO.map((estado) => (
              <SelectItem key={estado} value={estado} className="capitalize">
                {estado}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando pedidos...</div>
      ) : pedidosFiltrados.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No hay pedidos</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº Pedido</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidosFiltrados.map((pedido) => (
                <TableRow key={pedido.id}>
                  <TableCell className="font-mono font-medium">
                    {pedido.tipo_venta === 'presencial' ? pedido.numero_ticket : pedido.numero_pedido}
                  </TableCell>
                  <TableCell>
                    {pedido.tipo_venta === 'presencial' ? (
                      <Badge variant="secondary" className="gap-1">
                        <Store className="h-3 w-3" />
                        TPV
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <Globe className="h-3 w-3" />
                        Online
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{pedido.nombre_completo || 'Venta en tienda'}</p>
                      <p className="text-xs text-muted-foreground">
                        {pedido.tipo_venta === 'presencial' ? `Caja: ${pedido.caja || '-'}` : pedido.email}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    {pedido.created_at && format(new Date(pedido.created_at), "dd MMM yyyy HH:mm", { locale: es })}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(pedido.total)}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={pedido.estado || 'pendiente'}
                      onValueChange={(nuevoEstado) => {
                        cambiarEstado.mutate({ id: pedido.id, estado: nuevoEstado as EstadoPedido });
                      }}
                    >
                      <SelectTrigger className="h-11 w-44">
                        <Badge className={`${ESTADO_COLORES[pedido.estado || 'pendiente']} text-white flex items-center gap-1`}>
                          {ESTADO_ICONOS[pedido.estado || 'pendiente']}
                          <span className="capitalize">{pedido.estado}</span>
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {ESTADOS_PEDIDO.map((estado) => (
                          <SelectItem key={estado} value={estado} className="capitalize">
                            <div className="flex items-center gap-2">
                              {ESTADO_ICONOS[estado]}
                              {estado}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11"
                      onClick={() => setPedidoSeleccionado(pedido.id)}
                      aria-label="Ver el detalle del pedido"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!pedidoSeleccionado} onOpenChange={() => setPedidoSeleccionado(null)}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Pedido</DialogTitle>
          </DialogHeader>
          {pedidoSeleccionado && (
            <DetallePedido 
              pedido={pedidos.find(p => p.id === pedidoSeleccionado)!} 
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
