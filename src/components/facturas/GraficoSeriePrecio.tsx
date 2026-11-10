// Gráfica de la evolución del precio de un producto, una línea por proveedor.
// Se usa en las tarjetas del tablero del copiloto (adjunto `serie_precio` de la
// Edge Function y pregunta rápida «Evolución de precio») y en la ficha de producto.
//
// Alto fijo (no depende de la pantalla): vive dentro del hilo del chat, que ya
// tiene su propio scroll, así que no añade scroll de página.
import { useMemo, useState, type ReactNode } from "react";
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
import type { UnidadSerie } from "@/lib/facturas/productos";

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
/** Alto de la gráfica dentro de la ficha de producto (para que se vea sin scroll en 1280×711). */
const ALTO_GRAFICO_COMPACTO = 168;

const fechaCorta = (t: number) => {
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
};

/** Una cifra del resumen: etiqueta gris + valor, sin recuadro (van en una sola fila de texto). */
function Cifra({ etiqueta, valor, className }: { etiqueta: string; valor: string; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <span className="text-muted-foreground">{etiqueta} </span>
      <span className="font-semibold tabular-nums">{valor}</span>
    </span>
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

function Grafico({ serie, alto }: { serie: SeriePrecio; alto: number }) {
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

      <div style={{ height: alto }} className="w-full" data-testid="grafico-serie-precio">
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
              fontSize={12}
              tickMargin={6}
              minTickGap={24}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              width={52}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => formatNumeroEs(v, 2, 0)}
              label={{
                value: serie.unidad ? `€/${serie.unidad}` : "€",
                angle: -90,
                position: "insideLeft",
                style: { textAnchor: "middle", fill: "hsl(var(--muted-foreground))", fontSize: 12 },
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
 * Chips de unidad («kg · 37», «ud · 12»): un producto comprado en varias
 * unidades no se mezcla en una línea, pero tampoco se esconden las demás.
 */
export function SelectorUnidadSerie({
  unidades,
  actual,
  onElegir,
}: {
  unidades: UnidadSerie[];
  actual: string | null;
  onElegir: (unidad: string) => void;
}) {
  if (unidades.length < 2) return null;
  return (
    <div role="group" aria-label="Unidad de la gráfica" className="flex flex-wrap gap-1" data-testid="selector-unidad-serie">
      {unidades.map((u) => (
        <button
          key={u.unidad}
          type="button"
          aria-pressed={actual === u.unidad}
          aria-label={`Precio por ${u.unidad}: ${u.n} ${u.n === 1 ? "compra" : "compras"}`}
          onClick={() => onElegir(u.unidad)}
          className={cn(
            "min-h-9 rounded-full border border-transparent px-2.5 text-xs font-medium tabular-nums text-muted-foreground hover:text-foreground pointer-coarse:min-h-11",
            "aria-pressed:border-border aria-pressed:bg-muted aria-pressed:font-semibold aria-pressed:text-foreground",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
          )}
        >
          {u.unidad} · {formatNumeroEs(u.n, 0, 0)}
        </button>
      ))}
    </div>
  );
}

/** Estado sin gráfica (0 o 1 compra): una frase en vez de unos ejes vacíos. */
function EstadoSinEvolucion({ children, className, extra }: { children: ReactNode; className?: string; extra?: ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {extra}
      <p className="rounded-md bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground" role="status" data-testid="serie-sin-evolucion">
        {children}
      </p>
    </div>
  );
}

/**
 * Recibe el JSON de `serie_precios_agente` tal cual (o el adjunto del chat) y
 * lo pinta; si no es válido muestra un aviso en vez de romper el hilo.
 * Con 0 o 1 compra no hay evolución: una frase («Solo 1 compra: …») sin ejes.
 */
export function GraficoSeriePrecio({
  datos,
  className,
  compacto = false,
  alto,
  unidades,
  onElegirUnidad,
}: {
  datos: unknown;
  className?: string;
  /** En la ficha de producto: sin título repetido y gráfica más baja. */
  compacto?: boolean;
  /** Alto de la gráfica en px (el tablero del copiloto la quiere más grande). */
  alto?: number;
  /** Unidades del producto (ficha): con 2 o más se pinta un selector. */
  unidades?: UnidadSerie[];
  onElegirUnidad?: (unidad: string) => void;
}) {
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
      <EstadoSinEvolucion className={className}>
        Sin compras con precio{serie.buscado ? <> de «{serie.buscado}»</> : null}.
      </EstadoSinEvolucion>
    );
  }

  const selector =
    unidades && onElegirUnidad ? <SelectorUnidadSerie unidades={unidades} actual={serie.unidad} onElegir={onElegirUnidad} /> : null;

  if (serie.puntos.length <= 1) {
    const [fecha, precio, idx] = serie.puntos[0];
    return (
      <figure className={cn("w-full", className)} aria-label={`Precio de ${serie.producto}`}>
        <EstadoSinEvolucion extra={selector}>
          <span className="font-medium text-foreground">Solo 1 compra:</span>{" "}
          <span className="font-semibold tabular-nums text-foreground">{formatPrecioUnidad(precio, serie.unidad)}</span> el{" "}
          {formatFechaEs(fecha)} en {nombreProveedor(serie, idx)}
          {!compacto && serie.producto ? <> ({serie.producto})</> : null}. Sin IVA; no hay evolución que comparar todavía.
        </EstadoSinEvolucion>
      </figure>
    );
  }

  const sube = (serie.variacion_pct ?? 0) > 0;
  const baja = (serie.variacion_pct ?? 0) < 0;

  return (
    <figure
      className={cn("w-full space-y-1.5", className)}
      aria-label={`Evolución del precio de ${serie.producto}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <figcaption className={cn("text-sm leading-tight text-foreground", !compacto && "font-semibold")}>
          {compacto ? (
            <span className="text-xs text-muted-foreground">
              Evolución del precio · sin IVA{serie.unidad ? `, en €/${serie.unidad}` : ""} · {serie.n} {serie.n === 1 ? "compra" : "compras"}
            </span>
          ) : (
            <>
              Evolución del precio · {serie.producto}
              <span className="block text-xs font-normal text-muted-foreground">
                Precio unitario sin IVA{serie.unidad ? `, en €/${serie.unidad}` : ""} · {serie.n} {serie.n === 1 ? "compra" : "compras"}
              </span>
            </>
          )}
        </figcaption>
        {selector}
      </div>

      {/* Cifras en una fila de texto, sin recuadros. */}
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm" data-testid="cifras-serie-precio">
        <Cifra etiqueta="Último" valor={formatPrecioUnidad(serie.ultimo, serie.unidad)} />
        <span className="text-muted-foreground/60" aria-hidden="true">·</span>
        <Cifra etiqueta="Mín" valor={formatPrecioUnidad(serie.min, serie.unidad)} />
        <span className="text-muted-foreground/60" aria-hidden="true">·</span>
        <Cifra etiqueta="Máx" valor={formatPrecioUnidad(serie.max, serie.unidad)} />
        <span className="text-muted-foreground/60" aria-hidden="true">·</span>
        {serie.variacion_pct === null ? (
          <Cifra etiqueta="Variación" valor="—" />
        ) : (
          <Cifra
            etiqueta="Variación"
            valor={formatPorcentaje(serie.variacion_pct)}
            className={cn(sube && "text-red-700 dark:text-red-400", baja && "text-emerald-700 dark:text-emerald-400")}
          />
        )}
      </p>

      <Grafico serie={serie} alto={alto ?? (compacto ? ALTO_GRAFICO_COMPACTO : ALTO_GRAFICO)} />
    </figure>
  );
}
