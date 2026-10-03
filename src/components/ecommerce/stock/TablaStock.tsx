import { useState } from "react";
import { useEcommerceStats } from "@/hooks/useEcommerceStats";
import { useMovimientosStock } from "@/hooks/useMovimientosStock";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Search, Plus, Minus, Edit2, Wine, Beef } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export function TablaStock() {
  const { stockConsolidado, isLoading } = useEcommerceStats();
  const { ajustarStock, agregarStock, retirarStock } = useMovimientosStock();
  
  const [busqueda, setBusqueda] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState<string>("all");
  const [modalAbierto, setModalAbierto] = useState(false);
  const [productoSeleccionado, setProductoSeleccionado] = useState<{
    id: string;
    nombre: string;
    tipo: string;
    stock: number;
  } | null>(null);
  const [tipoMovimiento, setTipoMovimiento] = useState<'ajuste' | 'entrada' | 'salida'>('ajuste');
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");

  const productosFiltrados = stockConsolidado.filter(p => {
    const coincideBusqueda = p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      p.categoria?.toLowerCase().includes(busqueda.toLowerCase());
    const coincideTipo = tipoFiltro === "all" || p.tipo === tipoFiltro;
    return coincideBusqueda && coincideTipo;
  });

  const abrirModal = (producto: typeof productoSeleccionado, tipo: 'ajuste' | 'entrada' | 'salida') => {
    setProductoSeleccionado(producto);
    setTipoMovimiento(tipo);
    setCantidad("");
    setMotivo("");
    setModalAbierto(true);
  };

  const handleGuardar = async () => {
    if (!productoSeleccionado || !cantidad) return;

    const cantidadNum = parseInt(cantidad);
    const productoTipo = productoSeleccionado.tipo as 'bebida' | 'comida';

    try {
      if (tipoMovimiento === 'ajuste') {
        await ajustarStock(productoSeleccionado.id, productoTipo, cantidadNum, motivo);
      } else if (tipoMovimiento === 'entrada') {
        await agregarStock(productoSeleccionado.id, productoTipo, cantidadNum, motivo);
      } else {
        await retirarStock(productoSeleccionado.id, productoTipo, cantidadNum, motivo);
      }
      setModalAbierto(false);
    } catch (error) {
      console.error(error);
    }
  };

  const getStockBadge = (stock: number | null) => {
    const s = stock || 0;
    if (s === 0) return <Badge variant="destructive">Sin stock</Badge>;
    if (s <= 5) return <Badge variant="outline" className="text-amber-600 border-amber-600">{s} uds</Badge>;
    return <Badge variant="secondary">{s} uds</Badge>;
  };

  const formatCurrency = (value: number | null) => 
    value ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value) : '-';

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar producto o categoría..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={tipoFiltro} onValueChange={setTipoFiltro}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="bebida">Bebidas</SelectItem>
            <SelectItem value="comida">Comida</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando stock...</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-center">Stock</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productosFiltrados.map((producto) => (
                <TableRow key={`${producto.tipo}-${producto.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {producto.tipo === 'bebida' ? (
                        <Wine className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Beef className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-medium">{producto.nombre}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {producto.categoria || '-'}
                  </TableCell>
                  <TableCell className="text-center">
                    {getStockBadge(producto.stock)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(producto.precio_eur)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={producto.activado ? "default" : "secondary"}>
                      {producto.activado ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11"
                        onClick={() => abrirModal({
                          id: producto.id,
                          nombre: producto.nombre,
                          tipo: producto.tipo,
                          stock: producto.stock || 0,
                        }, 'entrada')}
                        title="Añadir stock"
                        aria-label="Añadir stock"
                      >
                        <Plus className="h-4 w-4 text-green-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11"
                        onClick={() => abrirModal({
                          id: producto.id,
                          nombre: producto.nombre,
                          tipo: producto.tipo,
                          stock: producto.stock || 0,
                        }, 'salida')}
                        title="Retirar stock"
                        aria-label="Retirar stock"
                      >
                        <Minus className="h-4 w-4 text-red-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11"
                        onClick={() => abrirModal({
                          id: producto.id,
                          nombre: producto.nombre,
                          tipo: producto.tipo,
                          stock: producto.stock || 0,
                        }, 'ajuste')}
                        title="Ajustar stock"
                        aria-label="Ajustar stock"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={modalAbierto} onOpenChange={setModalAbierto}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {tipoMovimiento === 'ajuste' && 'Ajustar Stock'}
              {tipoMovimiento === 'entrada' && 'Añadir Stock'}
              {tipoMovimiento === 'salida' && 'Retirar Stock'}
            </DialogTitle>
          </DialogHeader>
          {productoSeleccionado && (
            <div className="space-y-4">
              <div>
                <p className="font-medium">{productoSeleccionado.nombre}</p>
                <p className="text-sm text-muted-foreground">
                  Stock actual: {productoSeleccionado.stock} unidades
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="cantidad">
                  {tipoMovimiento === 'ajuste' ? 'Nuevo stock' : 'Cantidad'}
                </Label>
                <Input
                  id="cantidad"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  className="h-11 text-base md:text-base"
                  placeholder={tipoMovimiento === 'ajuste' ? 'Nuevo valor de stock' : 'Unidades'}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="motivo">Motivo (opcional)</Label>
                <Textarea
                  id="motivo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej: Recepción de mercancía, rotura, inventario..."
                  className="text-base md:text-base"
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-11 px-5" onClick={() => setModalAbierto(false)}>
              Cancelar
            </Button>
            <Button className="h-11 px-5" onClick={handleGuardar} disabled={!cantidad}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
