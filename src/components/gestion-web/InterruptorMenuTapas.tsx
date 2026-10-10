import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useConfiguracionWeb, type BotonMenuTapas } from "@/hooks/useConfiguracionWeb";

export function InterruptorMenuTapas({ boton }: { boton: BotonMenuTapas }) {
  const id = useId();
  const { mostrarBotonesMenuTapas, botonesMenuTapasDisponibles, isLoading, isError, cambiarBotonMenuTapas } = useConfiguracionWeb();
  const nombre = boton === "menu" ? "Menú del día" : "Tapas";
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3" data-tour="gw-menu-interruptor">
      <div className="flex min-h-11 items-center justify-between gap-4">
        <Label htmlFor={id} className="cursor-pointer">Mostrar «{nombre}» en la web de Casa Tomás</Label>
        <Switch id={id} checked={mostrarBotonesMenuTapas[boton]}
          disabled={isLoading || isError || !botonesMenuTapasDisponibles || cambiarBotonMenuTapas.isPending}
          onCheckedChange={(mostrar) => cambiarBotonMenuTapas.mutate({ boton, mostrar })} />
      </div>
      <p className="text-xs text-muted-foreground">
        {isLoading ? "Cargando..." : isError ? "No se pudo cargar la configuración."
          : !botonesMenuTapasDisponibles ? "Falta aplicar la actualización de configuración en la base de datos."
          : "Al desactivarlo, el botón y su tarjeta se ocultan. El contenido guardado se conserva."}
      </p>
    </div>
  );
}
