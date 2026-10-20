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
  const { entradas, loading, error, truncado, refetch } = useAuditLogAgrupado(filtros, rango);
  const meses = useMemo(() => agruparPorMes(entradas), [entradas]);

  return (
    <div className="flex flex-col gap-3">
      <SelectorRangoMeses
        rango={rango}
        onRangoChange={onRangoChange}
        usandoFiltroFechas={Boolean(filtros.desde || filtros.hasta)}
        truncado={truncado}
        total={entradas.length}
        loading={loading}
        onActualizar={refetch}
      />
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive py-4">Error al cargar la auditoría: {error}</p>
      ) : meses.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No hay registros en este rango.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {meses.map((mes, indice) => (
            <Collapsible key={mes.key} defaultOpen={indice === 0} className="rounded-lg border border-border bg-card">
              <ResumenGrupoAuditoria
                etiqueta={mes.etiqueta}
                totalRegistros={mes.totalRegistros}
                desglosePorAccion={mes.desglosePorAccion}
                actoresDistintos={new Set(mes.dias.flatMap((d) => d.entradas.map(identificarActor))).size}
                nivel="mes"
              />
              <CollapsibleContent className="flex flex-col gap-2 border-t border-border/60 p-2">
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
