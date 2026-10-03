import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConfigBotWeb } from "@/hooks/useConfigBotWeb";
import { IDIOMAS_TRADUCIDOS, estadoTraduccion, type IdiomaTraducido } from "./traduccionBot";

interface EstadoTraduccionBadgesProps {
  configEs: ConfigBotWeb | null;
  configs: Record<IdiomaTraducido, ConfigBotWeb | null>;
  traduciendo: boolean;
  /** Mensaje del último fallo de traducción en esta sesión (ES quedó guardado). */
  errorTraduccion: string | null;
  onReintentar: () => void;
  puedeReintentar: boolean;
}

function haceCuanto(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? "" : formatDistanceToNow(fecha, { addSuffix: true, locale: es });
}

// Estado compacto de EN/FR junto al botón Guardar. Se deriva de updated_at
// (lo pone el trigger de configBotWeb), así que sobrevive a recargas: si ES
// se guardó y la traducción no llegó a escribirse, EN/FR salen como
// "Desactualizado" aunque ya no esté el error de la sesión.
export function EstadoTraduccionBadges({
  configEs,
  configs,
  traduciendo,
  errorTraduccion,
  onReintentar,
  puedeReintentar,
}: EstadoTraduccionBadgesProps) {
  const estados = IDIOMAS_TRADUCIDOS.map((idioma) => {
    const config = configs[idioma];
    const estado = estadoTraduccion(configEs, config);
    if (traduciendo) {
      return { idioma, texto: "Traduciendo…", clase: "text-muted-foreground", pendiente: false };
    }
    if (estado === "sin_traducir") {
      return { idioma, texto: "Sin traducir", clase: "border-amber-400 text-amber-700 dark:text-amber-400", pendiente: true };
    }
    if (estado === "desactualizado") {
      return { idioma, texto: "Desactualizado", clase: "border-amber-400 text-amber-700 dark:text-amber-400", pendiente: true };
    }
    return {
      idioma,
      texto: `Traducido · ${config ? haceCuanto(config.updated_at) : ""}`,
      clase: "text-muted-foreground",
      pendiente: false,
    };
  });

  const hayPendiente = !traduciendo && (errorTraduccion !== null || estados.some((e) => e.pendiente));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {errorTraduccion && !traduciendo && (
        <Badge variant="destructive" className="max-w-full items-start gap-1 whitespace-normal text-left font-normal">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            Traducción pendiente: {errorTraduccion}
          </span>
        </Badge>
      )}
      {estados.map((e) => (
        <Badge
          key={e.idioma}
          variant="outline"
          className={cn("gap-1 whitespace-nowrap font-normal", e.clase)}
          title={`${e.idioma.toUpperCase()}: ${e.texto}`}
        >
          {traduciendo && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          <span className="font-semibold uppercase">{e.idioma}</span>
          <span className="hidden md:inline">{e.texto}</span>
          <span className="sr-only md:hidden">{e.texto}</span>
        </Badge>
      ))}
      {hayPendiente && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 px-3 text-sm"
          onClick={onReintentar}
          disabled={!puedeReintentar}
          title={puedeReintentar ? "Traducir de nuevo lo último guardado en español" : "Guarda primero los cambios en español"}
        >
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
          Reintentar traducción
        </Button>
      )}
    </div>
  );
}
