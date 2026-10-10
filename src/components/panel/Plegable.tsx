import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Acordeón de un solo bloque, plegado por defecto: una línea de título (44 px con dedo) con un chevron, y el
 * contenido debajo con una raya fina. Para configuración o instrucciones que se usan poco y no deben comerse la
 * pantalla. El contenido sigue en el DOM al plegarse solo si `forzarMontaje` (para no perder estado de formularios).
 *
 *   <Plegable titulo="Configuración Google Places" icono={<Settings />} resumen="Place ID configurado">…</Plegable>
 */
interface PlegableProps {
  titulo: ReactNode;
  /** Texto gris a la derecha del título (estado en una frase). */
  resumen?: ReactNode;
  icono?: ReactNode;
  children: ReactNode;
  abiertoPorDefecto?: boolean;
  forzarMontaje?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function Plegable({ titulo, resumen, icono, children, abiertoPorDefecto = false, forzarMontaje, className, "data-testid": testId }: PlegableProps) {
  const [abierto, setAbierto] = useState(abiertoPorDefecto);
  return (
    <Collapsible open={abierto} onOpenChange={setAbierto} className={cn("shrink-0 border-b border-border/60", className)} data-testid={testId}>
      <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2 rounded-sm py-2 text-left text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {icono && (
          <span aria-hidden="true" className="inline-flex shrink-0 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">
            {icono}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{titulo}</span>
        {resumen && <span className="hidden truncate text-xs font-normal text-muted-foreground sm:block">{resumen}</span>}
        <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent forceMount={forzarMontaje ? true : undefined} className={cn("pb-3 pt-1", forzarMontaje && !abierto && "hidden")}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
