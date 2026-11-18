import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { agruparPorDia, useAuditLogAgrupado, type AuditLogFiltros, type RangoMesesAuditoria } from "@/hooks/useAuditLog";
import { GrupoDiaAuditoria } from "./GrupoDiaAuditoria";
import { SelectorRangoMeses } from "./SelectorRangoMeses";

/**
 * Pestaña "Por día": un bloque plegable por día, del más reciente al más
 * antiguo, con la hora dentro de cada uno. Pensada para repasar "qué pasó
 * ayer" o "qué pasó el día X" sin tener que ir pasando páginas de 25.
 */
export function VistaPorDia({
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
  const dias = useMemo(() => agruparPorDia(entradas), [entradas]);

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
      ) : dias.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No hay registros en este periodo con estos filtros.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {dias.map((dia, indice) => (
            <GrupoDiaAuditoria
              key={dia.key}
              dia={dia}
              abiertoPorDefecto={indice === 0}
              expandidasFilas={expandidasFilas}
              onToggleFila={onToggleFila}
            />
          ))}
        </div>
      )}
    </div>
  );
}
