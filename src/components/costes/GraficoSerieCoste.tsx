import { memo, useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FilaCosteSerie } from "@/hooks/useCostes";
import { esNulo, fmtFechaCorta, fmtFechaLarga, fmtNumero, fmtPct, fmtUsdPreciso, SIN_DATOS } from "./formato";
import { construirPuntosCoste, type PuntoCoste } from "./calculos";

const COLOR = {
  coste: "var(--viz-1)",
  media7: "var(--viz-2)",
  media30: "var(--viz-3)",
  anomalia: "var(--viz-critico)",
};

interface PuntoDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: PuntoCoste;
}

// Punto de anomalía: marcador ≥ 8 px con anillo del color de la superficie para
// separarlo de las líneas que pisa. El resto de días no llevan punto.
function PuntoAnomalia({ cx, cy, payload, index }: PuntoDotProps) {
  if (!payload?.anomalia || cx === undefined || cy === undefined) return <g key={`d-${index}`} />;
  return (
    <circle
      key={`a-${index}`}
      cx={cx}
      cy={cy}
      r={5}
      fill={COLOR.anomalia}
      stroke="hsl(var(--card))"
      strokeWidth={2}
    />
  );
}

function TooltipCoste({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as PuntoCoste;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium capitalize">{fmtFechaLarga(p.dia)}</p>
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
        <dt className="text-muted-foreground">Coste</dt>
        <dd className="text-right tabular-nums">{fmtUsdPreciso(p.coste)}</dd>
        <dt className="text-muted-foreground">Peticiones</dt>
        <dd className="text-right tabular-nums">{fmtNumero(p.peticiones)}</dd>
        <dt className="text-muted-foreground">Media 7 días</dt>
        <dd className="text-right tabular-nums">{fmtUsdPreciso(p.media7)}</dd>
        <dt className="text-muted-foreground">Media 30 días</dt>
        <dd className="text-right tabular-nums">{fmtUsdPreciso(p.media30)}</dd>
        <dt className="text-muted-foreground">Desviación</dt>
        <dd className="text-right tabular-nums">{fmtPct(p.desviacionPct, true)}</dd>
        <dt className="text-muted-foreground">z</dt>
        <dd className="text-right tabular-nums">{esNulo(p.z) ? SIN_DATOS : p.z.toFixed(2)}</dd>
      </dl>
      {p.anomalia && <p className="mt-1 font-medium text-destructive">⚠ Anomalía (|z| &gt; 2)</p>}
    </div>
  );
}

/** El eje Y va en dólares y se mueve en céntimos: 2 decimales bastan en el eje. */
const tickUsd = (v: number): string => `${v.toFixed(2)} $`;

export const GraficoSerieCoste = memo(function GraficoSerieCoste({ serie }: { serie: FilaCosteSerie[] }) {
  const puntos = useMemo(() => construirPuntosCoste(serie), [serie]);

  return (
    <Card>
      <CardHeader className="pb-2 sm:pb-4">
        <CardTitle className="text-sm font-medium sm:text-base">Coste diario de IA (USD)</CardTitle>
        <CardDescription className="text-xs">
          Tokens registrados × tarifa de <code className="text-[11px]">ia_precios</code>. La banda es la media de 30
          días ±2σ y un punto rojo marca un día que se sale de ella. Un día sin ninguna llamada registrada queda en
          blanco, no a cero: puede significar que no se usó o que no se registró.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={puntos} margin={{ left: -4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis
              dataKey="dia"
              tickFormatter={fmtFechaCorta}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={tickUsd}
              width={62}
            />
            <Tooltip
              content={<TooltipCoste />}
              cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }}
            />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }} />
            <Area
              dataKey="banda2"
              name="±2σ (media 30 días)"
              fill={COLOR.coste}
              fillOpacity={0.1}
              stroke="none"
              isAnimationActive={false}
              activeDot={false}
              legendType="square"
            />
            <Line
              dataKey="media30"
              name="Media 30 días"
              stroke={COLOR.media30}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="media7"
              name="Media 7 días"
              stroke={COLOR.media7}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="coste"
              name="Coste del día (USD)"
              stroke={COLOR.coste}
              strokeWidth={2}
              dot={PuntoAnomalia}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
});
