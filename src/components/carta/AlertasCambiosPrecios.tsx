import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHistorialAjustes } from "@/hooks/useHistorialAjustes";
import { AlertTriangle, Settings, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function AlertasCambiosPrecios() {
  const { historial } = useHistorialAjustes();
  const [umbralAlerta, setUmbralAlerta] = useState<number>(10); // 10% por defecto
  const [alertas, setAlertas] = useState<any[]>([]);
  const [alertasVisibles, setAlertasVisibles] = useState<string[]>([]);
  const [configuracionAbierta, setConfiguracionAbierta] = useState(false);

  useEffect(() => {
    if (!historial || historial.length === 0) return;

    const nuevasAlertas: any[] = [];

    historial.forEach((ajuste) => {
      // Si el ajuste supera el umbral
      if (Math.abs(ajuste.porcentaje) >= umbralAlerta) {
        // Verificar si ya se mostró esta alerta
        const alertaId = `${ajuste.id}`;
        const yaVista = localStorage.getItem(`alerta_vista_${alertaId}`);
        
        if (!yaVista) {
          nuevasAlertas.push({
            id: alertaId,
            tipo_carta: ajuste.tipo_carta,
            categoria: ajuste.categoria,
            porcentaje: ajuste.porcentaje,
            items_afectados: ajuste.items_afectados,
            fecha: ajuste.fecha,
          });
        }
      }
    });

    setAlertas(nuevasAlertas);
    setAlertasVisibles(nuevasAlertas.map(a => a.id));
  }, [historial, umbralAlerta]);

  const cerrarAlerta = (alertaId: string) => {
    localStorage.setItem(`alerta_vista_${alertaId}`, "true");
    setAlertasVisibles(prev => prev.filter(id => id !== alertaId));
  };

  const limpiarHistorialAlertas = () => {
    alertas.forEach(alerta => {
      localStorage.removeItem(`alerta_vista_${alerta.id}`);
    });
    // Recargar alertas
    const nuevasAlertas = alertas.map(a => a.id);
    setAlertasVisibles(nuevasAlertas);
  };

  const getTipoCartaLabel = (tipo: string) => {
    const labels: Record<string, string> = {
      platos: "Platos",
      bebidas: "Bebidas",
      vinos: "Vinos",
    };
    return labels[tipo] || tipo;
  };

  const alertasActivas = alertas.filter(a => alertasVisibles.includes(a.id));

  if (alertasActivas.length === 0 && !configuracionAbierta) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Configuración */}
      <Card>
        <Collapsible open={configuracionAbierta} onOpenChange={setConfiguracionAbierta}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <div className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  <CardTitle className="text-base">Configuración de Alertas</CardTitle>
                </div>
                <Badge variant="secondary">
                  {alertasActivas.length} alerta(s)
                </Badge>
              </div>
            </CollapsibleTrigger>
            <CardDescription>
              Recibe alertas automáticas cuando los precios cambien más de un porcentaje específico
            </CardDescription>
          </CardHeader>
          
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="umbral">Umbral de alerta (%)</Label>
                <div className="flex gap-2">
                  <Input
                    id="umbral"
                    type="number"
                    min="1"
                    max="100"
                    value={umbralAlerta}
                    onChange={(e) => setUmbralAlerta(Number(e.target.value))}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground flex items-center">
                    Alertar si el cambio es ≥ {umbralAlerta}%
                  </span>
                </div>
              </div>

              {alertasActivas.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={limpiarHistorialAlertas}
                >
                  Mostrar alertas cerradas
                </Button>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Alertas activas */}
      {alertasActivas.map((alerta) => (
        <Alert
          key={alerta.id}
          variant="destructive"
          className="relative"
        >
          <AlertTriangle className="h-4 w-4" />
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 h-6 w-6 p-0"
            onClick={() => cerrarAlerta(alerta.id)}
          >
            <X className="h-4 w-4" />
          </Button>
          <AlertTitle className="flex items-center gap-2">
            Cambio extremo de precios detectado
            <Badge variant="outline">
              {alerta.porcentaje > 0 ? "+" : ""}{alerta.porcentaje}%
            </Badge>
          </AlertTitle>
          <AlertDescription className="space-y-1">
            <p>
              Se ha registrado un ajuste de <strong>{Math.abs(alerta.porcentaje)}%</strong> en{" "}
              <strong>{getTipoCartaLabel(alerta.tipo_carta)}</strong>
              {alerta.categoria !== "todas" && ` - categoría: ${alerta.categoria}`}
            </p>
            <p className="text-xs">
              {alerta.items_afectados} item(s) afectados • {new Date(alerta.fecha).toLocaleString("es-ES")}
            </p>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
