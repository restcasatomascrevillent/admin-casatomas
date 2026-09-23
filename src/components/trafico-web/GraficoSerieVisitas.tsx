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
import type { FilaSerie, Tendencia } from "@/hooks/useTraficoWeb";
import { esNulo, fmtDecimal1, fmtFechaCorta, fmtFechaLarga, fmtNumero, fmtPct, SIN_DATOS } from "./formato";
import { construirPuntos, type PuntoGrafico } from "./calculos";

const COLOR = {
  visitas: "var(--viz-1)",
  media7: "var(--viz-2)",
  media30: "var(--viz-3)",
  anomalia: "var(--viz-critico)",
};

interface PuntoDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: PuntoGrafico;
}

// Punto de anomalía: marcador ≥ 8 px con anillo del color de la superficie
// para separarlo de las líneas que pisa. El resto de días no llevan punto.
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

function TooltipSerie({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as PuntoGrafico;
  const esProyeccion = p.visitas === undefined;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium capitalize">{fmtFechaLarga(p.fecha)}</p>
      {esProyeccion ? (
        <p>
          Proyección: <span className="tabular-nums">{fmtDecimal1(p.proyeccion)}</span> visitas
        </p>
      ) : (
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground">Visitas</dt>
          <dd className="text-right tabular-nums">{fmtNumero(p.visitas)}</dd>
          <dt className="text-muted-foreground">Media 7 días</dt>
          <dd className="text-right tabular-nums">{fmtDecimal1(p.media7)}</dd>
          <dt className="text-muted-foreground">Media 30 días</dt>
          <dd className="text-right tabular-nums">{fmtDecimal1(p.media30)}</dd>
          <dt className="text-muted-foreground">Media mismo día sem.</dt>
          <dd className="text-right tabular-nums">{fmtDecimal1(p.mediaDow)}</dd>
          <dt className="text-muted-foreground">Desviación</dt>
          <dd className="text-right tabular-nums">{fmtPct(p.desviacionPct, true)}</dd>
          <dt className="text-muted-foreground">z</dt>
          <dd className="text-right tabular-nums">{esNulo(p.zDow) ? SIN_DATOS : p.zDow.toFixed(2)}</dd>
        </dl>
      )}
      {p.anomalia && <p className="mt-1 font-medium text-destructive">⚠ Anomalía (|z| &gt; 2)</p>}
    </div>
  );
}

interface GraficoSerieVisitasProps {
  serie: FilaSerie[];
  tendencia: Tendencia | null | undefined;
  hoy: string;
}

export const GraficoSerieVisitas = memo(function GraficoSerieVisitas({ serie, tendencia, hoy }: GraficoSerieVisitasProps) {
  const puntos = useMemo(() => construirPuntos(serie, tendencia, hoy), [serie, tendencia, hoy]);
  const fiable = tendencia?.fiable === true;

  return (
    <Card>
      <CardHeader className="pb-2 sm:pb-4">
        <CardTitle className="text-sm font-medium sm:text-base">Visitas diarias</CardTitle>
        <CardDescription className="text-xs">
          Bandas: media ±1σ y ±2σ de los 8 mismos días de la semana anteriores. Un punto rojo es una anomalía (fuera de
          ±2σ). Línea discontinua: proyección lineal a 30 días{fiable ? "" : " (poco fiable: menos de 14 días de datos)"}.
          Los días sin sincronizar quedan en blanco, no a cero.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={puntos} margin={{ left: -10, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis
              dataKey="fecha"
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
              allowDecimals={false}
              width={48}
            />
            <Tooltip content={<TooltipSerie />} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }} />
            <Area
              dataKey="banda2"
              name="±2σ mismo día sem."
              fill={COLOR.visitas}
              fillOpacity={0.08}
              stroke="none"
              isAnimationActive={false}
              activeDot={false}
              legendType="square"
            />
            <Area
              dataKey="banda1"
              name="±1σ mismo día sem."
              fill={COLOR.visitas}
              fillOpacity={0.14}
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
              dataKey="visitas"
              name="Visitas"
              stroke={COLOR.visitas}
              strokeWidth={2}
              dot={PuntoAnomalia}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            <Line
              dataKey="proyeccion"
              name="Proyección"
              stroke={COLOR.visitas}
              strokeWidth={2}
              strokeDasharray="6 4"
              strokeOpacity={0.7}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
});
