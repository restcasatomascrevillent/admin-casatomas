// Gráfica de la evolución del precio de un producto, una línea por proveedor.
// Se usa en dos sitios: bajo la burbuja del chat (adjunto `serie_precio` de la
// Edge Function) y en la pregunta rápida «Evolución de precio».
//
// Alto fijo (no depende de la pantalla): vive dentro del hilo del chat, que ya
// tiene su propio scroll, así que no añade scroll de página.
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { formatFechaEs, formatNumeroEs, formatPorcentaje, formatPrecioUnidad } from "@/lib/facturas/preguntasRapidas";
import {
  esSerieSinDatos,
  filasGrafico,
  nombreProveedor,
  normalizarSerie,
  proveedoresUsados,
  type SeriePrecio,
} from "@/lib/facturas/seriePrecio";

/** Paleta del panel (la misma que la evolución de precios de la carta). */
const COLORES_SERIE = [
  "hsl(206, 11%, 25%)",
  "hsl(38, 59%, 45%)",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#3b82f6",
  "#f59e0b",
  "hsl(25, 13%, 55%)",
];

const DIA_MS = 86_400_000;
const ALTO_GRAFICO = 220;

const fechaCorta = (t: number) => {
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
};

function Dato({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-background px-2.5 py-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">{etiqueta}</p>
      <p className="truncate text-sm font-semibold tabular-nums text-foreground">{valor}</p>
      {nota && <p className="text-[11px] text-muted-foreground">{nota}</p>}
    </div>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: { payload: Record<string, number | string>; dataKey?: string; name?: string; color?: string; value?: number }[];
  unidad: string | null;
}

function TooltipSerie({ active, payload, unidad }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const fecha = String(payload[0].payload.fecha ?? "");
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-semibold">{formatFechaEs(fecha)}</p>
      {payload
        .filter((p) => typeof p.value === "number")
        .map((p) => (
          <p key={p.dataKey} className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
            <span className="min-w-0 truncate">{p.name}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums">{formatPrecioUnidad(p.value, unidad)}</span>
          </p>
        ))}
    </div>
  );
}

function Grafico({ serie }: { serie: SeriePrecio }) {
  const filas = useMemo(() => filasGrafico(serie), [serie]);
  const usados = useMemo(() => proveedoresUsados(serie), [serie]);
  const [ocultos, setOcultos] = useState<ReadonlySet<number>>(new Set());
  const unaSolaFecha = filas.length === 1;
  const color = (idx: number) => COLORES_SERIE[idx % COLORES_SERIE.length];
  const alternar = (idx: number) =>
    setOcultos((prev) => {
      const sig = new Set(prev);
      if (sig.has(idx)) sig.delete(idx);
      else sig.add(idx);
      return sig;
    });

  return (
    <div>
      {/* Leyenda = interruptores de 44 px (en una tablet no hay hover para aislar una línea). */}
      <div className="flex flex-wrap gap-x-1" role="group" aria-label="Proveedores en la gráfica">
        {usados.map((idx) => {
          const visible = !ocultos.has(idx);
          return (
            <button
              key={idx}
              type="button"
              onClick={() => alternar(idx)}
              aria-pressed={visible}
              title={visible ? "Toca para ocultar esta línea" : "Toca para mostrar esta línea"}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs text-foreground hover:bg-muted/60",
                !visible && "opacity-50 line-through",
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color(idx) }} aria-hidden />
              <span className="max-w-[12rem] truncate">{nombreProveedor(serie, idx)}</span>
            </button>
          );
        })}
      </div>

      <div style={{ height: ALTO_GRAFICO }} className="w-full" data-testid="grafico-serie-precio">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={filas} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={([min, max]: [number, number]) => {
                const margen = min === max ? 15 * DIA_MS : 2 * DIA_MS;
                return [min - margen, max + margen];
              }}
              tickFormatter={fechaCorta}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickMargin={6}
              minTickGap={24}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              width={52}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => formatNumeroEs(v, 2, 0)}
              label={{
                value: serie.unidad ? `€/${serie.unidad}` : "€",
                angle: -90,
                position: "insideLeft",
                style: { textAnchor: "middle", fill: "hsl(var(--muted-foreground))", fontSize: 11 },
              }}
            />
            <Tooltip content={<TooltipSerie unidad={serie.unidad} />} />
            {usados.map((idx) => (
              <Line
                key={idx}
                type="monotone"
                dataKey={`p${idx}`}
                name={nombreProveedor(serie, idx)}
                stroke={color(idx)}
                strokeWidth={2.5}
                connectNulls
                hide={ocultos.has(idx)}
                dot={{ r: unaSolaFecha ? 6 : 4, strokeWidth: 2, fill: "hsl(var(--background))" }}
                // Radio grande: el dedo no acierta con un punto de 4 px.
                activeDot={{ r: 9, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Recibe el JSON de `serie_precios_agente` tal cual (o el adjunto del chat) y
 * lo pinta; si no es válido muestra un aviso en vez de romper el hilo.
 */
export function GraficoSeriePrecio({ datos, className }: { datos: unknown; className?: string }) {
  const serie = useMemo(() => normalizarSerie(datos), [datos]);

  if (!serie) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)} role="status">
        No se ha podido leer la evolución de precio.
      </p>
    );
  }
  if (esSerieSinDatos(serie)) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)} role="status">
        No hay compras registradas{serie.buscado ? <> de «{serie.buscado}»</> : null}.
      </p>
    );
  }

  const unaSola = serie.n <= 1 || serie.puntos.length <= 1;
  const proveedor = nombreProveedor(serie, serie.puntos[serie.puntos.length - 1][2]);
  const sube = (serie.variacion_pct ?? 0) > 0;
  const baja = (serie.variacion_pct ?? 0) < 0;

  return (
    <figure
      className={cn("w-full space-y-2", className)}
      aria-label={`Evolución del precio de ${serie.producto}`}
    >
      <figcaption className="text-sm font-semibold leading-tight text-foreground">
        Evolución del precio · {serie.producto}
        <span className="block text-xs font-normal text-muted-foreground">
          Precio unitario sin IVA{serie.unidad ? `, en €/${serie.unidad}` : ""} · {serie.n} {serie.n === 1 ? "compra" : "compras"}
        </span>
      </figcaption>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Dato etiqueta="Último" valor={formatPrecioUnidad(serie.ultimo, serie.unidad)} />
        <Dato etiqueta="Mínimo" valor={formatPrecioUnidad(serie.min, serie.unidad)} />
        <Dato etiqueta="Máximo" valor={formatPrecioUnidad(serie.max, serie.unidad)} />
        {unaSola || serie.variacion_pct === null ? (
          <Dato etiqueta="Variación" valor="—" />
        ) : (
          <div
            className={cn(
              "min-w-0 rounded-lg border border-border/60 bg-background px-2.5 py-1.5",
              sube && "text-red-700 dark:text-red-400",
              baja && "text-emerald-700 dark:text-emerald-400",
            )}
          >
            <p className="text-[11px] font-medium text-muted-foreground">Variación</p>
            <p className="truncate text-sm font-semibold tabular-nums">{formatPorcentaje(serie.variacion_pct)}</p>
          </div>
        )}
      </div>

      {unaSola && (
        <p className="text-sm text-muted-foreground" role="status">
          Solo una compra ({formatFechaEs(serie.puntos[0][0])}, {proveedor}): no hay evolución que comparar todavía.
        </p>
      )}

      <Grafico serie={serie} />
    </figure>
  );
}
