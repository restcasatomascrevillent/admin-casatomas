import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TiraCifras } from "@/components/panel/TiraCifras";
import type { Tendencia } from "@/hooks/useTraficoWeb";
import { esNulo, fmtDecimal1, fmtDecimal2, fmtNumero, fmtPct, SIN_DATOS } from "./formato";
import { DIAS_MINIMOS_TENDENCIA, deltaMediaPct, type ResumenPeriodo } from "./calculos";

interface KpisTraficoProps {
  actual: ResumenPeriodo;
  anterior: ResumenPeriodo;
  tendencia: Tendencia | null | undefined;
  dias: number;
}

export function KpisTrafico({ actual, anterior, tendencia, dias }: KpisTraficoProps) {
  const deltaMedia = deltaMediaPct(actual, anterior);

  const pendiente = tendencia?.pendiente ?? null;
  const fiable = tendencia?.fiable === true && (tendencia?.n ?? 0) >= DIAS_MINIMOS_TENDENCIA;
  const valorTendencia = esNulo(pendiente) ? SIN_DATOS : `${pendiente > 0 ? "+" : ""}${fmtDecimal2(pendiente)}`;

  return (
    <div data-testid="kpis-trafico" className="space-y-1">
      <TiraCifras
        cifras={[
          { etiqueta: `Visitas (${dias} días)`, valor: fmtNumero(actual.total) },
          { etiqueta: "Media diaria", valor: fmtDecimal1(actual.media), detalle: `vs anterior ${deltaMedia === null ? SIN_DATOS : fmtPct(deltaMedia, true)}` },
          { etiqueta: "Tendencia (visitas/día)", valor: valorTendencia, detalle: `R² ${fmtDecimal2(tendencia?.r2 ?? null)}` },
          { etiqueta: "Proyección 30 días", valor: fmtNumero(tendencia?.total_30d ?? null), detalle: `visitantes ${fmtNumero(actual.visitantes)}` },
        ]}
      />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {actual.diasConDato} {actual.diasConDato === 1 ? "día" : "días"} con datos
          {actual.anomalias > 0 && ` · ${actual.anomalias} anomalía${actual.anomalias === 1 ? "" : "s"}`}
        </span>
        {tendencia && !fiable && (
          <Badge variant="outline" className="gap-1 border-amber-500/60 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            poco fiable ({tendencia.n} días)
          </Badge>
        )}
      </p>
    </div>
  );
}
