import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { AlertCircle, Loader2, MoreHorizontal, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

// Estado de EN/FR junto al botón Guardar: texto solo si hay algo que avisar
// (traduciendo / pendiente) y el detalle de cada idioma + «Reintentar» recogidos
// en un menú «⋯». Se deriva de updated_at (lo pone el trigger de configBotWeb),
// así que sobrevive a recargas: si ES se guardó y la traducción no llegó a
// escribirse, EN/FR salen como "Desactualizado" aunque ya no esté el error de la sesión.
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
      return { idioma, texto: "Traduciendo…", pendiente: false };
    }
    if (estado === "sin_traducir") {
      return { idioma, texto: "Sin traducir", pendiente: true };
    }
    if (estado === "desactualizado") {
      return { idioma, texto: "Desactualizado", pendiente: true };
    }
    return { idioma, texto: `Traducido · ${config ? haceCuanto(config.updated_at) : ""}`, pendiente: false };
  });

  const hayPendiente = !traduciendo && (errorTraduccion !== null || estados.some((e) => e.pendiente));

  return (
    <div className="flex items-center gap-1">
      {traduciendo && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Traduciendo…
        </span>
      )}
      {hayPendiente && (
        <span className="inline-flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {errorTraduccion ? `Traducción pendiente: ${errorTraduccion}` : "Traducciones pendientes"}
        </span>
      )}
      {/* EN / FR / Reintentar, en un menú «⋯» (antes dos insignias y un botón sueltos en la barra). */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="text-muted-foreground" aria-label="Traducciones EN y FR">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Traducciones automáticas</DropdownMenuLabel>
          {estados.map((e) => (
            <div key={e.idioma} className="flex items-center gap-2 px-2 py-1.5 text-sm" title={`${e.idioma.toUpperCase()}: ${e.texto}`}>
              <span className="w-6 font-semibold uppercase">{e.idioma}</span>
              <span className={cn("min-w-0 flex-1 truncate text-xs", e.pendiente ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                {e.texto}
              </span>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!puedeReintentar || traduciendo} onSelect={onReintentar}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            {hayPendiente ? "Reintentar traducción" : "Traducir de nuevo"}
          </DropdownMenuItem>
          {!puedeReintentar && <p className="px-2 pb-1.5 text-xs text-muted-foreground">Guarda primero los cambios en español.</p>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
