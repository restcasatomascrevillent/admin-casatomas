// «Facturas › Márgenes» (antes «Análisis general › Márgenes de carta»): dónde NO funciona el margen.
//
//   · Arriba, cifras SOLO con lo comparable (petición del dueño, 07/11/2026:
//     «pon el precio por kilo de las cosas que vendemos por kilo primero»):
//     «Por peso» (kilo de carta frente a kilo comprado) y «Vinos» (botella
//     frente a botella). Los platos con escandallo estimado no cuentan hasta
//     marcarlos «Revisado».
//   · Pestañas Por peso (por defecto) / Vinos / Platos (borrador). En cada una,
//     la dispersión «precio de carta (€/kg en Por peso) vs % de coste» con el
//     umbral y la lista ordenada del porqué («Percebes: lo compras a 109,50
//     €/kg y lo vendes a 172,73 €/kg sin IVA (190 €/kg en carta) → ×1,58…»).
//   · Tocar un artículo (lista o gráfica) abre su detalle editable.
//   · Márgenes SIEMPRE sin IVA (20261125100000). El interruptor «Con IVA» solo
//     enseña además costes y precios con IVA (el IVA de cada compra; si es supuesto,
//     se dice). Los vinos llevan también el margen de la tienda (carta − descuento,
//     IVA 21 %), aunque la tienda esté desactivada (se avisa).
//   · Sin scroll de página (regla del dueño): el bloque ocupa el alto que le da
//     la página y solo la lista hace scroll por dentro.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChefHat, CircleSlash, Loader2, Scale, Settings2, Wine } from "lucide-react";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useMargenesCarta } from "@/hooks/useMargenesCarta";
import {
  ETIQUETA_BANDERA,
  costeVisible,
  dominioLog,
  euros,
  eurosKg,
  ivaSupuesto,
  marcasLog,
  pctDeMultiplicador,
  pctDeMultiplicadorPeso,
  platosBorrador,
  porcentaje,
  problemas,
  puntosDispersion,
  razon,
  resumenFiable,
  veces,
  type ArticuloMargen,
  type MargenesCarta as Datos,
} from "@/lib/analisis/margenesCarta";
import { DetalleArticulo } from "./DetalleArticulo";
import { DialogoUmbrales } from "./DialogoUmbrales";

type Vista = "peso" | "vinos" | "borrador";
type Filtro = "problemas" | "todos" | "sin_datos";

const fechaCorta = (f: string | null) => (f ? new Date(`${f}T00:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");

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
  const r = useMemo(() => resumenFiable(d), [d]);
  const rojo = r.peso.enRojo + r.vinos.enRojo + r.borrador.enRojoRevisados;
  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4" data-testid="margenes-resumen">
      <Cifra
        etiqueta="Al peso: multiplicador (mediana)"
        valor={veces(r.peso.multiplicadorMediana)}
        detalle={`${porcentaje(r.peso.pctMediana)} de coste · ${r.peso.conDatos} de ${r.peso.total} artículos`}
      />
      <Cifra
        etiqueta="Multiplicador de vinos (mediana)"
        valor={veces(r.vinos.multiplicadorMediana)}
        detalle={`${r.vinos.conDatos} de ${r.vinos.total} vinos · tienda ${veces(d.resumen.vinos.multiplicadorTiendaMediana)}${d.tienda.activa ? "" : " (desactivada)"}`}
      />
      <Cifra
        etiqueta="Margen en rojo"
        valor={`${rojo}`}
        detalle={
          `${r.peso.enRojo} al peso < ${veces(d.config.multiplicadorMinPeso)} · ${r.vinos.enRojo} vinos < ${veces(d.config.multiplicadorMinVino)}` +
          ` · ${d.resumen.vinos.tiendaEnRojo} en tienda < ${veces(d.config.multiplicadorMinTienda)}` +
          (r.borrador.enRojoRevisados ? ` · ${r.borrador.enRojoRevisados} platos revisados` : "")
        }
        tono={rojo > 0 ? "rojo" : "neutro"}
      />
      <Cifra
        etiqueta="Sin datos de coste"
        valor={`${r.peso.sinDatos + r.vinos.sinDatos}`}
        detalle={`${r.peso.sinDatos} al peso · ${r.vinos.sinDatos} vinos · ${r.borrador.total - r.borrador.revisados} platos en borrador`}
      />
    </div>
  );
}

const formatoEje = (n: number) => `${n.toLocaleString("es-ES", { maximumFractionDigits: n < 1 ? 1 : 0 })} €`;

function Dispersion({ lista, umbral, onElegir, eje, porKilo }: { lista: ArticuloMargen[]; umbral: number; onElegir: (id: string) => void; eje: string; porKilo: boolean }) {
  const puntos = useMemo(() => puntosDispersion(lista, umbral), [lista, umbral]);
  const rojos = puntos.filter((p) => p.rojo);
  const bien = puntos.filter((p) => !p.rojo);
  const precios = puntos.map((p) => p.precio);
  const marcas = precios.length ? marcasLog(Math.min(...precios), Math.max(...precios)) : [];
  const dominio = dominioLog(precios);
  if (puntos.length === 0) {
    return <p className="m-auto p-4 text-sm text-muted-foreground">No hay artículos con coste para dibujar.</p>;
  }
  const unidad = porKilo ? "/kg" : "";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="precio"
          name={porKilo ? "Precio del kilo" : "Precio"}
          scale="log"
          domain={dominio}
          ticks={marcas}
          interval={0}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(n: number) => `${formatoEje(n)}${unidad}`}
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
                <p className="tabular-nums">{euros(p.precio)}{unidad} · {porcentaje(p.pct)} de coste</p>
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

/** Con el interruptor «Con IVA»: coste (con el IVA de sus compras) y precio de carta con IVA. */
function LineaConIva({ a }: { a: ArticuloMargen }) {
  const coste = costeVisible(a, true);
  const supuesto = ivaSupuesto(a);
  const texto =
    a.tipo === "peso"
      ? `Con IVA: compra ${eurosKg(coste, 2)} · carta ${eurosKg(a.ventaKgIva)}`
      : `Con IVA: coste ${euros(coste)} · carta ${euros(a.precio)}` +
        (a.tipo === "vino" && a.precioTienda !== null ? ` · tienda ${euros(a.precioTienda)}` : "");
  return (
    <span className="block text-xs tabular-nums text-muted-foreground" data-testid="linea-con-iva">
      {texto}
      {supuesto && <span className="ml-1 rounded border border-dashed border-border px-1 text-[11px]">IVA supuesto</span>}
    </span>
  );
}

function FilaArticulo({ a, d, conIva, onElegir }: { a: ArticuloMargen; d: Datos; conIva: boolean; onElegir: (id: string) => void }) {
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
          {a.tipo === "plato" ? porcentaje(a.pct) : veces(a.multiplicador)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug">{razon(a, d.config)}</span>
          {a.tipo === "vino" && a.multiplicadorTienda !== null && (
            <span className={cn("block text-xs tabular-nums", a.banderas.includes("tienda_bajo") ? "text-destructive" : "text-muted-foreground")}>
              Tienda: {veces(a.multiplicadorTienda)} (mín. {veces(d.config.multiplicadorMinTienda)}){d.tienda.activa ? "" : " · tienda desactivada"}
            </span>
          )}
          {conIva && costeVisible(a, false) !== null && <LineaConIva a={a} />}
          {a.tipo === "peso" && a.ultimoProveedor && (
            <span className="block truncate text-xs text-muted-foreground">
              {a.producto} · última compra {fechaCorta(a.ultimaFecha)}, {a.ultimoProveedor}
            </span>
          )}
          <span className="mt-0.5 flex flex-wrap gap-1">
            {a.banderas.map((b) => (
              <span key={b} className="rounded border border-border/70 px-1 text-[11px] text-muted-foreground">
                {ETIQUETA_BANDERA[b]}
              </span>
            ))}
            {a.tipo === "plato" && a.origen === "estimado" && !a.revisado && (
              <span className="rounded border border-dashed border-border px-1 text-[11px] text-muted-foreground">Gramos estimados</span>
            )}
            {a.revisado && <span className="rounded bg-muted px-1 text-[11px] text-muted-foreground">Revisado</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Orden de «Todos»: de peor a mejor (multiplicador de menor a mayor; en platos, % de coste de mayor a menor). */
function ordenTodos(lista: ArticuloMargen[]): ArticuloMargen[] {
  return [...lista].sort((x, y) => {
    if (x.tipo !== "plato" && y.tipo !== "plato") return (x.multiplicador ?? Infinity) - (y.multiplicador ?? Infinity);
    return (y.pct ?? -1) - (x.pct ?? -1);
  });
}

type Elegido = { tipo: "plato" | "vino"; id: string };

/**
 * `articuloInicial`: ficha que se abre al entrar (enlace del Dashboard, `?articulo=plato:<id>`);
 * si es un vino, empieza en la vista Vinos.
 */
export function MargenesCarta({ puedeEditar, articuloInicial = null }: { puedeEditar: boolean; articuloInicial?: Elegido | null }) {
  const q = useMargenesCarta();
  const [vista, setVista] = useState<Vista>(articuloInicial?.tipo === "vino" ? "vinos" : "peso");
  const [filtro, setFiltro] = useState<Filtro>("problemas");
  const [elegido, setElegido] = useState<Elegido | null>(articuloInicial);
  const claveInicial = articuloInicial ? `${articuloInicial.tipo}:${articuloInicial.id}` : null;
  useEffect(() => {
    if (!claveInicial) return;
    const [tipo, ...resto] = claveInicial.split(":");
    setElegido({ tipo: tipo as Elegido["tipo"], id: resto.join(":") });
    if (tipo === "vino") setVista("vinos");
  }, [claveInicial]);
  const [umbrales, setUmbrales] = useState(false);
  const [conIva, setConIva] = useState(false);

  const d = q.data;
  const borrador = useMemo(() => (d ? platosBorrador(d) : []), [d]);
  const lista: ArticuloMargen[] = useMemo(() => (d ? (vista === "peso" ? d.peso : vista === "vinos" ? d.vinos : borrador) : []), [d, vista, borrador]);
  const filas = useMemo(() => {
    if (!d) return [];
    // En el borrador, «No funciona» solo enseña lo que ya está revisado: los gramos estimados no son fiables.
    if (filtro === "problemas") {
      return problemas(vista === "borrador" ? lista.filter((a) => a.revisado) : lista, d.config, { tienda: vista === "vinos" });
    }
    if (filtro === "sin_datos") return lista.filter((a) => a.pct === null);
    return ordenTodos(lista);
  }, [d, lista, filtro, vista]);
  const umbral = d
    ? vista === "peso"
      ? pctDeMultiplicadorPeso(d.config.multiplicadorMinPeso)
      : vista === "vinos"
        ? pctDeMultiplicador(d.config.multiplicadorMinVino)
        : d.config.costeMaxPlatoPct
    : 35;
  const articulo = d && elegido ? (elegido.tipo === "plato" ? d.platos : d.vinos).find((a) => a.id === elegido.id) ?? null : null;
  const elegir = (id: string) => setElegido({ tipo: vista === "vinos" ? "vino" : "plato", id });

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

  const titulo =
    filtro === "sin_datos" ? "Sin datos de coste" : filtro === "todos" ? (vista === "borrador" ? "Todos los platos" : "Todos, de peor a mejor") : "Donde no funciona el margen";
  const textoEje =
    vista === "peso"
      ? `Precio del kilo en carta (con IVA, escala logarítmica) frente a % de coste sin IVA · la línea es ${veces(d.config.multiplicadorMinPeso)}`
      : `Precio de carta (escala logarítmica) frente a % de coste sin IVA${vista === "vinos" ? ` · la línea es ${veces(d.config.multiplicadorMinVino)}` : ""}`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 sm:gap-3">
      <Resumen d={d} />
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <ToggleGroup type="single" value={vista} onValueChange={(v) => v && setVista(v as Vista)} variant="outline" aria-label="Qué parte de la carta">
          <ToggleGroupItem value="peso" className="min-h-10 gap-1.5 px-3"><Scale className="h-4 w-4" aria-hidden /> Por peso</ToggleGroupItem>
          <ToggleGroupItem value="vinos" className="min-h-10 gap-1.5 px-3"><Wine className="h-4 w-4" aria-hidden /> Vinos</ToggleGroupItem>
          <ToggleGroupItem value="borrador" className="min-h-10 gap-1.5 px-3"><ChefHat className="h-4 w-4" aria-hidden /> Platos (borrador)</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" value={filtro} onValueChange={(v) => v && setFiltro(v as Filtro)} variant="outline" aria-label="Qué enseñar">
          <ToggleGroupItem value="problemas" className="min-h-10 px-3">No funciona</ToggleGroupItem>
          <ToggleGroupItem value="todos" className="min-h-10 px-3">Todos</ToggleGroupItem>
          <ToggleGroupItem value="sin_datos" className="min-h-10 gap-1 px-3"><CircleSlash className="h-4 w-4" aria-hidden /> Sin datos</ToggleGroupItem>
        </ToggleGroup>
        <label className="ml-auto flex min-h-10 items-center gap-2 text-sm">
          <Switch checked={conIva} onCheckedChange={setConIva} aria-label="Ver costes y precios con IVA" />
          Con IVA
        </label>
        <Button variant="ghost" size="sm" className="min-h-10" onClick={() => setUmbrales(true)}>
          <Settings2 className="mr-1.5 h-4 w-4" aria-hidden /> Umbrales
        </Button>
      </div>
      {vista === "vinos" && !d.tienda.activa && (
        <p className="shrink-0 rounded-lg border border-border/70 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground" role="note" data-testid="aviso-tienda">
          La tienda de vinos está desactivada. Su margen se calcula igualmente: precio de tienda = carta − {d.tienda.descuentoPct} %, sin IVA ({d.config.ivaTiendaPct} %).
        </p>
      )}
      {vista === "borrador" && (
        <p
          className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
          role="note"
          data-testid="aviso-borrador"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Borrador: los gramos de cada plato son una <strong>estimación pendiente de revisar</strong>. No cuentan en las cifras de arriba ni en
            «Donde no funciona el margen» hasta que marques el plato como «Revisado» en su detalle.
            {" "}{borrador.filter((p) => p.revisado).length} de {borrador.length} revisados.
          </span>
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(9rem,38%)_1fr] gap-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-1 lg:gap-3">
        <section className="flex min-h-0 flex-col rounded-lg border border-border/70 bg-card p-2" aria-label="Precio de venta frente a % de coste">
          <p className="shrink-0 truncate px-1 text-xs text-muted-foreground">{textoEje}</p>
          <div className="min-h-0 flex-1">
            <Dispersion lista={lista} umbral={umbral} eje={vista === "borrador" ? "Máx." : "Mín."} porKilo={vista === "peso"} onElegir={elegir} />
          </div>
        </section>
        <section className="flex min-h-0 flex-col rounded-lg border border-border/70 bg-card" aria-label="Donde no funciona el margen">
          <p className="shrink-0 border-b border-border/70 px-3 py-2 text-sm font-medium">
            {titulo}
            <span className="ml-1 font-normal text-muted-foreground">({filas.length})</span>
          </p>
          {filas.length === 0 ? (
            <p className="m-auto p-4 text-center text-sm text-muted-foreground">
              {vista === "borrador" && filtro === "problemas" ? "Ningún plato revisado falla. Los que están sin revisar se ven en «Todos»." : "Nada que enseñar aquí."}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto overscroll-contain px-1" data-testid="margenes-lista">
              {filas.map((a) => (
                <FilaArticulo key={a.id} a={a} d={d} conIva={conIva} onElegir={elegir} />
              ))}
            </ul>
          )}
        </section>
      </div>
      <DetalleArticulo articulo={articulo} config={d.config} tiendaActiva={d.tienda.activa} conIva={conIva} puedeEditar={puedeEditar} onCerrar={() => setElegido(null)} />
      <DialogoUmbrales abierto={umbrales} config={d.config} puedeEditar={puedeEditar} onCerrar={() => setUmbrales(false)} />
    </div>
  );
}
