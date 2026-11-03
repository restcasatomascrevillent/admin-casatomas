import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RANGOS_MESES_AGRUPADO, type RangoMesesAuditoria } from "@/hooks/useAuditLog";

const ETIQUETA_RANGO: Record<RangoMesesAuditoria, string> = {
  1: "Este mes",
  3: "Últimos 3 meses",
  6: "Últimos 6 meses",
  12: "Último año",
};

/**
 * Ventana de fechas de las pestañas "Por mes" y "Por día": agrupar bien
 * necesita el rango completo cargado (no una página de 25), así que en vez
 * de paginar se elige cuánto atrás mirar. Si ya hay un filtro de fechas
 * ("Desde"/"Hasta") puesto arriba, manda ese y este selector queda inerte.
 */
export function SelectorRangoMeses({
  rango,
  onRangoChange,
  usandoFiltroFechas,
  truncado,
  total,
  loading,
  onActualizar,
}: {
  rango: RangoMesesAuditoria;
  onRangoChange: (rango: RangoMesesAuditoria) => void;
  usandoFiltroFechas: boolean;
  truncado: boolean;
  total: number;
  loading: boolean;
  onActualizar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-1 pb-3">
      {usandoFiltroFechas ? (
        <p className="text-sm text-muted-foreground">Usando el filtro de fechas («Desde» / «Hasta») de arriba.</p>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Mostrar</span>
          <Select value={String(rango)} onValueChange={(v) => onRangoChange(Number(v) as RangoMesesAuditoria)}>
            <SelectTrigger className="w-44" aria-label="Meses a mostrar">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGOS_MESES_AGRUPADO.map((valor) => (
                <SelectItem key={valor} value={String(valor)}>
                  {ETIQUETA_RANGO[valor]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {total} registro{total === 1 ? "" : "s"} cargado{total === 1 ? "" : "s"}
      </p>
      <Button variant="outline" size="sm" className="ml-auto" onClick={onActualizar} disabled={loading}>
        Actualizar
      </Button>
      {truncado && (
        <p role="status" className="w-full text-xs text-amber-600">
          Hay más registros en este rango de los que se muestran (tope de 1000). Acota con «Desde»/«Hasta» o con un
          rango más corto para verlos todos.
        </p>
      )}
    </div>
  );
}
