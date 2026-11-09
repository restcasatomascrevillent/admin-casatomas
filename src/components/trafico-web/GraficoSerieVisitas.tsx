import { memo, useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FilaSerie, Tendencia } from "@/hooks/useTraficoWeb";
import { esNulo, fmtDecimal1, fmtDecimal2, fmtFechaCorta, fmtFechaLarga, fmtNumero, fmtPct, menosTipografico } from "./formato";
import { construirPuntos, type PuntoGrafico } from "./calculos";

const COLOR = {
  visitas: "var(--viz-1)",
  media7: "var(--viz-2)",
  media30: "var(--viz-3)",
  anomalia: "var(--viz-critico)",
};

/** Ejes y rejilla discretos: el protagonismo es de las líneas. */
const TINTA_EJE = "hsl(var(--muted-foreground))";
const LINEA_EJE = "hsl(var(--border))";

interface PuntoDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: PuntoGrafico;
}

// Punto de anomalía: marcador ≥ 8 px con anillo del color del fondo para
// separarlo de las líneas que pisa. El resto de días no llevan punto.
function PuntoAnomalia({ cx, cy, payload, index }: PuntoDotProps) {
  if (!payload?.anomalia || cx === undefined || cy === undefined) return <g key={`d-${index}`} />;
  return (
    <circle
      key={`a-${index}`}
      cx={cx}
      cy={cy}
      r={4.5}
      fill={COLOR.anomalia}
      stroke="hsl(var(--background))"
      strokeWidth={2}
    />
  );
}

function TooltipSerie({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as PuntoGrafico;
  const esProyeccion = p.visitas === undefined;
  return (
    <div className="min-w-44 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1.5 font-medium first-letter:uppercase">{fmtFechaLarga(p.fecha)}</p>
      {esProyeccion ? (
        <p className="text-muted-foreground">
          Proyección: <span className="tabular-nums text-foreground">{fmtDecimal1(p.proyeccion)}</span> visitas
        </p>
      ) : (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-0.5 w-3 rounded-full" style={{ background: COLOR.visitas }} aria-hidden />
            Visitas
          </dt>
          <dd className="text-right font-medium tabular-nums">{fmtNumero(p.visitas)}</dd>
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-0.5 w-3 rounded-full" style={{ background: COLOR.media7 }} aria-hidden />
            Media 7 días
          </dt>
          <dd className="text-right tabular-nums">{fmtDecimal1(p.media7)}</dd>
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-0.5 w-3 rounded-full" style={{ background: COLOR.media30 }} aria-hidden />
            Media 30 días
          </dt>
          <dd className="text-right tabular-nums">{fmtDecimal1(p.media30)}</dd>
          <dt className="mt-1 border-t border-border/60 pt-1 text-muted-foreground">Media mismo día sem.</dt>
          <dd className="mt-1 border-t border-border/60 pt-1 text-right tabular-nums">{fmtDecimal1(p.mediaDow)}</dd>
          <dt className="text-muted-foreground">Desviación</dt>
          <dd className="text-right tabular-nums">{menosTipografico(fmtPct(p.desviacionPct, true))}</dd>
          <dt className="text-muted-foreground">z</dt>
          <dd className="text-right tabular-nums">{menosTipografico(fmtDecimal2(p.zDow))}</dd>
        </dl>
      )}
      {p.anomalia && (
        <p className="mt-1.5 flex items-center gap-1.5 font-medium text-destructive">
          <span className="h-2 w-2 rounded-full" style={{ background: COLOR.anomalia }} aria-hidden />
          Anomalía (|z| &gt; 2)
        </p>
      )}
    </div>
  );
}

/** Muestra de cada serie en la leyenda: línea (sólida o discontinua), banda o punto. */
function Muestra({ tipo, color }: { tipo: "linea" | "discontinua" | "banda" | "punto"; color: string }) {
  if (tipo === "punto") return <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />;
  if (tipo === "banda") {
    return (
      <span className="relative h-2.5 w-4 overflow-hidden rounded-[2px]" aria-hidden>
        <span className="absolute inset-0" style={{ background: color, opacity: 0.12 }} />
        <span className="absolute inset-x-0 inset-y-[3px]" style={{ background: color, opacity: 0.22 }} />
      </span>
    );
  }
  return (
    <svg width="16" height="4" viewBox="0 0 16 4" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="2"
        x2="15"
        y2="2"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={tipo === "discontinua" ? "3 3" : undefined}
      />
    </svg>
  );
}

function Leyenda({ conProyeccion }: { conProyeccion: boolean }) {
  const items = [
    { clave: "visitas", tipo: "linea" as const, color: COLOR.visitas, texto: "Visitas" },
    { clave: "media7", tipo: "linea" as const, color: COLOR.media7, texto: "Media 7 días" },
    { clave: "media30", tipo: "linea" as const, color: COLOR.media30, texto: "Media 30 días" },
    { clave: "banda", tipo: "banda" as const, color: COLOR.visitas, texto: "Rango habitual (±1σ y ±2σ)" },
    { clave: "anomalia", tipo: "punto" as const, color: COLOR.anomalia, texto: "Anomalía" },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Leyenda de la gráfica">
      {items.map((i) => (
        <li key={i.clave} className="flex items-center gap-1.5">
          <Muestra tipo={i.tipo} color={i.color} />
          {i.texto}
        </li>
      ))}
      {conProyeccion && (
        <li className="flex items-center gap-1.5">
          <Muestra tipo="discontinua" color={COLOR.visitas} />
          Proyección 30 días
        </li>
      )}
    </ul>
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
  // Tramo de la proyección (de hoy al último día proyectado): fondo suave y raya de «hoy», para que la mitad
  // derecha se lea como futuro y no como un hueco.
  const finProyeccion = puntos.length > 0 && esNulo(puntos[puntos.length - 1].visitas) ? puntos[puntos.length - 1].fecha : null;
  const conProyeccion = finProyeccion !== null && puntos.some((p) => p.fecha === hoy);

  return (
    <Card variante="plana">
      <CardHeader className="space-y-2 px-0 pb-3 pt-2 sm:pb-4">
        <div className="space-y-1">
          <CardTitle className="text-sm font-medium sm:text-base">Visitas diarias</CardTitle>
          <CardDescription className="text-xs">
            El rango habitual sale de los 8 mismos días de la semana anteriores; los días sin sincronizar quedan en blanco.
            {tendencia && !fiable && (
              <span className="text-amber-700 dark:text-amber-400"> Proyección poco fiable: menos de 14 días de datos.</span>
            )}
          </CardDescription>
        </div>
        <Leyenda conProyeccion={conProyeccion} />
      </CardHeader>
      <CardContent className="px-0 pb-4">
        {/* Alto adaptado a la ventana: la gráfica entera cabe a 1280×711 sin scroll de la región (de 220 a 340 px). */}
        <div style={{ height: "clamp(220px, calc(100dvh - 430px), 340px)" }} data-testid="grafico-visitas">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={puntos} margin={{ left: -10, right: 8, top: 18, bottom: 0 }}>
              {conProyeccion && (
                <ReferenceArea
                  x1={hoy}
                  x2={finProyeccion}
                  fill="hsl(var(--muted))"
                  fillOpacity={0.25}
                  stroke="none"
                  ifOverflow="extendDomain"
                />
              )}
              <CartesianGrid vertical={false} stroke={LINEA_EJE} strokeOpacity={0.7} strokeDasharray="2 4" />
              <XAxis
                dataKey="fecha"
                tickFormatter={fmtFechaCorta}
                tick={{ fill: TINTA_EJE, fontSize: 11 }}
                axisLine={{ stroke: LINEA_EJE }}
                tickLine={false}
                tickMargin={6}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: TINTA_EJE, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={48}
              />
              <Tooltip content={<TooltipSerie />} cursor={{ stroke: TINTA_EJE, strokeOpacity: 0.5, strokeDasharray: "3 3" }} />
              {conProyeccion && (
                <ReferenceLine
                  x={hoy}
                  stroke={TINTA_EJE}
                  strokeOpacity={0.5}
                  strokeDasharray="3 3"
                  label={{ value: "Hoy", position: "top", fill: TINTA_EJE, fontSize: 11 }}
                />
              )}
              <Area
                type="monotone"
                dataKey="banda2"
                name="±2σ mismo día sem."
                fill={COLOR.visitas}
                fillOpacity={0.07}
                stroke="none"
                isAnimationActive={false}
                activeDot={false}
              />
              <Area
                type="monotone"
                dataKey="banda1"
                name="±1σ mismo día sem."
                fill={COLOR.visitas}
                fillOpacity={0.13}
                stroke="none"
                isAnimationActive={false}
                activeDot={false}
              />
              <Line
                type="monotone"
                dataKey="media30"
                name="Media 30 días"
                stroke={COLOR.media30}
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="media7"
                name="Media 7 días"
                stroke={COLOR.media7}
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="visitas"
                name="Visitas"
                stroke={COLOR.visitas}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                dot={PuntoAnomalia}
                activeDot={{ r: 4, stroke: "hsl(var(--background))", strokeWidth: 2 }}
                isAnimationActive={false}
              />
              <Line
                dataKey="proyeccion"
                name="Proyección"
                stroke={COLOR.visitas}
                strokeWidth={2}
                strokeDasharray="5 5"
                strokeOpacity={0.7}
                strokeLinecap="round"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
});
