// «Facturas › Márgenes › Coste vinos» (16/11/2026): la carta de vinos, botella a botella.
//
//   · Una fila por vino: precio de carta (con y sin IVA), coste EFECTIVO de la
//     botella (total pagado ÷ botellas pagadas + sin cargo) junto al precio de la
//     factura, proveedor y fecha de la última compra (con botón para abrirla),
//     multiplicador, margen en € y % y estado.
//   · Arriba, el resumen: con coste / sin coste, mediana, por debajo del mínimo y
//     datos dudosos o por revisar. Filtros por estado y categoría, buscador y orden.
//   · «Enlazar»: candidatos del catálogo por parecido de nombre (DialogoEnlazarVino).
//   · Todo sale de la RPC vinos_coste_carta (la misma fuente que el chat).
//   · Sin scroll de página (regla del dueño): solo la lista hace scroll. Tabla desde
//     tablet apaisada (lg); en tablet vertical y móvil, fichas.
import { useMemo, useState } from "react";
import { AlertTriangle, FileText, Link2, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCosteCartaVinos } from "@/hooks/useMargenesCarta";
import { euros, eurosCarta, fechaFactura, fmt, veces, type FacturaUsada } from "@/lib/analisis/margenesCarta";
import {
  ETIQUETA_AVISO,
  ETIQUETA_ESTADO,
  ETIQUETA_ORDEN,
  categoriasDe,
  filtrarYOrdenar,
  motivoEstado,
  subidaMediaSugerida,
  textoAnada,
  textoPeriodo,
  textoSinCargo,
  type CosteCartaVinos as Datos,
  type EstadoVino,
  type FiltroEstado,
  type OrdenVinos,
  type VinoCoste,
} from "@/lib/analisis/costeVinos";
import { DialogoEnlazarVino } from "./DialogoEnlazarVino";

const SELECT =
  "h-10 min-w-0 sm:flex-1 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11";

const TONO_ESTADO: Record<EstadoVino, string> = {
  bien: "bg-primary/10 text-primary",
  bajo: "bg-destructive/10 text-destructive",
  dudoso: "bg-amber-500/15 text-amber-900 dark:text-amber-200",
  revisar: "bg-amber-500/15 text-amber-900 dark:text-amber-200",
  sin_enlazar: "bg-muted text-muted-foreground",
  sin_compra: "bg-muted text-muted-foreground",
  sin_precio: "bg-muted text-muted-foreground",
};

/** Rejilla de la tabla (lg+): ×, vino, carta, coste, última compra, margen, acciones. */
const COLUMNAS = "lg:grid lg:grid-cols-[4.25rem_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_5.5rem] lg:gap-x-3";

function Cifra({ etiqueta, corta, valor, detalle, tono, onClick, activo }: { etiqueta: string; corta: string; valor: string; detalle?: string; tono?: "rojo" | "ambar"; onClick?: () => void; activo?: boolean }) {
  const contenido = (
    <>
      <p className="line-clamp-2 break-words text-[11px] leading-tight text-muted-foreground sm:line-clamp-1 sm:text-xs sm:leading-snug">
        <span className="sm:hidden">{corta}</span>
        <span className="max-sm:hidden">{etiqueta}</span>
      </p>
      <p className={cn("whitespace-nowrap text-base font-semibold tabular-nums sm:text-2xl", tono === "rojo" && "text-destructive", tono === "ambar" && "text-amber-700 dark:text-amber-300")}>{valor}</p>
      {detalle && <p className="line-clamp-2 break-words text-xs leading-snug text-muted-foreground max-sm:hidden">{detalle}</p>}
    </>
  );
  const clase = cn("min-w-0 rounded-lg border border-border/70 bg-card px-2 py-1.5 text-left sm:px-3 sm:py-2", activo && "ring-2 ring-ring");
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={activo} className={cn(clase, "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
      {contenido}
    </button>
  ) : (
    <div className={clase}>{contenido}</div>
  );
}

function Resumen({ d, filtro, onFiltro }: { d: Datos; filtro: FiltroEstado; onFiltro: (f: FiltroEstado) => void }) {
  const r = d.resumen;
  const subida = useMemo(() => subidaMediaSugerida(d.vinos), [d.vinos]);
  const alternar = (f: FiltroEstado) => onFiltro(filtro === f ? "todos" : f);
  const min = `×${fmt(d.multiplicadorMin, 1)}`;
  return (
    <div className="grid shrink-0 grid-cols-4 gap-1.5 sm:grid-cols-2 sm:gap-2 lg:grid-cols-4" data-testid="coste-vinos-resumen">
      <Cifra
        etiqueta="Vinos con coste"
        corta="Con coste"
        valor={`${r.conCoste} de ${r.total}`}
        detalle={`Sin coste ${r.sinCoste}: ${r.sinEnlazar} sin enlazar${r.conCandidato ? ` (${r.conCandidato} con propuesta)` : ""}, ${r.sinCompra} sin compra${r.sinPrecio ? `, ${r.sinPrecio} sin precio` : ""}`}
        onClick={() => alternar("sin_enlazar")}
        activo={filtro === "sin_enlazar"}
      />
      <Cifra etiqueta="Multiplicador normal (mediana)" corta="Mediana" valor={veces(r.multiplicadorMediana)} detalle={`Venta sin IVA ÷ coste efectivo · mínimo ${min}`} />
      <Cifra
        etiqueta={`Por debajo de ${min}`}
        corta={`Bajo ${min}`}
        valor={`${r.porDebajo}`}
        detalle={subida !== null ? `Para llegar a ${min} hay que subir de media ${euros(subida)} la botella` : "Ninguno"}
        tono={r.porDebajo > 0 ? "rojo" : undefined}
        onClick={() => alternar("bajo")}
        activo={filtro === "bajo"}
      />
      <Cifra
        etiqueta="Dato dudoso o por revisar"
        corta="Dudosos"
        valor={`${r.dudosos + r.revisar}`}
        detalle={`${r.dudosos} dudosos · ${r.revisar} de otro formato · ${r.anadaDistinta} de otra añada · ${r.conSinCargo} con botellas sin cargo`}
        tono={r.dudosos + r.revisar > 0 ? "ambar" : undefined}
        onClick={() => alternar(r.dudosos > 0 ? "dudoso" : "revisar")}
        activo={filtro === "dudoso" || filtro === "revisar"}
      />
    </div>
  );
}

function Etiquetas({ v }: { v: VinoCoste }) {
  const anada = textoAnada(v);
  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      <span className={cn("rounded px-1.5 text-[11px] font-medium", TONO_ESTADO[v.estado])} data-testid="estado-vino">
        {ETIQUETA_ESTADO[v.estado]}
      </span>
      {v.avisos.map((a) => (
        <span key={a} className="rounded border border-amber-500/50 px-1 text-[11px] text-amber-900 dark:text-amber-200" title={a === "anada_distinta" ? (anada ?? undefined) : undefined}>
          {a === "anada_distinta" && anada ? `Revisar añada: ${anada.toLowerCase()}` : ETIQUETA_AVISO[a]}
        </span>
      ))}
      {v.botellasSinCargo > 0 && <span className="rounded border border-border/70 px-1 text-[11px] text-muted-foreground">Con botellas sin cargo</span>}
    </span>
  );
}

/** Etiqueta de dato que solo se ve en las fichas (en la tabla ya está la cabecera). */
const Rotulo = ({ children }: { children: string }) => <span className="text-xs text-muted-foreground lg:hidden">{children}: </span>;

function FilaVino({
  v,
  d,
  puedeEditar,
  onEnlazar,
  onFactura,
}: {
  v: VinoCoste;
  d: Datos;
  puedeEditar: boolean;
  onEnlazar: (v: VinoCoste) => void;
  onFactura: (f: FacturaUsada) => void;
}) {
  const sinCargo = textoSinCargo(v);
  const motivo = motivoEstado(v, d.multiplicadorMin);
  const comparable = v.multiplicador !== null;
  const hayCoste = v.costeEfectivo !== null;
  const distinto = hayCoste && v.costeFactura !== null && Math.abs((v.costeEfectivo as number) - v.costeFactura) > 0.004;
  return (
    <li className={cn("px-2 py-2 max-lg:space-y-1 lg:items-start lg:px-3", COLUMNAS)} data-testid="fila-vino" data-estado={v.estado}>
      <div className="max-lg:float-right max-lg:ml-2">
        <span
          className={cn("inline-block w-16 rounded px-1.5 py-0.5 text-center text-sm font-semibold tabular-nums", v.estado === "bien" || v.estado === "bajo" ? TONO_ESTADO[v.estado] : "bg-muted text-muted-foreground")}
          title={v.estado === "dudoso" ? "Dato dudoso: no cuenta en el resumen" : undefined}
        >
          {veces(v.multiplicador)}
        </span>
      </div>
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold leading-snug">{v.nombre}</p>
        <p className="break-words text-xs text-muted-foreground">{v.categoria}</p>
        <Etiquetas v={v} />
        {motivo && <p className={cn("mt-0.5 break-words text-xs leading-snug", v.estado === "bajo" ? "text-destructive" : "text-muted-foreground")}>{motivo}</p>}
      </div>
      <div className="min-w-0 text-sm tabular-nums max-lg:clear-both">
        <Rotulo>Carta</Rotulo>
        <span className="font-medium">{eurosCarta(v.precio)}</span>
        {v.venta !== null && <span className="text-xs text-muted-foreground lg:block"> · {euros(v.venta)} sin IVA</span>}
        {v.precioCopa !== null && v.precioCopa > 0 && <span className="block text-xs text-muted-foreground">Copa {eurosCarta(v.precioCopa)}</span>}
      </div>
      <div className="min-w-0 text-sm tabular-nums">
        <Rotulo>Coste por botella</Rotulo>
        {hayCoste ? (
          <>
            <span className="font-medium" data-testid="coste-efectivo">{euros(v.costeEfectivo)}</span>
            <span className="text-xs text-muted-foreground"> efectivo</span>
            <span className="block break-words text-xs text-muted-foreground" data-testid="coste-factura">
              {distinto ? `Factura ${euros(v.costeFactura)}` : "Igual que en la factura"}
              {sinCargo ? ` · ${sinCargo}` : ""}
              {d.meses !== null && v.facturas !== null && v.facturas > 0 ? ` · ${v.facturas} ${v.facturas === 1 ? "factura" : "facturas"}` : ""}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      <div className="min-w-0 text-sm">
        <Rotulo>Última compra</Rotulo>
        {v.factura ? (
          <span className="inline-flex max-w-full items-start gap-1 align-top">
            <span className="min-w-0">
              <span className="line-clamp-2 break-words text-[13px] leading-snug" title={v.factura.proveedor}>{v.factura.proveedor}</span>
              <span className="line-clamp-2 break-words text-xs tabular-nums text-muted-foreground" title={v.producto ?? undefined}>{fechaFactura(v.factura.fecha, d.hoy)}{v.producto ? ` · ${v.producto}` : ""}</span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 pointer-coarse:h-11 pointer-coarse:w-11"
              onClick={() => onFactura(v.factura as FacturaUsada)}
              aria-label={`Abrir la última factura de ${v.nombre}`}
              title="Abrir la factura"
            >
              <FileText className="h-4 w-4" aria-hidden />
            </Button>
          </span>
        ) : (
          <span className="break-words text-xs text-muted-foreground">{v.producto ? `Enlazado a «${v.producto}», sin compras` : "—"}</span>
        )}
      </div>
      <div className="min-w-0 text-sm tabular-nums">
        <Rotulo>Margen</Rotulo>
        {comparable && v.margen !== null ? (
          <>
            <span className={cn("font-medium", v.estado === "dudoso" && "text-muted-foreground")}>{euros(v.margen)}</span>
            <span className="text-xs text-muted-foreground"> · {v.margenPct !== null ? `${fmt(v.margenPct, 0)} %` : "—"}</span>
            {v.copa && (
              <span className="block text-xs text-muted-foreground" data-testid="margen-copa">
                Copa: {euros(v.copa.margen)} ({veces(v.copa.multiplicador)})
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      <div className="lg:text-right">
        <Button
          variant={v.estado === "sin_enlazar" && puedeEditar ? "outline" : "ghost"}
          size="sm"
          className="min-h-9 px-2 pointer-coarse:min-h-11"
          onClick={() => onEnlazar(v)}
          aria-label={`${v.productoId === null ? "Enlazar" : "Cambiar el enlace de"} ${v.nombre}`}
        >
          <Link2 className="mr-1 h-4 w-4" aria-hidden />
          {v.productoId === null ? "Enlazar" : "Enlace"}
        </Button>
      </div>
    </li>
  );
}

const ESTADOS_FILTRO: { valor: FiltroEstado; texto: (d: Datos) => string }[] = [
  { valor: "todos", texto: (d) => `Todos (${d.resumen.total})` },
  { valor: "bajo", texto: (d) => `Por debajo de ×${fmt(d.multiplicadorMin, 1)} (${d.resumen.porDebajo})` },
  { valor: "bien", texto: (d) => `Bien (${d.resumen.conCoste - d.resumen.porDebajo})` },
  { valor: "sin_enlazar", texto: (d) => `Sin enlazar (${d.resumen.sinEnlazar})` },
  { valor: "sin_compra", texto: (d) => `Sin compra (${d.resumen.sinCompra})` },
  { valor: "dudoso", texto: (d) => `Dato dudoso (${d.resumen.dudosos})` },
  { valor: "revisar", texto: () => "Revisar (formato o añada)" },
  { valor: "sin_cargo", texto: (d) => `Con botellas sin cargo (${d.resumen.conSinCargo})` },
];

export function CosteCartaVinos({ puedeEditar, onFactura }: { puedeEditar: boolean; onFactura: (f: FacturaUsada) => void }) {
  const [meses, setMeses] = useState<number | null>(null);
  const q = useCosteCartaVinos(meses);
  const [estado, setEstado] = useState<FiltroEstado>("todos");
  const [categoria, setCategoria] = useState("");
  const [texto, setTexto] = useState("");
  const [orden, setOrden] = useState<OrdenVinos>("peor");
  const [enlazar, setEnlazar] = useState<string | null>(null);

  const d = q.data;
  const filas = useMemo(() => (d ? filtrarYOrdenar(d.vinos, { estado, categoria, texto, orden }) : []), [d, estado, categoria, texto, orden]);
  const categorias = useMemo(() => (d ? categoriasDe(d.vinos) : []), [d]);
  const vinoEnlazar = d && enlazar ? (d.vinos.find((v) => v.id === enlazar) ?? null) : null;

  if (q.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Calculando el coste de cada vino…
      </div>
    );
  }
  if (q.isError || !d) {
    return (
      <div className="m-auto flex max-w-md flex-col items-center gap-3 p-6 text-center" role="alert">
        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        <p className="text-sm">{q.error instanceof Error ? q.error.message : "No se ha podido cargar el coste de la carta de vinos."}</p>
        <Button variant="outline" onClick={() => q.refetch()}>Reintentar</Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 max-lg:flex-none sm:gap-3" data-testid="coste-carta-vinos">
      <Resumen d={d} filtro={estado} onFiltro={setEstado} />
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:flex-nowrap">
        <label className="relative col-span-2 min-w-0 sm:w-full lg:w-48 lg:shrink-0">
          <span className="sr-only">Buscar vino, producto o proveedor</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar vino o proveedor" className="h-10 pl-8 pointer-coarse:h-11" type="search" />
        </label>
        <select className={SELECT} value={estado} onChange={(e) => setEstado(e.target.value as FiltroEstado)} aria-label="Estado">
          {ESTADOS_FILTRO.map((e) => (
            <option key={e.valor} value={e.valor}>{e.texto(d)}</option>
          ))}
        </select>
        <select className={SELECT} value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select className={SELECT} value={orden} onChange={(e) => setOrden(e.target.value as OrdenVinos)} aria-label="Orden">
          {(Object.keys(ETIQUETA_ORDEN) as OrdenVinos[]).map((o) => (
            <option key={o} value={o}>{ETIQUETA_ORDEN[o]}</option>
          ))}
        </select>
        <select className={SELECT} value={meses ?? ""} onChange={(e) => setMeses(e.target.value ? Number(e.target.value) : null)} aria-label="De qué facturas sale el coste efectivo">
          <option value="">Coste: última factura</option>
          <option value="6">Coste: últimos 6 meses</option>
          <option value="12">Coste: últimos 12 meses</option>
        </select>
        {q.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Actualizando" />}
      </div>
      <p className="shrink-0 break-words text-xs leading-snug text-muted-foreground" data-testid="coste-vinos-supuestos">
        Coste efectivo = total pagado ÷ (botellas pagadas + botellas sin cargo), con la {textoPeriodo(d.meses)}, sin IVA.{" "}
        <span className="max-sm:hidden">Multiplicador = precio de carta sin IVA ({fmt(d.ivaPct, 0)} %) ÷ coste efectivo. </span>
        Margen por copa: se suponen <strong>{fmt(d.copasPorBotella, 0)} copas por botella</strong>.
      </p>
      <section className="flex min-h-[16rem] flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-card max-lg:flex-none max-lg:overflow-visible" aria-label="Coste de la carta de vinos">
        <div className={cn("hidden shrink-0 border-b border-border/70 px-3 py-2 text-xs font-medium text-muted-foreground", COLUMNAS)} aria-hidden>
          <span>Multiplic.</span>
          <span>Vino ({filas.length})</span>
          <span>Carta</span>
          <span>Coste por botella</span>
          <span>Última compra</span>
          <span>Margen</span>
          <span className="text-right">Enlace</span>
        </div>
        <p className="shrink-0 border-b border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground lg:hidden">{filas.length} vinos</p>
        {filas.length === 0 ? (
          <p className="m-auto p-4 text-center text-sm text-muted-foreground">Ningún vino con esos filtros.</p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto overscroll-contain max-lg:overflow-visible" data-testid="coste-vinos-lista">
            {filas.map((v) => (
              <FilaVino key={v.id} v={v} d={d} puedeEditar={puedeEditar} onEnlazar={(x) => setEnlazar(x.id)} onFactura={onFactura} />
            ))}
          </ul>
        )}
      </section>
      <DialogoEnlazarVino vino={vinoEnlazar} hoy={d.hoy} puedeEditar={puedeEditar} onCerrar={() => setEnlazar(null)} />
    </div>
  );
}
