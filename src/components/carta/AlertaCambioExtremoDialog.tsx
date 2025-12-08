import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface AlertaCambioExtremoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  porcentaje: number;
  tipoCarta: string;
  categoria: string;
  itemsAfectados: number;
  onConfirmar: () => void;
}

export function AlertaCambioExtremoDialog({
  open,
  onOpenChange,
  porcentaje,
  tipoCarta,
  categoria,
  itemsAfectados,
  onConfirmar,
}: AlertaCambioExtremoDialogProps) {
  const getTipoCartaLabel = (tipo: string) => {
    const labels: Record<string, string> = {
      platos: "Platos",
      bebidas: "Bebidas",
      vinos: "Vinos",
    };
    return labels[tipo] || tipo;
  };

  const UMBRAL_ALERTA = 10;
  const esExtremo = Math.abs(porcentaje) >= UMBRAL_ALERTA;
  const esAumentoExtremo = porcentaje > 15;
  const esReduccionExtrema = porcentaje < -15;
  const esExtremoMuyAlto = Math.abs(porcentaje) > 25;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {esExtremo ? (
              <AlertTriangle className="h-5 w-5 text-warning" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-primary" />
            )}
            Confirmar Ajuste de Precios
          </DialogTitle>
          <DialogDescription>
            {esExtremo 
              ? "Este cambio supera el umbral recomendado. Por favor, confirma que deseas continuar."
              : "Revisa los detalles antes de aplicar el cambio."
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Ajuste:</span>
              <Badge variant={porcentaje > 0 ? "destructive" : "secondary"} className="text-base">
                {porcentaje > 0 ? "+" : ""}{porcentaje}%
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Tipo:</span>
              <span className="font-medium">{getTipoCartaLabel(tipoCarta)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Categoría:</span>
              <span className="font-medium">{categoria === "todas" ? "Todas" : categoria}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Items afectados:</span>
              <span className="font-medium">{itemsAfectados} productos</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-muted-foreground">Redondeo:</span>
              <span className="text-xs text-muted-foreground">
                Los precios se ajustarán a .00 o .50
              </span>
            </div>
          </div>

          {esExtremoMuyAlto && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>¡Advertencia!</AlertTitle>
              <AlertDescription>
                Un ajuste mayor al 25% puede impactar significativamente
                en tus ventas y la percepción de los clientes.
              </AlertDescription>
            </Alert>
          )}

          {esAumentoExtremo && !esExtremoMuyAlto && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Un aumento de más del 15% puede afectar la demanda. Verifica que esté justificado.
              </AlertDescription>
            </Alert>
          )}

          {esReduccionExtrema && !esExtremoMuyAlto && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Una reducción de más del 15% puede afectar tus márgenes de beneficio.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Cancelar
          </Button>
          <Button 
            onClick={() => {
              onConfirmar();
              onOpenChange(false);
            }}
            variant={esExtremoMuyAlto ? "destructive" : "default"}
            className="w-full sm:w-auto"
          >
            Confirmar Ajuste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
