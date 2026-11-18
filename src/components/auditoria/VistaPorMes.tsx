import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { agruparPorMes, identificarActor, useAuditLogAgrupado, type AuditLogFiltros, type RangoMesesAuditoria } from "@/hooks/useAuditLog";
import { GrupoDiaAuditoria } from "./GrupoDiaAuditoria";
import { ResumenGrupoAuditoria } from "./ResumenGrupoAuditoria";
import { SelectorRangoMeses } from "./SelectorRangoMeses";

/**
 * Pestaña "Por mes": un bloque plegable por mes (del más reciente al más
 * antiguo) y, dentro, un bloque por día. Pensada para repasar un mes
 * completo sin perder de vista cuántos registros tiene cada día.
 */
export function VistaPorMes({
  filtros,
  rango,
  onRangoChange,
  expandidasFilas,
  onToggleFila,
}: {
  filtros: AuditLogFiltros;
  rango: RangoMesesAuditoria;
  onRangoChange: (rango: RangoMesesAuditoria) => void;
  expandidasFilas: Set<string>;
  onToggleFila: (key: string) => void;
}) {
  const { entradas, loading, error, truncado } = useAuditLogAgrupado(filtros, rango);
  const meses = useMemo(() => agruparPorMes(entradas), [entradas]);

  return (
    <div className="flex flex-col gap-3">
      <SelectorRangoMeses
        rango={rango}
        onRangoChange={onRangoChange}
        usandoFiltroFechas={Boolean(filtros.desde || filtros.hasta)}
        truncado={truncado}
        total={entradas.length}
      />
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-3 text-sm text-destructive">No se pudo cargar la auditoría: {error}</p>
      ) : meses.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No hay registros en este periodo con estos filtros.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {meses.map((mes, indice) => (
            <Collapsible key={mes.key} defaultOpen={indice === 0} className="overflow-hidden rounded-lg border border-border bg-card">
              <ResumenGrupoAuditoria
                etiqueta={mes.etiqueta}
                totalRegistros={mes.totalRegistros}
                desglosePorAccion={mes.desglosePorAccion}
                actoresDistintos={new Set(mes.dias.flatMap((d) => d.entradas.map(identificarActor))).size}
                nivel="mes"
              />
              <CollapsibleContent className="divide-y divide-border/60 border-t border-border/60">
                {mes.dias.map((dia, indiceDia) => (
                  <GrupoDiaAuditoria
                    key={dia.key}
                    dia={dia}
                    abiertoPorDefecto={indice === 0 && indiceDia === 0}
                    expandidasFilas={expandidasFilas}
                    onToggleFila={onToggleFila}
                    anidado
                  />
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      )}
    </div>
  );
}
