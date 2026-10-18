import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useConfiguracionWeb, type BotonMenuTapas } from "@/hooks/useConfiguracionWeb";

export function InterruptorMenuTapas({ boton }: { boton: BotonMenuTapas }) {
  const id = useId();
  const { mostrarBotonesMenuTapas, botonesMenuTapasDisponibles, isLoading, isError, cambiarBotonMenuTapas } = useConfiguracionWeb();
  const nombre = boton === "menu" ? "Menú del día" : "Tapas";
  // Sin la explicación de qué hace el interruptor (2026-10-18, petición del dueño): se
  // entiende solo. El aviso de carga/error sí se queda, porque ahí sí hay algo que decir.
  const aviso = isLoading
    ? "Cargando..."
    : isError
      ? "No se pudo cargar la configuración."
      : !botonesMenuTapasDisponibles
        ? "Falta aplicar la actualización de configuración en la base de datos."
        : null;
  return (
    <Card data-tour="gw-menu-interruptor">
      <CardContent className="space-y-1 p-4">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <Label htmlFor={id} className="cursor-pointer">Mostrar «{nombre}» en la web de Casa Tomás</Label>
          <Switch id={id} checked={mostrarBotonesMenuTapas[boton]}
            disabled={isLoading || isError || !botonesMenuTapasDisponibles || cambiarBotonMenuTapas.isPending}
            onCheckedChange={(mostrar) => cambiarBotonMenuTapas.mutate({ boton, mostrar })} />
        </div>
        {aviso && <p className="text-xs text-muted-foreground">{aviso}</p>}
      </CardContent>
    </Card>
  );
}
