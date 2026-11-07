// «Análisis general › Márgenes de carta»: dónde NO funciona el margen.
//
//   · Arriba, cifras: food cost de cocina, multiplicador de vinos, en rojo, sin datos.
//   · Pestañas Platos / Vinos. En cada una, la dispersión «precio de venta vs %
//     de coste» con el umbral marcado y la lista ordenada del porqué
//     («Percebes: cuesta 110 €/kg y se vende a 172,73 €/kg sin IVA → 64 % de coste»).
//   · Tocar un artículo (en la lista o en la gráfica) abre su detalle editable.
//   · Sin scroll de página (regla del dueño): el bloque ocupa el alto que le da
//     la página y solo la lista hace scroll por dentro.
import { useMemo, useState } from "react";
import { AlertTriangle, ChefHat, CircleSlash, Loader2, Settings2, Wine } from "lucide-react";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useMargenesCarta } from "@/hooks/useMargenesCarta";
import {
  ETIQUETA_BANDERA,
  euros,
  pctDeMultiplicador,
  porcentaje,
  problemas,
  puntosDispersion,
  razon,
  veces,
  type ArticuloMargen,
  type MargenesCarta as Datos,
} from "@/lib/analisis/margenesCarta";
import { DetalleArticulo } from "./DetalleArticulo";
import { DialogoUmbrales } from "./DialogoUmbrales";

type Vista = "platos" | "vinos";
type Filtro = "problemas" | "todos" | "sin_datos";

function Cifra({ etiqueta, valor, detalle, tono }: { etiqueta: string; valor: string; detalle?: string; tono?: "rojo" | "neutro" }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card px-3 py-2">
      <p className="truncate text-xs text-muted-foreground">{etiqueta}</p>
      <p className={cn("text-xl font-semibold tabular-nums sm:text-2xl", tono === "rojo" && "text-destructive")}>{valor}</p>
      {detalle && <p className="truncate text-xs text-muted-foreground">{detalle}</p>}
    </div>
  );
}

function Resumen({ d }: { d: Datos }) {
  const p = d.resumen.platos;
  const v = d.resumen.vinos;
  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4" data-testid="margenes-resumen">
      <Cifra
        etiqueta="Food cost de cocina (mediana)"
        valor={porcentaje(p.foodCostMediana)}
        detalle={`media ${porcentaje(p.foodCostMedio)} · ${p.conDatos} de ${p.total} platos`}
      />
      <Cifra
        etiqueta="Multiplicador de vinos (mediana)"
        valor={veces(v.multiplicadorMediana)}
        detalle={`media ${veces(v.multiplicadorMedio)} · ${v.conDatos} de ${v.total} vinos`}
      />
      <Cifra
        etiqueta="Margen en rojo"
        valor={`${p.enRojo + v.enRojo}`}
        detalle={`${p.enRojo} platos > ${porcentaje(d.config.costeMaxPlatoPct)} · ${v.enRojo} vinos < ${veces(d.config.multiplicadorMinVino)}`}
        tono={p.enRojo + v.enRojo > 0 ? "rojo" : "neutro"}
      />
      <Cifra
        etiqueta="Sin datos de coste"
        valor={`${p.sinDatos + v.sinDatos}`}
        detalle={`${p.sinDatos} platos · ${v.sinDatos} vinos · suben ${p.subeCoste + v.subeCoste}`}
      />
    </div>
  );
}

function Dispersion({ lista, umbral, onElegir, eje }: { lista: ArticuloMargen[]; umbral: number; onElegir: (id: string) => void; eje: string }) {
  const puntos = useMemo(() => puntosDispersion(lista, umbral), [lista, umbral]);
  const rojos = puntos.filter((p) => p.rojo);
  const bien = puntos.filter((p) => !p.rojo);
  if (puntos.length === 0) {
    return <p className="m-auto p-4 text-sm text-muted-foreground">No hay artículos con coste para dibujar.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="precio"
          name="Precio"
          scale="log"
          domain={["auto", "auto"]}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(n: number) => `${Math.round(n)} €`}
          allowDataOverflow
        />
        <YAxis
          type="number"
          dataKey="pct"
          name="% de coste"
          unit=" %"
          width={46}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
        />
        <ZAxis range={[46, 46]} />
        <ReferenceLine
          y={umbral}
          stroke="hsl(var(--destructive))"
          strokeDasharray="5 4"
          label={{ value: `${eje} ${porcentaje(umbral)}`, position: "insideTopRight", fontSize: 11, fill: "hsl(var(--destructive))" }}
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as { nombre: string; precio: number; pct: number } | undefined;
            if (!p) return null;
            return (
              <div className="rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow">
                <p className="font-medium">{p.nombre}</p>
                <p className="tabular-nums">{euros(p.precio)} · {porcentaje(p.pct)} de coste</p>
              </div>
            );
          }}
        />
        <Scatter
          name="Bien"
          data={bien}
          fill="hsl(var(--primary))"
          fillOpacity={0.55}
          onClick={(p: { id?: string }) => p?.id && onElegir(p.id)}
          className="cursor-pointer"
        />
        <Scatter
          name="En rojo"
          data={rojos}
          fill="hsl(var(--destructive))"
          onClick={(p: { id?: string }) => p?.id && onElegir(p.id)}
          className="cursor-pointer"
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function FilaArticulo({ a, d, onElegir }: { a: ArticuloMargen; d: Datos; onElegir: (id: string) => void }) {
  const rojo = a.banderas.includes("coste_alto") || a.banderas.includes("multiplicador_bajo");
  return (
    <li>
      <button
        type="button"
        onClick={() => onElegir(a.id)}
        className="flex w-full min-h-11 items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            "mt-0.5 w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-sm font-semibold tabular-nums",
            rojo ? "bg-destructive/10 text-destructive" : a.pct === null ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
          )}
        >
          {a.tipo === "vino" ? veces(a.multiplicador) : porcentaje(a.pct)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug">{razon(a, d.config)}</span>
          <span className="mt-0.5 flex flex-wrap gap-1">
            {a.banderas.map((b) => (
              <span key={b} className="rounded border border-border/70 px-1 text-[11px] text-muted-foreground">
                {ETIQUETA_BANDERA[b]}
              </span>
            ))}
            {a.origen === "estimado" && !a.revisado && <span className="rounded border border-dashed border-border px-1 text-[11px] text-muted-foreground">Estimado</span>}
            {a.revisado && <span className="rounded bg-muted px-1 text-[11px] text-muted-foreground">Revisado</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

export function MargenesCarta({ puedeEditar }: { puedeEditar: boolean }) {
  const q = useMargenesCarta();
  const [vista, setVista] = useState<Vista>("platos");
  const [filtro, setFiltro] = useState<Filtro>("problemas");
  const [elegido, setElegido] = useState<{ tipo: Vista; id: string } | null>(null);
  const [umbrales, setUmbrales] = useState(false);

  const d = q.data;
  const lista: ArticuloMargen[] = useMemo(() => (d ? (vista === "platos" ? d.platos : d.vinos) : []), [d, vista]);
  const filas = useMemo(() => {
    if (!d) return [];
    if (filtro === "problemas") return problemas(lista, d.config);
    if (filtro === "sin_datos") return lista.filter((a) => a.pct === null);
    return [...lista].sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1));
  }, [d, lista, filtro]);
  const umbral = d ? (vista === "platos" ? d.config.costeMaxPlatoPct : pctDeMultiplicador(d.config.multiplicadorMinVino, d.config.ivaPct)) : 35;
  const articulo = d && elegido ? (elegido.tipo === "platos" ? d.platos : d.vinos).find((a) => a.id === elegido.id) ?? null : null;

  if (q.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Cruzando la carta con las facturas…
      </div>
    );
  }
  if (q.isError || !d) {
    return (
      <div className="m-auto flex max-w-md flex-col items-center gap-3 p-6 text-center" role="alert">
        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        <p className="text-sm">{q.error instanceof Error ? q.error.message : "No se han podido cargar los márgenes."}</p>
        <Button variant="outline" onClick={() => q.refetch()}>Reintentar</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 sm:gap-3">
      <Resumen d={d} />
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <ToggleGroup type="single" value={vista} onValueChange={(v) => v && setVista(v as Vista)} variant="outline" aria-label="Platos o vinos">
          <ToggleGroupItem value="platos" className="min-h-10 gap-1.5 px-3"><ChefHat className="h-4 w-4" aria-hidden /> Platos</ToggleGroupItem>
          <ToggleGroupItem value="vinos" className="min-h-10 gap-1.5 px-3"><Wine className="h-4 w-4" aria-hidden /> Vinos</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" value={filtro} onValueChange={(v) => v && setFiltro(v as Filtro)} variant="outline" aria-label="Qué enseñar">
          <ToggleGroupItem value="problemas" className="min-h-10 px-3">No funciona</ToggleGroupItem>
          <ToggleGroupItem value="todos" className="min-h-10 px-3">Todos</ToggleGroupItem>
          <ToggleGroupItem value="sin_datos" className="min-h-10 gap-1 px-3"><CircleSlash className="h-4 w-4" aria-hidden /> Sin datos</ToggleGroupItem>
        </ToggleGroup>
        <Button variant="ghost" size="sm" className="ml-auto min-h-10" onClick={() => setUmbrales(true)}>
          <Settings2 className="mr-1.5 h-4 w-4" aria-hidden /> Umbrales
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(9rem,38%)_1fr] gap-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-1 lg:gap-3">
        <section className="flex min-h-0 flex-col rounded-lg border border-border/70 bg-card p-2" aria-label="Precio de venta frente a % de coste">
          <p className="shrink-0 px-1 text-xs text-muted-foreground">
            Precio de carta (escala logarítmica) frente a % de coste sin IVA{vista === "vinos" ? ` · la línea es ${veces(d.config.multiplicadorMinVino)}` : ""}
          </p>
          <div className="min-h-0 flex-1">
            <Dispersion lista={lista} umbral={umbral} eje={vista === "platos" ? "Máx." : "Mín."} onElegir={(id) => setElegido({ tipo: vista, id })} />
          </div>
        </section>
        <section className="flex min-h-0 flex-col rounded-lg border border-border/70 bg-card" aria-label="Donde no funciona el margen">
          <p className="shrink-0 border-b border-border/70 px-3 py-2 text-sm font-medium">
            {filtro === "problemas" ? "Donde no funciona el margen" : filtro === "sin_datos" ? "Sin datos de coste" : "Toda la carta"}
            <span className="ml-1 font-normal text-muted-foreground">({filas.length})</span>
          </p>
          {filas.length === 0 ? (
            <p className="m-auto p-4 text-sm text-muted-foreground">Nada que enseñar aquí.</p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto overscroll-contain px-1" data-testid="margenes-lista">
              {filas.map((a) => (
                <FilaArticulo key={a.id} a={a} d={d} onElegir={(id) => setElegido({ tipo: vista, id })} />
              ))}
            </ul>
          )}
        </section>
      </div>
      <DetalleArticulo articulo={articulo} config={d.config} puedeEditar={puedeEditar} onCerrar={() => setElegido(null)} />
      <DialogoUmbrales abierto={umbrales} config={d.config} puedeEditar={puedeEditar} onCerrar={() => setUmbrales(false)} />
    </div>
  );
}
