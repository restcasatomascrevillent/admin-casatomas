import { AlertTriangle, CalendarDays, Eye, TrendingDown, TrendingUp, Users } from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Tendencia } from "@/hooks/useTraficoWeb";
import { esNulo, fmtDecimal1, fmtDecimal2, fmtNumero, fmtPct, SIN_DATOS } from "./formato";
import { DIAS_MINIMOS_TENDENCIA, deltaMediaPct, type ResumenPeriodo } from "./calculos";

interface KpiProps {
  titulo: string;
  valor: string;
  icono: ComponentType<SVGProps<SVGSVGElement>>;
  pie?: ReactNode;
}

function Kpi({ titulo, valor, icono: Icono, pie }: KpiProps) {
  const sinDatos = valor === SIN_DATOS;
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground sm:text-sm">{titulo}</p>
          <Icono className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </div>
        <p
          className={
            sinDatos
              ? "mt-2 text-lg font-medium italic text-muted-foreground"
              : "mt-2 text-2xl font-semibold tabular-nums text-foreground"
          }
        >
          {valor}
        </p>
        {pie && <div className="mt-1 text-xs text-muted-foreground">{pie}</div>}
      </CardContent>
    </Card>
  );
}

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
  const IconoTendencia = !esNulo(pendiente) && pendiente < 0 ? TrendingDown : TrendingUp;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
      <Kpi
        titulo={`Visitas (${dias} días)`}
        valor={fmtNumero(actual.total)}
        icono={Eye}
        pie={
          <>
            {actual.diasConDato} {actual.diasConDato === 1 ? "día" : "días"} con datos
            {actual.anomalias > 0 && ` · ${actual.anomalias} anomalía${actual.anomalias === 1 ? "" : "s"}`}
          </>
        }
      />
      <Kpi
        titulo="Media diaria"
        valor={fmtDecimal1(actual.media)}
        icono={CalendarDays}
        pie={<>vs periodo anterior: {deltaMedia === null ? SIN_DATOS : fmtPct(deltaMedia, true)}</>}
      />
      <Kpi
        titulo="Tendencia (visitas/día)"
        valor={esNulo(pendiente) ? SIN_DATOS : `${pendiente > 0 ? "+" : ""}${fmtDecimal2(pendiente)}`}
        icono={IconoTendencia}
        pie={
          <span className="flex flex-wrap items-center gap-1.5">
            R² {fmtDecimal2(tendencia?.r2 ?? null)}
            {tendencia && !fiable && (
              <Badge variant="outline" className="gap-1 border-amber-500/60 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                poco fiable ({tendencia.n} días)
              </Badge>
            )}
          </span>
        }
      />
      <Kpi
        titulo="Proyección próximos 30 días"
        valor={fmtNumero(tendencia?.total_30d ?? null)}
        icono={Users}
        pie={<>visitantes (suma diaria): {fmtNumero(actual.visitantes)}</>}
      />
    </div>
  );
}
