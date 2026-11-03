import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { ACCION_UI } from "./TablaEntradasAuditoria";
import type { DesgloseAccion } from "@/hooks/useAuditLog";

/**
 * Cabecera plegable de un bloque de mes o de día: la etiqueta ("Octubre
 * 2026", "Jueves, 9 de octubre de 2026"), cuántos registros tiene y un
 * desglose rápido por tipo de acción, para revisar sin tener que desplegar
 * cada bloque uno a uno.
 */
export function ResumenGrupoAuditoria({
  etiqueta,
  totalRegistros,
  desglosePorAccion,
  actoresDistintos,
  nivel,
}: {
  etiqueta: string;
  totalRegistros: number;
  desglosePorAccion: DesgloseAccion[];
  actoresDistintos: number;
  /** El mes se ve como título de sección; el día, un peldaño más discreto dentro de él. */
  nivel: "mes" | "dia";
}) {
  return (
    <CollapsibleTrigger className="group flex w-full flex-wrap items-center gap-2 rounded-md px-3 py-2.5 text-left pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <ChevronDown
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
        aria-hidden
      />
      <span className={nivel === "mes" ? "text-base font-semibold text-foreground" : "text-sm font-medium text-foreground"}>
        {etiqueta}
      </span>
      <Badge variant="secondary" className="font-normal tabular-nums">
        {totalRegistros} registro{totalRegistros === 1 ? "" : "s"}
      </Badge>
      {actoresDistintos > 1 && (
        <span className="text-xs text-muted-foreground">{actoresDistintos} personas u orígenes distintos</span>
      )}
      <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
        {desglosePorAccion.map(({ accion, cantidad }) => {
          const ui = ACCION_UI[accion] ?? ACCION_UI.actualizar;
          return (
            <Badge key={accion} variant="outline" className={`gap-1 px-1.5 py-0 text-[11px] pointer-coarse:text-xs font-normal tabular-nums ${ui.className}`}>
              {ui.label} · {cantidad}
            </Badge>
          );
        })}
      </span>
    </CollapsibleTrigger>
  );
}
