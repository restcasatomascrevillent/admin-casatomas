// Gráfica del precio de un producto por mes (Análisis › Precios: avisos de
// subida/bajada y «Lo más comprado»). 15/11/2026, captura del dueño («Percebe
// … 130 €/kg el 09/11 · antes 100»): no se sabía cuánto valía cada punto.
//
//   · Eje Y con precios redondos en la unidad de la serie («120 €/kg»).
//   · La raya discontinua lleva su etiqueta («antes 100 €/kg», «pactado …»).
//   · Cada punto es un botón de 44 px: con el ratón (pasar) o el dedo (tocar)
//     sale un cuadro con el precio, la fecha, la cantidad y el documento de
//     cada compra del mes; si son muchas, el rango mín.–máx. y las primeras.
//     Tocar otra vez, Escape o tocar fuera lo cierran.
//
// El SVG se estira (preserveAspectRatio="none"); los textos y los puntos son
// HTML encima, colocados en %, para que no se deformen.
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDateCorta, formatNumero } from "@/components/facturas/shared/formatters";
import { mesCorto } from "@/lib/facturas/resumenCompras";
import { ladoEtiquetaReferencia, nombreMes, ticksPrecio, type GeometriaPrecio } from "@/lib/facturas/vistasAnalisis";
import { ETIQUETA_TIPO } from "@/lib/facturas/documentosCifra";
import type { CompraProducto } from "@/lib/facturas/comprasProducto";

const ANCHO = 400;
const ALTO = 180;
const MAX_COMPRAS = 4;

const pctX = (x: number) => `${(x / ANCHO) * 100}%`;
const pctY = (y: number) => `${(y / ALTO) * 100}%`;

/** «120 €/kg» (valores redondos) o «12,50 €/kg». */
function precioEje(v: number, unidad: string): string {
  const n = Number.isInteger(v) ? formatNumero(v) : v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n} €/${unidad}`;
}
const precioUd = (v: number | null, unidad: string | null) => (v === null ? "—" : `${formatCurrency(v)}/${unidad || "ud"}`);

function DetalleMes({ mes, precio, unidad, compras }: { mes: string; precio: number; unidad: string; compras: CompraProducto[] | undefined }) {
  const precios = (compras ?? []).map((c) => c.precio as number);
  const min = precios.length ? Math.min(...precios) : null;
  const max = precios.length ? Math.max(...precios) : null;
  return (
    <>
      <p className="font-semibold">
        {nombreMes(mes)} {mes.slice(0, 4)}: <span className="tabular-nums">{precioUd(precio, unidad)}</span>
      </p>
      {compras === undefined ? (
        <p className="text-muted-foreground">Precio del mes, sin IVA.</p>
      ) : compras.length === 0 ? (
        <p className="text-muted-foreground">Precio del mes, sin IVA (sin detalle de las compras).</p>
      ) : (
        <>
          {compras.length > 1 && (
            <p className="text-muted-foreground" data-testid="tooltip-rango">
              {compras.length} compras: de <span className="tabular-nums text-foreground">{precioUd(min, unidad)}</span> a{" "}
              <span className="tabular-nums text-foreground">{precioUd(max, unidad)}</span>
            </p>
          )}
          <ul className="mt-1 space-y-1">
            {compras.slice(0, MAX_COMPRAS).map((c) => (
              <li key={c.id} className="border-t border-border/60 pt-1 first:border-t-0 first:pt-0" data-testid="tooltip-compra">
                <p className="tabular-nums">
                  <span className="font-medium">{formatDateCorta(c.doc.fecha)}</span> · {precioUd(c.precio, c.unidad)}
                  {c.cantidad !== null ? ` · ${formatNumero(c.cantidad)} ${c.unidad || "ud"}` : ""}
                </p>
                <p className="text-muted-foreground [overflow-wrap:anywhere]">
                  {ETIQUETA_TIPO[c.doc.tipo]} {c.doc.numero ?? "sin número"} · {c.doc.proveedor}
                </p>
              </li>
            ))}
          </ul>
          {compras.length > MAX_COMPRAS && <p className="mt-1 text-muted-foreground">y {compras.length - MAX_COMPRAS} más</p>}
        </>
      )}
    </>
  );
}

export function GraficaPrecioMeses({
  g,
  unidad,
  etiquetaRef,
  ariaLabel,
  comprasDe,
}: {
  g: GeometriaPrecio;
  unidad: string;
  /** Etiqueta corta de la raya: «antes», «pactado». */
  etiquetaRef: string;
  ariaLabel: string;
  /** Compras de un mes (AAAA-MM) para el cuadro del punto; undefined = aún no se saben. */
  comprasDe?: (mes: string) => CompraProducto[] | undefined;
}) {
  const [activo, setActivo] = useState<string | null>(null);
  const [fijado, setFijado] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const idTooltip = useId();
  const ticks = ticksPrecio(g);
  const etiqueta = ladoEtiquetaReferencia(g, ANCHO, ALTO);

  // Tocar fuera cierra el cuadro fijado.
  useEffect(() => {
    if (!fijado) return;
    const fuera = (ev: PointerEvent) => {
      if (caja.current && !caja.current.contains(ev.target as Node)) {
        setFijado(false);
        setActivo(null);
      }
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [fijado]);

  const punto = activo ? g.puntos.find((p) => p.mes === activo) : undefined;
  const cerrar = () => {
    setFijado(false);
    setActivo(null);
  };

  return (
    <div
      ref={caja}
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if (e.key === "Escape" && activo) {
          e.stopPropagation();
          cerrar();
        }
      }}
    >
      <div className="flex min-h-0 flex-1">
        {/* Eje Y: precios redondos en la unidad de la serie. */}
        <div className="relative w-16 shrink-0" data-testid="eje-precio" aria-hidden>
          {ticks.map((t) => (
            <span
              key={t.valor}
              className="absolute right-1.5 -translate-y-1/2 whitespace-nowrap text-[0.6875rem] tabular-nums text-muted-foreground"
              style={{ top: pctY(t.y) }}
              data-testid="tick-precio"
            >
              {precioEje(t.valor, unidad)}
            </span>
          ))}
        </div>
        <div className="relative min-h-0 flex-1">
          <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} preserveAspectRatio="none" className="block h-full w-full" role="img" aria-label={ariaLabel}>
            {ticks.map((t) => (
              <line key={t.valor} x1="0" x2={ANCHO} y1={t.y} y2={t.y} className="stroke-border" strokeWidth="1" opacity={0.6} vectorEffect="non-scaling-stroke" />
            ))}
            <line x1="0" x2={ANCHO} y1="168" y2="168" className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {g.yReferencia !== null && (
              <line x1="0" x2={ANCHO} y1={g.yReferencia} y2={g.yReferencia} className="stroke-foreground/50" strokeWidth="1.2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" data-testid="raya-referencia" />
            )}
            <path d={g.linea} fill="none" className="stroke-primary" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          {g.referencia !== null && g.yReferencia !== null && (
            <span
              className={cn(
                "pointer-events-none absolute whitespace-nowrap rounded bg-background/90 px-1 text-[0.6875rem] font-medium tabular-nums text-foreground/80",
                etiqueta.lado === "derecha" ? "right-0" : "left-0",
                etiqueta.debajo ? "translate-y-0.5" : "-translate-y-full",
              )}
              style={{ top: pctY(g.yReferencia) }}
              data-testid="etiqueta-referencia"
            >
              {etiquetaRef} {precioEje(Math.round(g.referencia * 100) / 100, unidad)}
            </span>
          )}
          {g.puntos.map((p) => {
            const abierto = activo === p.mes;
            return (
              <button
                key={p.mes}
                type="button"
                className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ left: pctX(p.x), top: pctY(p.y) }}
                aria-label={`${nombreMes(p.mes)} ${p.mes.slice(0, 4)}: ${precioUd(p.precio, unidad)}. Ver las compras`}
                aria-expanded={abierto}
                aria-describedby={abierto ? idTooltip : undefined}
                data-testid="punto-precio"
                onMouseEnter={() => !fijado && setActivo(p.mes)}
                onMouseLeave={() => !fijado && setActivo(null)}
                onFocus={() => !fijado && setActivo(p.mes)}
                onBlur={() => !fijado && setActivo(null)}
                onClick={() => {
                  if (abierto && fijado) cerrar();
                  else {
                    setActivo(p.mes);
                    setFijado(true);
                  }
                }}
              >
                <span className={cn("block rounded-full bg-primary ring-2 ring-background", abierto ? "h-3.5 w-3.5" : "h-2.5 w-2.5")} aria-hidden />
              </button>
            );
          })}
          {punto && (
            <div
              id={idTooltip}
              role="tooltip"
              className={cn(
                "absolute z-20 w-60 max-w-[85%] rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md",
                punto.y < ALTO / 2 ? "mt-4" : "-translate-y-full -mt-4",
                punto.x > ANCHO / 2 && "-translate-x-full",
              )}
              style={{ left: pctX(punto.x), top: pctY(punto.y) }}
              data-testid="tooltip-precio"
            >
              <DetalleMes mes={punto.mes} precio={punto.precio} unidad={unidad} compras={comprasDe?.(punto.mes)} />
            </div>
          )}
        </div>
      </div>
      <div className="mt-1 flex shrink-0 justify-between pl-16 text-[0.6875rem] tabular-nums text-muted-foreground" aria-hidden>
        {g.meses.map((m) => (
          <span key={m.mes}>{mesCorto(m.mes)}</span>
        ))}
      </div>
    </div>
  );
}
