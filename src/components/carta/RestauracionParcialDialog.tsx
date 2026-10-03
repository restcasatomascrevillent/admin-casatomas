import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { usePlatos } from "@/hooks/usePlatos";
import { useBebidas } from "@/hooks/useBebidas";
import { useVinos } from "@/hooks/useVinos";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Search, Edit3 } from "lucide-react";
import { toast } from "sonner";

interface RestauracionParcialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ajuste: any;
}

interface ItemSeleccionado {
  id: string;
  nombre: string;
  precioActual: number;
  precioOriginal: number;
  precioEditado: number;
  seleccionado: boolean;
}

export function RestauracionParcialDialog({ open, onOpenChange, ajuste }: RestauracionParcialDialogProps) {
  const [items, setItems] = useState<ItemSeleccionado[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const { platos, actualizarPlato } = usePlatos();
  const { bebidas, actualizarBebida } = useBebidas();
  const { vinos, actualizarVino } = useVinos();

  useEffect(() => {
    if (!open || !ajuste) return;

    // Obtener items actuales según el tipo
    let itemsActuales: any[] = [];
    if (ajuste.tipo_carta === "platos") {
      itemsActuales = platos || [];
    } else if (ajuste.tipo_carta === "bebidas") {
      itemsActuales = bebidas || [];
    } else {
      itemsActuales = vinos || [];
    }

    // Crear lista de items
    const nuevosItems: ItemSeleccionado[] = ajuste.snapshot.map((itemSnapshot: any) => {
      const itemActual = itemsActuales.find(i => i.id === itemSnapshot.id);
      const precioActual = itemActual?.precio_eur || 0;
      
      return {
        id: itemSnapshot.id,
        nombre: itemSnapshot.nombre,
        precioActual,
        precioOriginal: itemSnapshot.precio_anterior,
        precioEditado: itemSnapshot.precio_anterior,
        seleccionado: false,
      };
    });

    setItems(nuevosItems);
  }, [open, ajuste, platos, bebidas, vinos]);

  const itemsFiltrados = items.filter(item => 
    item.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const itemsSeleccionados = items.filter(i => i.seleccionado);

  const toggleSeleccion = (id: string) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, seleccionado: !item.seleccionado } : item
    ));
  };

  const seleccionarTodos = () => {
    const todosSeleccionados = itemsFiltrados.every(i => i.seleccionado);
    setItems(prev => prev.map(item => {
      const estaEnFiltrados = itemsFiltrados.some(f => f.id === item.id);
      return estaEnFiltrados ? { ...item, seleccionado: !todosSeleccionados } : item;
    }));
  };

  const actualizarPrecio = (id: string, nuevoPrecio: string) => {
    const precio = parseFloat(nuevoPrecio);
    if (isNaN(precio) || precio < 0) return;
    
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, precioEditado: precio } : item
    ));
  };

  const handleRestaurar = async () => {
    if (itemsSeleccionados.length === 0) {
      toast.error("Selecciona al menos un item");
      return;
    }

    try {
      const actualizaciones = itemsSeleccionados.map(async (item) => {
        if (ajuste.tipo_carta === "platos") {
          return actualizarPlato.mutateAsync({ id: item.id, precio_eur: item.precioEditado });
        } else if (ajuste.tipo_carta === "bebidas") {
          return actualizarBebida.mutateAsync({ id: item.id, precio_eur: item.precioEditado });
        } else {
          return actualizarVino.mutateAsync({ id: item.id, precio_eur: item.precioEditado });
        }
      });

      await Promise.all(actualizaciones);
      toast.success(`${itemsSeleccionados.length} precio(s) actualizados correctamente`);
      onOpenChange(false);
    } catch (error) {
      toast.error("Error al actualizar precios");
      console.error(error);
    }
  };

  if (!ajuste) return null;

  const getTipoCartaLabel = (tipo: string) => {
    const labels: Record<string, string> = {
      platos: "Platos",
      bebidas: "Bebidas",
      vinos: "Vinos",
    };
    return labels[tipo] || tipo;
  };

  const todosSeleccionados = itemsFiltrados.length > 0 && itemsFiltrados.every(i => i.seleccionado);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>Restauración Parcial de Precios</DialogTitle>
          <DialogDescription>
            Selecciona items específicos y ajusta precios manualmente
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info del ajuste */}
          <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{getTipoCartaLabel(ajuste.tipo_carta)}</Badge>
              <span className="text-sm text-muted-foreground">
                {ajuste.categoria === "todas" ? "Todas las categorías" : ajuste.categoria}
              </span>
              <span className="text-sm text-muted-foreground">•</span>
              <span className="text-sm text-muted-foreground">
                {format(new Date(ajuste.fecha), "dd/MM/yyyy HH:mm", { locale: es })}
              </span>
            </div>
            <Badge variant="secondary">
              {itemsSeleccionados.length} de {items.length} seleccionados
            </Badge>
          </div>

          {/* Buscador */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar items..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="h-11 pl-9 text-base md:text-base"
            />
          </div>

          {/* Lista de items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={seleccionarTodos}
                className="h-11 px-3"
              >
                <Checkbox 
                  checked={todosSeleccionados}
                  className="mr-2"
                />
                {todosSeleccionados ? "Deseleccionar todos" : "Seleccionar todos"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Mostrando {itemsFiltrados.length} de {items.length} items
              </span>
            </div>

            <ScrollArea className="h-[min(400px,45dvh)] rounded-lg border">
              <div className="p-4 space-y-2">
                {itemsFiltrados.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-4">
                      <Checkbox
                        checked={item.seleccionado}
                        onCheckedChange={() => toggleSeleccion(item.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.nombre}</p>
                        <p className="text-xs text-muted-foreground">
                          Precio actual: {item.precioActual.toFixed(2)}€
                        </p>
                      </div>
                    </label>

                    <div className="flex items-center gap-3">
                      {editandoId === item.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            value={item.precioEditado}
                            onChange={(e) => actualizarPrecio(item.id, e.target.value)}
                            className="h-11 w-28 text-base md:text-base"
                            autoFocus
                            onBlur={() => setEditandoId(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") setEditandoId(null);
                            }}
                          />
                          <span className="text-sm">€</span>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditandoId(item.id)}
                          className="h-11 gap-2 px-3"
                          aria-label={`Editar el precio de ${item.nombre}`}
                        >
                          <span className="font-bold">{item.precioEditado.toFixed(2)}€</span>
                          <Edit3 className="h-4 w-4" />
                        </Button>
                      )}
                      
                      {item.precioEditado !== item.precioOriginal && (
                        <Badge variant="outline" className="text-xs">
                          Original: {item.precioOriginal.toFixed(2)}€
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 px-4" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            className="h-11 px-4"
            onClick={handleRestaurar}
            disabled={itemsSeleccionados.length === 0}
          >
            Aplicar a {itemsSeleccionados.length} item(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
