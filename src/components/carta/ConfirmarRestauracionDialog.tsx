import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { usePlatos } from "@/hooks/usePlatos";
import { useBebidas } from "@/hooks/useBebidas";
import { useVinos } from "@/hooks/useVinos";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, ArrowRight, TrendingDown, TrendingUp } from "lucide-react";

interface ConfirmarRestauracionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ajuste: any;
  onConfirm: () => void;
}

interface ItemComparacion {
  id: string;
  nombre: string;
  precioActual: number;
  precioRestaurar: number;
  diferencia: number;
  diferenciaPorcentaje: number;
}

export function ConfirmarRestauracionDialog({ 
  open, 
  onOpenChange, 
  ajuste,
  onConfirm 
}: ConfirmarRestauracionDialogProps) {
  const [comparaciones, setComparaciones] = useState<ItemComparacion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const { platos } = usePlatos();
  const { bebidas } = useBebidas();
  const { vinos } = useVinos();

  useEffect(() => {
    if (!open || !ajuste) return;

    setIsLoading(true);
    
    // Obtener items actuales según el tipo
    let itemsActuales: any[] = [];
    if (ajuste.tipo_carta === "platos") {
      itemsActuales = platos || [];
    } else if (ajuste.tipo_carta === "bebidas") {
      itemsActuales = bebidas || [];
    } else {
      itemsActuales = vinos || [];
    }

    // Crear comparaciones
    const nuevasComparaciones: ItemComparacion[] = ajuste.snapshot.map((itemSnapshot: any) => {
      const itemActual = itemsActuales.find(i => i.id === itemSnapshot.id);
      const precioActual = itemActual?.precio_eur || 0;
      const precioRestaurar = itemSnapshot.precio_anterior;
      const diferencia = precioRestaurar - precioActual;
      const diferenciaPorcentaje = precioActual !== 0 
        ? ((diferencia / precioActual) * 100)
        : 0;

      return {
        id: itemSnapshot.id,
        nombre: itemSnapshot.nombre,
        precioActual,
        precioRestaurar,
        diferencia,
        diferenciaPorcentaje,
      };
    });

    setComparaciones(nuevasComparaciones);
    setIsLoading(false);
  }, [open, ajuste, platos, bebidas, vinos]);

  if (!ajuste) return null;

  const totalItems = comparaciones.length;
  const itemsConCambios = comparaciones.filter(c => Math.abs(c.diferencia) > 0.01).length;
  const aumentos = comparaciones.filter(c => c.diferencia > 0.01).length;
  const reducciones = comparaciones.filter(c => c.diferencia < -0.01).length;
  const diferenciaTotal = comparaciones.reduce((sum, c) => sum + c.diferencia, 0);

  const getTipoCartaLabel = (tipo: string) => {
    const labels: Record<string, string> = {
      platos: "Platos",
      bebidas: "Bebidas",
      vinos: "Vinos",
    };
    return labels[tipo] || tipo;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Confirmar Restauración de Precios
          </DialogTitle>
          <DialogDescription>
            Revisa los cambios antes de restaurar los precios
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Cargando comparación...</div>
        ) : (
          <div className="space-y-4">
            {/* Info del ajuste */}
            <div className="bg-muted/30 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{getTipoCartaLabel(ajuste.tipo_carta)}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {ajuste.categoria === "todas" ? "Todas las categorías" : ajuste.categoria}
                    </span>
                  </div>
                  <p className="text-sm font-medium">
                    Restaurar a: {format(new Date(ajuste.fecha), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
                  </p>
                </div>
              </div>
            </div>

            {/* Estadísticas */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-card border rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Total items</p>
                <p className="text-2xl font-bold">{totalItems}</p>
              </div>
              <div className="bg-card border rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Con cambios</p>
                <p className="text-2xl font-bold text-primary">{itemsConCambios}</p>
              </div>
              <div className="bg-card border rounded-lg p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  Aumentos
                </p>
                <p className="text-2xl font-bold text-green-600">{aumentos}</p>
              </div>
              <div className="bg-card border rounded-lg p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" />
                  Reducciones
                </p>
                <p className="text-2xl font-bold text-red-600">{reducciones}</p>
              </div>
            </div>

            {itemsConCambios === 0 && (
              <Alert>
                <AlertDescription>
                  Los precios actuales ya coinciden con los precios de este punto de restauración.
                  No se realizarán cambios.
                </AlertDescription>
              </Alert>
            )}

            {/* Lista de cambios */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Vista previa de cambios</h4>
              <ScrollArea className="h-[300px] rounded-lg border">
                <div className="p-4 space-y-2">
                  {comparaciones.map((item) => {
                    const sinCambio = Math.abs(item.diferencia) < 0.01;
                    
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          sinCambio 
                            ? "bg-muted/20 opacity-60" 
                            : item.diferencia > 0 
                              ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900" 
                              : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900"
                        }`}
                      >
                        <div className="flex-1">
                          <p className="font-medium text-sm">{item.nombre}</p>
                          {!sinCambio && (
                            <p className="text-xs text-muted-foreground">
                              {item.diferencia > 0 ? "+" : ""}{item.diferenciaPorcentaje.toFixed(1)}%
                            </p>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <span className={`text-sm font-medium ${sinCambio ? "text-muted-foreground" : ""}`}>
                            {item.precioActual.toFixed(2)}€
                          </span>
                          
                          {!sinCambio && (
                            <>
                              <ArrowRight className="h-4 w-4 text-muted-foreground" />
                              <span className={`text-sm font-bold ${
                                item.diferencia > 0 ? "text-green-600" : "text-red-600"
                              }`}>
                                {item.precioRestaurar.toFixed(2)}€
                              </span>
                            </>
                          )}
                          
                          {sinCambio && (
                            <Badge variant="outline" className="text-xs">Sin cambios</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            {/* Resumen */}
            {itemsConCambios > 0 && (
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-sm">
                  <span className="font-medium">Diferencia total:</span>{" "}
                  <span className={`font-bold ${diferenciaTotal > 0 ? "text-green-600" : "text-red-600"}`}>
                    {diferenciaTotal > 0 ? "+" : ""}{diferenciaTotal.toFixed(2)}€
                  </span>
                  {" "}en el valor total de la carta
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="h-11 px-4" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            className="h-11 px-4"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            disabled={isLoading || itemsConCambios === 0}
          >
            Confirmar Restauración
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
