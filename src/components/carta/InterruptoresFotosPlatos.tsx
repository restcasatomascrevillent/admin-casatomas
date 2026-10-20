import { useId } from "react";
import { ImageOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useConfiguracionWeb, type WebPublica } from "@/hooks/useConfiguracionWeb";

const WEBS: { web: WebPublica; etiqueta: string }[] = [
  { web: "casa_tomas", etiqueta: "Fotos de platos en Casa Tomás" },
  { web: "touza", etiqueta: "Fotos de platos en Touza" },
];

/**
 * Interruptor GLOBAL por web: apagado, esa web no enseña ninguna foto de plato
 * (ni hueco ni placeholder). No toca las fotos guardadas en cada plato: al
 * volver a encenderlo, reaparecen tal cual.
 *
 * Si la migración `configuracion_web` aún no está aplicada, los interruptores
 * salen deshabilitados con un aviso discreto (las webs, mientras tanto, siguen
 * enseñando las fotos como siempre).
 */
export function InterruptoresFotosPlatos() {
  const baseId = useId();
  const { mostrarFotosPlatos, noDisponible, isLoading, isError, cambiarFotosPlatos } = useConfiguracionWeb();
  const deshabilitado = isLoading || isError || noDisponible || cambiarFotosPlatos.isPending;

  return (
    <div className="rounded-md border bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {WEBS.map(({ web, etiqueta }) => {
          const id = `${baseId}-${web}`;
          return (
            <div key={web} className="flex min-h-11 items-center gap-2">
              <Switch
                id={id}
                checked={mostrarFotosPlatos[web]}
                disabled={deshabilitado}
                onCheckedChange={(mostrar) => cambiarFotosPlatos.mutate({ web, mostrar })}
              />
              <Label htmlFor={id} className="cursor-pointer py-3 text-sm font-normal">
                {etiqueta}
              </Label>
            </div>
          );
        })}
      </div>
      {noDisponible ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
          Disponible cuando se aplique la migración de configuración de la web. Mientras tanto las webs enseñan las fotos.
        </p>
      ) : isError ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No se ha podido leer la configuración de la web. Las webs siguen enseñando las fotos.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Apagado, esa web no enseña ninguna foto de plato. Las fotos de cada plato no se borran.
        </p>
      )}
    </div>
  );
}
