import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
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
// explicación larga de "qué efecto tiene en el bot" queda plegada tras un
// icono «i» de 44 px a la derecha de la etiqueta: no domina la pantalla y
// sigue a un toque.
export function CampoExplicado({ htmlFor, etiqueta, ayuda, efecto, accesorio, children, className }: CampoExplicadoProps) {
  const [abierto, setAbierto] = useState(false);

  return (
    <Collapsible open={abierto} onOpenChange={setAbierto} className={cn("space-y-2", className)}>
      <div className="flex items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 space-y-0.5">
          {htmlFor ? (
            <Label htmlFor={htmlFor}>{etiqueta}</Label>
          ) : (
            <p className="text-sm font-medium leading-none">{etiqueta}</p>
          )}
          {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
        </div>
        <div className="-my-2.5 flex shrink-0 items-center gap-1">
          {accesorio}
          {/* «Cómo afecta al bot»: icono de 44 px (antes un enlace de texto debajo de cada campo). */}
          {efecto && (
            <CollapsibleTrigger
              aria-label="Cómo afecta al bot"
              title="Cómo afecta al bot"
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                abierto && "text-foreground",
              )}
            >
              <Info className="h-4 w-4" aria-hidden="true" />
            </CollapsibleTrigger>
          )}
        </div>
      </div>
      {children}
      {efecto && (
        <CollapsibleContent className="border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">{efecto}</CollapsibleContent>
      )}
    </Collapsible>
  );
}
