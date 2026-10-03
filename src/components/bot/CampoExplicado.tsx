import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface CampoExplicadoProps {
  /** id del control, para enlazar la etiqueta (omitir si el hijo es un grupo). */
  htmlFor?: string;
  etiqueta: string;
  /** Texto corto bajo la etiqueta: qué es el campo. */
  ayuda?: ReactNode;
  /** Explicación larga del efecto real en el bot — plegada por defecto. */
  efecto?: ReactNode;
  /** Contenido alineado a la derecha de la etiqueta (contadores, acciones). */
  accesorio?: ReactNode;
  children: ReactNode;
  className?: string;
}

// Campo dentro de una sección: etiqueta + ayuda de una línea + control. La
// explicación larga de "qué efecto tiene en el bot" (antes siempre visible
// en una caja por campo) queda plegada tras un disparador pequeño para no
// dominar la pantalla, pero sigue a un clic.
export function CampoExplicado({ htmlFor, etiqueta, ayuda, efecto, accesorio, children, className }: CampoExplicadoProps) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 space-y-0.5">
          {htmlFor ? (
            <Label htmlFor={htmlFor}>{etiqueta}</Label>
          ) : (
            <p className="text-sm font-medium leading-none">{etiqueta}</p>
          )}
          {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
        </div>
        {accesorio && <div className="flex shrink-0 items-center gap-2">{accesorio}</div>}
      </div>
      {children}
      {efecto && (
        <Collapsible open={abierto} onOpenChange={setAbierto}>
          <CollapsibleTrigger className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRight className={cn("h-3 w-3 transition-transform", abierto && "rotate-90")} aria-hidden="true" />
            Cómo afecta al bot
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1.5 text-sm leading-relaxed text-muted-foreground">{efecto}</CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
