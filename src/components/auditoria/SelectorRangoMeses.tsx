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
 * ("Desde"/"Hasta") puesto en los filtros, manda ese y este selector se oculta.
 * El botón «Actualizar» es el de la cabecera de la tarjeta (sirve para las tres vistas).
 */
export function SelectorRangoMeses({
  rango,
  onRangoChange,
  usandoFiltroFechas,
  truncado,
  total,
}: {
  rango: RangoMesesAuditoria;
  onRangoChange: (rango: RangoMesesAuditoria) => void;
  usandoFiltroFechas: boolean;
  truncado: boolean;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {usandoFiltroFechas ? (
        <p className="text-sm text-muted-foreground">Usando las fechas «Desde» / «Hasta» de los filtros.</p>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Periodo</span>
          <Select value={String(rango)} onValueChange={(v) => onRangoChange(Number(v) as RangoMesesAuditoria)}>
            <SelectTrigger className="h-9 w-auto min-w-[10.5rem] gap-2 pointer-coarse:h-11" aria-label="Meses a mostrar">
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
      <p className="ml-auto text-xs text-muted-foreground tabular-nums sm:text-sm">
        {total.toLocaleString("es-ES")} registro{total === 1 ? "" : "s"}
        <span className="hidden sm:inline"> cargado{total === 1 ? "" : "s"}</span>
      </p>
      {truncado && (
        <p role="status" className="w-full rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Hay más registros en este rango de los que se muestran (tope de 1000). Acota con «Desde»/«Hasta» o con un
          periodo más corto para verlos todos.
        </p>
      )}
    </div>
  );
}
