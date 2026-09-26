import { useState } from "react";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ConfigBotWeb } from "@/hooks/useConfigBotWeb";
import { IDIOMAS } from "./constantesBot";
import { IDIOMAS_TRADUCIDOS, type IdiomaTraducido } from "./traduccionBot";

interface TraduccionesBotProps {
  configs: Record<IdiomaTraducido, ConfigBotWeb | null>;
  traduciendo: boolean;
  puedeRetraducir: boolean;
  onRetraducir: () => void;
}

function Bloque({ titulo, texto }: { titulo: string; texto: string | undefined }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      {texto?.trim() ? (
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2 font-sans text-xs leading-relaxed">{texto}</pre>
      ) : (
        <p className="text-xs italic text-muted-foreground">(vacío)</p>
      )}
    </div>
  );
}

// Solo lectura: lo que de verdad lee chat-web en las filas EN/FR. Plegado por
// defecto — el dueño edita en español y esto está para revisar, no para
// escribir.
export function TraduccionesBot({ configs, traduciendo, puedeRetraducir, onRetraducir }: TraduccionesBotProps) {
  const [abierto, setAbierto] = useState(false);

  return (
    <Card className="p-4">
      <Collapsible open={abierto} onOpenChange={setAbierto}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-sm text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", abierto && "rotate-180")} aria-hidden="true" />
              Ver traducciones
            </button>
          </CollapsibleTrigger>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={onRetraducir}
            disabled={traduciendo || !puedeRetraducir}
            title={puedeRetraducir ? "Traducir de nuevo lo último guardado en español" : "Guarda primero los cambios en español"}
          >
            {traduciendo ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
            )}
            Retraducir ahora
          </Button>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Inglés y francés se generan solos al guardar el español. Platos y vinos usan el nombre traducido de la Carta.
        </p>
        <CollapsibleContent className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {IDIOMAS_TRADUCIDOS.map((idioma) => {
              const config = configs[idioma];
              const label = IDIOMAS.find((i) => i.value === idioma)?.label ?? idioma;
              return (
                <div key={idioma} className="space-y-3 rounded-md border p-3">
                  <p className="text-sm font-semibold">
                    <span className="uppercase">{idioma}</span> <span className="font-normal text-muted-foreground">{label}</span>
                  </p>
                  {config ? (
                    <>
                      <Bloque titulo="Mensaje de bienvenida" texto={config.mensaje_bienvenida} />
                      <Bloque titulo="Instrucciones extra" texto={config.instrucciones_extra} />
                    </>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">Todavía no hay fila para este idioma.</p>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
