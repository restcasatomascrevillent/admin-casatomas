import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHistorialAjustes } from "@/hooks/useHistorialAjustes";
import { usePlatos } from "@/hooks/usePlatos";
import { useBebidas } from "@/hooks/useBebidas";
import { useVinos } from "@/hooks/useVinos";
import { ConfirmarRestauracionDialog } from "./ConfirmarRestauracionDialog";
import { RestauracionParcialDialog } from "./RestauracionParcialDialog";
import { GraficoEvolucionPrecios } from "./GraficoEvolucionPrecios";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AlertCircle, RotateCcw, Trash2, CheckSquare } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface HistorialAjustesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HistorialAjustesDialog({ open, onOpenChange }: HistorialAjustesDialogProps) {
  const [ajusteSeleccionado, setAjusteSeleccionado] = useState<any>(null);
  const [confirmarOpen, setConfirmarOpen] = useState(false);
  const [restauracionParcialOpen, setRestauracionParcialOpen] = useState(false);
  
  const { historial, isLoading, eliminarAjuste } = useHistorialAjustes();
  const { actualizarPlato } = usePlatos();
  const { actualizarBebida } = useBebidas();
  const { actualizarVino } = useVinos();

  const handleAbrirConfirmacion = (ajuste: any) => {
    setAjusteSeleccionado(ajuste);
    setConfirmarOpen(true);
  };

  const handleAbrirRestauracionParcial = (ajuste: any) => {
    setAjusteSeleccionado(ajuste);
    setRestauracionParcialOpen(true);
  };

  const handleRestaurar = async () => {
    if (!ajusteSeleccionado) return;
    
    try {
      const actualizaciones = ajusteSeleccionado.snapshot.map(async (item: any) => {
        if (ajusteSeleccionado.tipo_carta === "platos") {
          return actualizarPlato.mutateAsync({ id: item.id, precio_eur: item.precio_anterior });
        } else if (ajusteSeleccionado.tipo_carta === "bebidas") {
          return actualizarBebida.mutateAsync({ id: item.id, precio_eur: item.precio_anterior });
        } else {
          return actualizarVino.mutateAsync({ id: item.id, precio_eur: item.precio_anterior });
        }
      });

      await Promise.all(actualizaciones);
      toast.success(`Precios restaurados a ${format(new Date(ajusteSeleccionado.fecha), "dd/MM/yyyy HH:mm", { locale: es })}`);
    } catch (error) {
      toast.error("Error al restaurar precios");
      console.error(error);
    }
  };

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
      <DialogContent className="sm:max-w-[900px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Historial de Ajustes de Precios</DialogTitle>
          <DialogDescription>
            Revisa los ajustes realizados, restaura precios o analiza la evolución
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="historial" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="historial">Historial</TabsTrigger>
            <TabsTrigger value="grafico">Evolución</TabsTrigger>
          </TabsList>

          <TabsContent value="historial" className="mt-4">
            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground">Cargando historial...</div>
            ) : !historial || historial.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No hay ajustes de precios registrados todavía.
                </AlertDescription>
              </Alert>
            ) : (
              <ScrollArea className="h-[500px] pr-4">
                <div className="space-y-4">
                  {historial.map((ajuste) => (
                    <div
                      key={ajuste.id}
                      className="border rounded-lg p-4 space-y-3 hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{getTipoCartaLabel(ajuste.tipo_carta)}</Badge>
                            <span className="text-sm text-muted-foreground">
                              {ajuste.categoria === "todas" ? "Todas las categorías" : ajuste.categoria}
                            </span>
                          </div>
                          <p className="text-sm font-medium">
                            Ajuste: {ajuste.porcentaje > 0 ? "+" : ""}{ajuste.porcentaje}%
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(ajuste.fecha), "dd/MM/yyyy 'a las' HH:mm", { locale: es })} •{" "}
                            {ajuste.items_afectados} item(s) afectados
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAbrirRestauracionParcial(ajuste)}
                            className="gap-2"
                          >
                            <CheckSquare className="h-4 w-4" />
                            Parcial
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAbrirConfirmacion(ajuste)}
                            className="gap-2"
                          >
                            <RotateCcw className="h-4 w-4" />
                            Restaurar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => eliminarAjuste.mutate(ajuste.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          Ver detalles ({ajuste.snapshot.length} items)
                        </summary>
                        <div className="mt-2 space-y-1 pl-4 border-l-2 border-muted">
                          {ajuste.snapshot.slice(0, 10).map((item: any, idx: number) => (
                            <div key={idx} className="flex justify-between py-1">
                              <span className="text-muted-foreground">{item.nombre}</span>
                              <span>
                                {item.precio_anterior.toFixed(2)}€ → {item.precio_nuevo.toFixed(2)}€
                              </span>
                            </div>
                          ))}
                          {ajuste.snapshot.length > 10 && (
                            <p className="text-muted-foreground italic">
                              ... y {ajuste.snapshot.length - 10} items más
                            </p>
                          )}
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="grafico" className="mt-4">
            <GraficoEvolucionPrecios />
          </TabsContent>
        </Tabs>
      </DialogContent>
      
      <ConfirmarRestauracionDialog
        open={confirmarOpen}
        onOpenChange={setConfirmarOpen}
        ajuste={ajusteSeleccionado}
        onConfirm={handleRestaurar}
      />

      <RestauracionParcialDialog
        open={restauracionParcialOpen}
        onOpenChange={setRestauracionParcialOpen}
        ajuste={ajusteSeleccionado}
      />
    </Dialog>
  );
}
