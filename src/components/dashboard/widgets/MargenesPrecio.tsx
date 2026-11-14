// Dashboard › «Márgenes de precio» (10/11/2026, petición del dueño). Lo que no
// funciona de la carta según lo que cuesta comprarlo (Facturas › Márgenes, la
// misma consulta y las mismas cuentas: ver lib/dashboard/margenesDashboard.ts)
// y las subidas de proveedor que tocan algún artículo. Cada fila lleva a su
// ficha en Facturas › Márgenes. Solo lo monta quien consulta Facturas.
//
// Llena el hueco que le da el Dashboard (`h-full`, columna flex) y solo su
// lista hace scroll por dentro.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Percent, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useMargenesCarta } from "@/hooks/useMargenesCarta";
import { useAlertasFacturas } from "@/hooks/useAlertasFacturas";
import { fmt } from "@/lib/analisis/margenesCarta";
import {
  cifraMargen,
  costeYVenta,
  cuentasMargenes,
  enlaceArticulo,
  peoresMargenes,
  subidasQueAfectan,
  tipoMargen,
  ultimaFacturaCorta,
  umbralMargen,
} from "@/lib/dashboard/margenesDashboard";
import { cn } from "@/lib/utils";

const FOCO = "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function MargenesPrecio() {
  const q = useMargenesCarta();
  const alertasQ = useAlertasFacturas(null);
  const d = q.data;
  const peores = useMemo(() => (d ? peoresMargenes(d, 5) : []), [d]);
  const subidas = useMemo(() => (d ? subidasQueAfectan(d, alertasQ.data ?? [], 3) : []), [d, alertasQ.data]);
  const cuentas = useMemo(() => (d ? cuentasMargenes(d) : null), [d]);

  if (q.isError) {
    return <EstadoErrorCarga titulo="los márgenes de precio" error={q.error} onReintentar={() => q.refetch()} className="h-full" />;
  }

  return (
    <Card className="flex h-full flex-col" data-testid="widget-margenes">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1 space-y-0 px-4 py-2.5 sm:px-5">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
          <Percent className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Márgenes de precio
        </CardTitle>
        <Link to="/facturas?tab=margenes" className={cn("inline-flex min-h-8 items-center gap-1 px-1 text-xs font-medium text-primary hover:underline", FOCO)}>
          Ver todos <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </CardHeader>
      <CardContent className="flex min-h-[160px] flex-1 flex-col gap-2 overflow-hidden px-4 pb-3 pt-0 sm:px-5">
        {q.isLoading || !d || !cuentas ? (
          <p className="m-auto text-sm text-muted-foreground" role="status">Cruzando la carta con las facturas…</p>
        ) : (
          <>
            <p className="shrink-0 text-xs text-muted-foreground" data-testid="margenes-cuentas">
              <b className={cn("font-semibold tabular-nums", cuentas.enRojo > 0 ? "text-destructive" : "text-foreground")}>{cuentas.enRojo}</b>{" "}
              {cuentas.enRojo === 1 ? "artículo con el margen en rojo" : "artículos con el margen en rojo"} ·{" "}
              <b className="font-semibold tabular-nums text-foreground">{cuentas.subeCoste}</b> con el coste subiendo
            </p>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
              {peores.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">Ningún artículo por debajo de su margen mínimo.</p>
              ) : (
                <ul aria-label="Peores márgenes" className="divide-y divide-border/60">
                  {peores.map((a) => (
                    <li key={`${a.tipo}:${a.id}`}>
                      <Link to={enlaceArticulo(a)} className={cn("flex items-center gap-2 py-1.5 hover:bg-muted/50", FOCO)}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{a.nombre}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {tipoMargen(a)} · {umbralMargen(a, d)}
                            {a.banderas.includes("sube_coste") && a.variacionPct !== null && ` · coste +${fmt(a.variacionPct, 0)} %`}
                          </span>
                          {costeYVenta(a) && <span className="block truncate text-xs tabular-nums text-foreground/80">{costeYVenta(a)} (sin IVA)</span>}
                          {/* 13/11/2026 (dueño): de qué factura sale el coste, siempre la última. */}
                          {ultimaFacturaCorta(a, d.hoy) && (
                            <span className="block truncate text-xs tabular-nums text-muted-foreground">{ultimaFacturaCorta(a, d.hoy)}</span>
                          )}
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-destructive">{cifraMargen(a)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {subidas.length > 0 && (
                <section aria-label="Subidas de proveedor que afectan a la carta">
                  <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Suben de precio
                  </h3>
                  <ul className="divide-y divide-border/60">
                    {subidas.map((s) => (
                      <li key={s.alerta.id}>
                        <Link to={enlaceArticulo(s.articulos[0])} className={cn("flex items-center gap-2 py-1.5 hover:bg-muted/50", FOCO)}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{s.alerta.datos.producto ?? s.alerta.titulo}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {s.alerta.datos.proveedor ? `${s.alerta.datos.proveedor} · ` : ""}afecta a {s.articulos.map((a) => a.nombre).join(", ")}
                            </span>
                          </span>
                          {s.alerta.datos.variacionPct !== null && (
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-red-700 dark:text-red-400">+{fmt(s.alerta.datos.variacionPct, 0)} %</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
