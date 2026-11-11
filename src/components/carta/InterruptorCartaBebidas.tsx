import { useId } from "react";
import { Beer } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useConfiguracionWeb } from "@/hooks/useConfiguracionWeb";

/**
 * Gestor web › Carta › Bebidas: ¿sale la carta de Bebidas en la web? (11/11/2026, petición del dueño:
 * «Desactiva de la web la carta de Bebidas… por defecto no»). Apagada, la página /carta/bebidas de la
 * web no sale y llevan a la carta. No toca las bebidas guardadas: al encenderla vuelven tal cual.
 * Con solo «Ver», se lee el estado sin interruptor.
 */
export function InterruptorCartaBebidas({ soloLectura = false }: { soloLectura?: boolean }) {
  const id = useId();
  const { mostrarCartaBebidas, cartaBebidasDisponible, noDisponible, isLoading, isError, cambiarCartaBebidas } = useConfiguracionWeb();
  const sinColumna = !isLoading && !isError && !noDisponible && !cartaBebidasDisponible;
  const deshabilitado = isLoading || isError || noDisponible || sinColumna || cambiarCartaBebidas.isPending;
  const estado = mostrarCartaBebidas
    ? "Encendida: la web enseña la carta de bebidas."
    : "Apagada: la web no enseña la carta de bebidas (la página lleva a la carta).";

  return (
    <div className="rounded-md border bg-muted/30 px-4 py-3" data-testid="interruptor-carta-bebidas">
      {soloLectura ? (
        <p className="flex min-h-11 items-center gap-2 text-sm">
          <Beer className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            <span className="font-medium">Carta de bebidas en la web.</span> {estado}
          </span>
        </p>
      ) : (
        <>
          <div className="flex min-h-11 items-center gap-2">
            <Switch
              id={id}
              checked={mostrarCartaBebidas}
              disabled={deshabilitado}
              onCheckedChange={(mostrar) => cambiarCartaBebidas.mutate(mostrar)}
            />
            <Label htmlFor={id} className="cursor-pointer py-3 text-sm font-medium">
              Carta de bebidas en la web
            </Label>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {noDisponible || sinColumna
              ? "Disponible cuando se aplique la migración de la carta de bebidas. Mientras tanto la web no la enseña."
              : isError
                ? "No se ha podido leer la configuración de la web."
                : `${estado} Las bebidas no se borran.`}
          </p>
        </>
      )}
    </div>
  );
}
