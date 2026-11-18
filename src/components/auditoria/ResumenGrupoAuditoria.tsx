import { ChevronRight } from "lucide-react";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ACCION_UI } from "./TablaEntradasAuditoria";
import type { DesgloseAccion } from "@/hooks/useAuditLog";

/** En el móvil se ven los tipos de acción más frecuentes; el resto, como «+N más». */
const VISIBLES_MOVIL = 3;

/**
 * Cabecera plegable de un bloque de mes o de día: la etiqueta ("Octubre
 * 2026", "Hoy · Miércoles, 18 de noviembre de 2026"), cuántos registros y
 * personas tiene y un desglose rápido por tipo de acción (punto de color,
 * nombre y número), para revisar sin tener que desplegar cada bloque.
 */
export function ResumenGrupoAuditoria({
  etiqueta,
  totalRegistros,
  desglosePorAccion,
  actoresDistintos,
  nivel,
  className,
}: {
  etiqueta: string;
  totalRegistros: number;
  desglosePorAccion: DesgloseAccion[];
  actoresDistintos: number;
  /** El mes se ve como título de sección; el día, un peldaño más discreto dentro de él. */
  nivel: "mes" | "dia";
  className?: string;
}) {
  const ocultos = desglosePorAccion.length - VISIBLES_MOVIL;
  return (
    <CollapsibleTrigger
      className={cn(
        "group flex w-full items-start gap-2.5 px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none pointer-coarse:min-h-11 lg:px-4",
        className,
      )}
    >
      <ChevronRight
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block font-semibold text-foreground",
            nivel === "mes" ? "text-base" : "text-sm",
          )}
        >
          {etiqueta}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
          {totalRegistros.toLocaleString("es-ES")} registro{totalRegistros === 1 ? "" : "s"}
          {" · "}
          {actoresDistintos === 1
            ? "1 persona u origen"
            : `${actoresDistintos} personas u orígenes distintos`}
        </span>
        {desglosePorAccion.length > 0 && (
          <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {desglosePorAccion.map(({ accion, cantidad }, indice) => {
              const ui = ACCION_UI[accion] ?? ACCION_UI.actualizar;
              return (
                <span
                  key={accion}
                  className={cn(
                    "items-center gap-1.5 whitespace-nowrap",
                    indice < VISIBLES_MOVIL ? "inline-flex" : "hidden md:inline-flex",
                  )}
                >
                  <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", ui.punto)} />
                  {ui.label}
                  <span className="font-medium tabular-nums text-foreground/80">{cantidad}</span>
                </span>
              );
            })}
            {ocultos > 0 && (
              <span className="whitespace-nowrap md:hidden">
                +{ocultos} más
              </span>
            )}
          </span>
        )}
      </span>
    </CollapsibleTrigger>
  );
}
