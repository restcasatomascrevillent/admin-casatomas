import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
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

  const esAumentoExtremo = porcentaje > 15;
  const esReduccionExtrema = porcentaje < -15;
  const esExtremoMuyAlto = Math.abs(porcentaje) > 25;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
            Cambio de Precio Extremo Detectado
          </DialogTitle>
          <DialogDescription>
            Estás a punto de realizar un ajuste de precios significativo
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert variant={esExtremoMuyAlto ? "destructive" : "default"} className="border-warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>¡Atención! Cambio inusual de precios</AlertTitle>
            <AlertDescription className="space-y-2 mt-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span>Ajuste propuesto:</span>
                <Badge variant={porcentaje > 0 ? "destructive" : "secondary"} className="text-base">
                  {porcentaje > 0 ? "+" : ""}{porcentaje}%
                </Badge>
              </div>
              
              <div className="pt-2 space-y-1 text-sm">
                <p><strong>Tipo:</strong> {getTipoCartaLabel(tipoCarta)}</p>
                <p><strong>Categoría:</strong> {categoria === "todas" ? "Todas las categorías" : categoria}</p>
                <p><strong>Items afectados:</strong> {itemsAfectados} productos</p>
              </div>
            </AlertDescription>
          </Alert>

          {esExtremoMuyAlto && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>¡Advertencia crítica!</strong> Un ajuste mayor al 25% puede impactar significativamente
                en tus ventas y la percepción de los clientes. Por favor, revisa cuidadosamente esta decisión.
              </AlertDescription>
            </Alert>
          )}

          {esAumentoExtremo && !esExtremoMuyAlto && (
            <Alert>
              <AlertDescription>
                Un aumento considerable de precios puede afectar la demanda. Asegúrate de que este cambio
                esté justificado por el coste de los productos o cambios en el mercado.
              </AlertDescription>
            </Alert>
          )}

          {esReduccionExtrema && !esExtremoMuyAlto && (
            <Alert>
              <AlertDescription>
                Una reducción considerable de precios puede afectar tus márgenes de beneficio. Verifica que
                este ajuste sea sostenible para tu negocio.
              </AlertDescription>
            </Alert>
          )}

          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-sm font-medium mb-2">Recomendaciones:</p>
            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
              <li>Revisa el impacto en cada producto individualmente</li>
              <li>Considera hacer cambios graduales en lugar de un ajuste único</li>
              <li>Verifica que los nuevos precios sean competitivos</li>
              <li>Comunica los cambios a tu equipo antes de aplicarlos</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Cancelar y Revisar
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
