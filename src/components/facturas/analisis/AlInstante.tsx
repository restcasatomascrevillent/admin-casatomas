// «Al instante» bajo la gráfica de «Explorar» (Facturas › Análisis, 06/11/2026).
//
//   · FilaAlInstante: los diez chips (sin IA). En el móvil van en una tira con
//     scroll horizontal y degradados que avisan de que hay más; desde `sm`, en
//     varias líneas. 44 px de alto, `aria-pressed` y tooltip con su explicación.
//   · ResultadoAlInstante: lo que ocupa el HUECO de la gráfica al pulsar uno
//     (gráfica, tabla o lista), con título, periodo y «Volver al explorador».
//
// Cada chip llama a una RPC `*_agente` (lib/facturas/alInstante.ts). Respetan el
// periodo de arriba (salvo «Gasto este mes»); ninguna separa por local, y se dice.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarRange,
  ClipboardCheck,
  FileQuestion,
  FolderOpen,
  LineChart,
  Loader2,
  Package,
  PieChart,
  Search,
  Table2,
  TrendingUp,
  Truck,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatEntero, formatImporte, formatNumero, plural } from "@/components/facturas/shared/formatters";
import { GraficoSeriePrecio } from "@/components/facturas/GraficoSeriePrecio";
import { EstadoError, EstadoVacio } from "@/components/facturas/compras/estilo";
import { useBuscarProductosComprados } from "@/hooks/useTableroCompras";
import { leerUmbralSubidaPrecio, llamarRpcSupabase } from "@/hooks/usePreguntasRapidas";
import {
  CHIPS_VISIBLES,
  chipAlInstante,
  consultarAlInstante,
    exploracionCategorias,
  exploracionGastoPorMes,
  exploracionTopProveedores,
  gastoDeResumen,
  textoAyudaChip,
  type DatosAlInstante,
  type DocumentoCompacto,
  type IdAlInstante,
  type ListaDocs,
  type ResumenPeriodo,
} from "@/lib/facturas/alInstante";
import { formatFechaEs, formatPorcentaje, formatPrecioUnidad, RpcNoDisponibleError } from "@/lib/facturas/preguntasRapidas";
import { enlaceDocumentoCompras } from "@/lib/facturas/documentosCifra";
import { ENLACE_PRODUCTOS_COMPRAS } from "@/lib/facturas/tableroCompras";
import { etiquetaMes } from "@/lib/facturas/agrupacionDocumentos";
import { isoLocal } from "@/lib/facturas/periodoAnalisis";
import type { Exploracion, LocalRpc } from "@/lib/facturas/explorador";
import { GraficaExplorador, TablaExploracion } from "./GraficaExplorador";
import { FOCO } from "./piezas";

const ICONOS: Record<IdAlInstante, LucideIcon> = {
  "gasto-mes": Wallet,
  "gasto-por-mes": CalendarRange,
  "top-proveedores": Truck,
  "productos-mas-comprados": Package,
  "por-revisar": ClipboardCheck,
  "con-avisos": AlertTriangle,
  "sin-total": FileQuestion,
  "gasto-categoria": PieChart,
  "subidas-precio": TrendingUp,
  "evolucion-precio": LineChart,
};

const ACCION =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
const AVISO = "text-xs text-amber-800 dark:text-amber-300";
const TEXTO_RPC_NO_DISPONIBLE = "Pendiente de actualizar la base de datos: estará disponible en cuanto se aplique.";

export interface ProductoAlInstante {
  producto: string;
  unidad: string | null;
}

// ─── Fila de chips ──────────────────────────────────────────────────────────

/** Degradados de los bordes de la tira (móvil): avisan de que hay más chips fuera de la vista. */
function useBordes() {
  const ref = useRef<HTMLDivElement>(null);
  const [bordes, setBordes] = useState({ izq: false, der: false });
  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const izq = el.scrollLeft > 1;
    const der = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setBordes((b) => (b.izq === izq && b.der === der ? b : { izq, der }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", medir);
      ro?.disconnect();
    };
  }, [medir]);
  return { ref, bordes };
}

export function FilaAlInstante({
  activo,
  onElegir,
  cargando,
}: {
  activo: IdAlInstante | null;
  /** null = volver a la gráfica del explorador (pulsar el chip activo). */
  onElegir: (id: IdAlInstante | null) => void;
  /** El chip cuyo resultado se está consultando. */
  cargando?: boolean;
}) {
  const idAyuda = useId();
  const { ref, bordes } = useBordes();
  // El chip activo, a la vista en la tira del móvil.
  useEffect(() => {
    const el = ref.current;
    const chip = activo ? el?.querySelector<HTMLElement>(`[data-chip="${activo}"]`) : null;
    if (!el || !chip || el.scrollWidth <= el.clientWidth + 1) return;
    const izq = chip.offsetLeft - 24;
    const der = chip.offsetLeft + chip.offsetWidth + 24 - el.clientWidth;
    if (izq < el.scrollLeft) el.scrollLeft = Math.max(0, izq);
    else if (der > el.scrollLeft) el.scrollLeft = der;
  }, [activo, ref]);
  const degradado = "pointer-events-none absolute inset-y-0 z-10 w-8 from-card to-transparent sm:hidden";
  return (
    <div className="flex min-w-0 flex-col border-t border-border/60 pt-3" data-testid="al-instante" data-tour="facturas-analisis-al-instante">
      <TooltipProvider delayDuration={300}>
        <div className="relative min-w-0">
          <div
            ref={ref}
            role="group"
            aria-label="Más consultas"
            className="-mx-1 flex snap-x gap-1.5 overflow-x-auto overscroll-x-contain px-1 pb-1 no-scrollbar sm:flex-wrap sm:overflow-visible"
          >
            {CHIPS_VISIBLES.map((c) => {
              const Icono = ICONOS[c.id];
              const pulsado = activo === c.id;
              return (
                <Tooltip key={c.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-chip={c.id}
                      aria-pressed={pulsado}
                      aria-describedby={`${idAyuda}-${c.id}`}
                      aria-busy={(pulsado && cargando) || undefined}
                      onClick={() => onElegir(pulsado ? null : c.id)}
                      className={cn(
                        // Más discretos que los presets de arriba: sin borde, fondo suave e icono en dorado.
                        "inline-flex min-h-11 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-full border border-transparent bg-muted/50 px-3.5 text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground motion-reduce:transition-none sm:min-h-9 pointer-coarse:min-h-11",
                        "[&>svg]:text-[hsl(38,59%,38%)] aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:pr-2 aria-pressed:font-medium aria-pressed:text-foreground",
                        FOCO,
                      )}
                    >
                      {pulsado && cargando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icono className="h-4 w-4" aria-hidden />}
                      {c.etiqueta}
                      {pulsado && (
                        <span className="ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15" aria-hidden>
                          <X className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[18rem] text-xs">
                    {textoAyudaChip(c)}
                    {pulsado && <span className="mt-0.5 block text-muted-foreground">Pulsa otra vez para volver a la gráfica del explorador.</span>}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          {bordes.izq && <span aria-hidden="true" data-testid="al-instante-mas-izq" className={cn(degradado, "left-0 bg-gradient-to-r")} />}
          {bordes.der && <span aria-hidden="true" data-testid="al-instante-mas-der" className={cn(degradado, "right-0 bg-gradient-to-l")} />}
        </div>
      </TooltipProvider>
      {/* La explicación de cada chip para lectores de pantalla (el tooltip es solo visual). */}
      <div className="sr-only">
        {CHIPS_VISIBLES.map((c) => (
          <span key={c.id} id={`${idAyuda}-${c.id}`}>
            {c.descripcion}
            {activo === c.id ? ". Pulsa otra vez para volver a la gráfica del explorador." : "."}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Consulta ───────────────────────────────────────────────────────────────

function useAlInstante(id: IdAlInstante | null, periodo: { desde: string | null; hasta: string | null }, hoy: Date, producto: ProductoAlInstante | null) {
  const pideProducto = id ? chipAlInstante(id).pide === "producto" : false;
  const mesHoy = isoLocal(hoy).slice(0, 7);
  return useQuery({
    queryKey: [
      "al-instante",
      id,
      id === "gasto-mes" ? mesHoy : periodo.desde,
      id === "gasto-mes" ? null : periodo.hasta,
      pideProducto ? producto?.producto ?? null : null,
      pideProducto ? producto?.unidad ?? null : null,
    ],
    enabled: !!id && (!pideProducto || !!producto),
    staleTime: 60_000,
    retry: false,
    // Al cambiar el periodo se queda lo anterior (atenuado) mientras llega lo nuevo.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === id ? prev : undefined),
    queryFn: () =>
      consultarAlInstante(id as IdAlInstante, llamarRpcSupabase, {
        desde: periodo.desde,
        hasta: periodo.hasta,
        hoy,
        producto,
        umbralSubidaPrecio: leerUmbralSubidaPrecio,
      }),
  });
}

// ─── Piezas de los resultados ───────────────────────────────────────────────

/** Barra proporcional (decorativa: la cifra va escrita). */
function Barra({ valor, maximo }: { valor: number; maximo: number }) {
  const pct = maximo > 0 ? Math.max(0, Math.min(100, (valor / maximo) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-muted" aria-hidden>
      <div className="h-1.5 rounded-full bg-sky-700 dark:bg-sky-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

interface Aviso {
  texto: string;
  docs?: ListaDocs["docs"];
}

function Avisos({ avisos }: { avisos: (Aviso | null | false | undefined)[] }) {
  const lista = avisos.filter((a): a is Aviso => !!a);
  if (lista.length === 0) return null;
  return (
    <ul className="space-y-1" aria-label="Avisos de los datos">
      {lista.map((a) => (
        <li key={a.texto} className={AVISO}>
          {a.docs && a.docs.length > 0 ? (
            <details className="group">
              <summary className={cn("flex min-h-11 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden", FOCO)}>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  {a.texto} <span className="underline decoration-dotted group-open:hidden">Ver cuáles</span>
                </span>
              </summary>
              <ul className="mb-1 ml-5 list-disc space-y-0.5 text-muted-foreground">
                {a.docs.map((d) => (
                  <li key={d.id}>{[d.proveedor, d.numero, d.fecha ? formatFechaEs(d.fecha) : null].filter(Boolean).join(" · ") || `Documento ${d.id}`}</li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{a.texto}</span>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Gráfica de «Al instante» con su tabla a un toque (lo navegable con teclado). */
function GraficaConTabla({ ex, tipo, descripcion, cuenta }: { ex: Exploracion; tipo: "barras" | "horizontales"; descripcion: string; cuenta?: { uno: string; varios: string } }) {
  const [tabla, setTabla] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex justify-end">
        <button type="button" className={cn(ACCION, "-my-1 text-xs", FOCO)} aria-pressed={tabla} onClick={() => setTabla((v) => !v)}>
          <Table2 className="h-4 w-4" aria-hidden /> Ver como tabla
        </button>
      </div>
      {tabla ? <TablaExploracion exploracion={ex} /> : <GraficaExplorador exploracion={ex} tipo={tipo} descripcion={descripcion} cuenta={cuenta} />}
    </div>
  );
}

// ─── Cada resultado ─────────────────────────────────────────────────────────

const mesLargo = (clave: string) => etiquetaMes(clave);

function CifraMes({ titulo, nota, r, gasto }: { titulo: string; nota: string; r: ResumenPeriodo; gasto: number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {titulo} <span className="font-normal">· {nota}</span>
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{formatImporte(gasto)}</p>
      <p className="text-xs text-muted-foreground">
        {plural(r.facturas?.n ?? 0, "factura", "facturas")}
        {(r.albaranes?.n ?? 0) > 0 && ` · ${plural(r.albaranes?.n ?? 0, "albarán sin factura", "albaranes sin factura")}`} · IVA incluido
      </p>
      {r.sin_datos && <p className="mt-1 text-xs text-muted-foreground">Sin documentos cargados: 0 es «sin datos», no «no se gastó nada».</p>}
    </div>
  );
}

function GastoMes({ datos }: { datos: Extract<DatosAlInstante, { id: "gasto-mes" }> }) {
  const { actual, anterior } = datos;
  const gA = gastoDeResumen(actual.resumen);
  const gB = gastoDeResumen(anterior.resumen);
  const dif = gA - gB;
  const dia = Number(actual.hasta.slice(8, 10));
  const proveedores = (actual.resumen.proveedores ?? []).filter((p) => typeof p.gasto === "number").slice(0, 3);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <CifraMes titulo={mesLargo(actual.mes)} nota={`en curso, hasta el día ${dia}`} r={actual.resumen} gasto={gA} />
        <CifraMes titulo={mesLargo(anterior.mes)} nota="mes completo" r={anterior.resumen} gasto={gB} />
      </div>
      <p className="text-sm text-foreground">
        Diferencia: <span className="font-semibold tabular-nums">{dif > 0 ? "+" : ""}{formatImporte(dif)}</span>
        {gB > 0 && <span className="tabular-nums text-muted-foreground"> ({formatPorcentaje((dif / gB) * 100)})</span>}
        <span className="text-xs text-muted-foreground"> · el mes en curso aún no ha terminado</span>
      </p>
      {proveedores.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Más gasto este mes: {proveedores.map((p) => `${p.proveedor} (${formatImporte(p.gasto ?? 0)})`).join(" · ")}
        </p>
      )}
      <Avisos
        avisos={[
          (actual.resumen.facturas?.si_das_importes?.sin_total?.n ?? 0) > 0 && {
            texto: `Cifra parcial: ${plural(actual.resumen.facturas?.si_das_importes?.sin_total?.n ?? 0, "factura", "facturas")} de este mes sin total (no suman).`,
            docs: actual.resumen.facturas?.si_das_importes?.sin_total?.docs,
          },
        ]}
      />
    </div>
  );
}

function GastoPorMes({ datos, hoy }: { datos: Extract<DatosAlInstante, { id: "gasto-por-mes" }>; hoy: Date }) {
  const ex = useMemo(() => exploracionGastoPorMes(datos, hoy), [datos, hoy]);
  if (ex.sinDatos) return <Vacio texto="No hay documentos en este periodo." />;
  const sinTotal = datos.meses.reduce((s, m) => s + (m.sin_total ?? 0), 0);
  const deducidos = datos.meses.reduce((s, m) => s + (m.deducidos ?? 0), 0);
  const dudosa = datos.meses.reduce((s, m) => s + (m.fecha_dudosa ?? 0), 0);
  const conDatos = ex.puntos.filter((p) => p.documentos > 0);
  const max = conDatos.reduce((a, b) => ((b.valor ?? 0) > (a.valor ?? 0) ? b : a), conDatos[0]);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        Total: <span className="font-semibold tabular-nums">{formatImporte(ex.total.valor)}</span>{" "}
        <span className="text-xs text-muted-foreground">· {plural(ex.total.documentos, "documento", "documentos")} · IVA incluido</span>
      </p>
      <GraficaConTabla
        ex={ex}
        tipo="barras"
        descripcion={`Gasto por mes. Total ${formatImporte(ex.total.valor)}${max ? `; el mes más alto, ${mesLargo(max.clave)}: ${formatImporte(max.valor)}` : ""}.`}
      />
      <Avisos
        avisos={[
          datos.truncado && { texto: "Se enseñan los 24 meses más recientes con documentos." },
          sinTotal > 0 && { texto: `Cifra parcial: ${plural(sinTotal, "documento", "documentos")} sin total (no suman).` },
          deducidos > 0 && { texto: `${plural(deducidos, "documento", "documentos")} con el total calculado desde las líneas, no leído del documento.` },
          dudosa > 0 && { texto: `${plural(dudosa, "documento", "documentos")} con fecha dudosa (puede estar en otro mes).` },
        ]}
      />
    </div>
  );
}

function TopProveedores({ datos, periodo }: { datos: Extract<DatosAlInstante, { id: "top-proveedores" }>; periodo: { desde: string | null; hasta: string | null } }) {
  const { ranking } = datos;
  const ex = useMemo(() => exploracionTopProveedores(ranking, periodo.desde, periodo.hasta), [ranking, periodo.desde, periodo.hasta]);
  if (ranking.filas.length === 0) return <Vacio texto="No hay gasto de proveedores en este periodo." />;
  const primero = ranking.filas[0];
  return (
    <div className="flex flex-col gap-2">
      <GraficaConTabla
        ex={ex}
        tipo="horizontales"
        descripcion={`Los ${ranking.filas.length} proveedores con más gasto. El primero, ${primero.proveedor}: ${formatImporte(primero.importe)}.`}
      />
      {ranking.truncado && (
        <p className="text-xs text-muted-foreground">
          Se enseñan {formatEntero(ranking.filas.length)} de {plural(ranking.total_filas, "proveedor", "proveedores")}.
        </p>
      )}
      <Avisos
        avisos={[
          ranking.documentos_sin_total && ranking.documentos_sin_total.n > 0 && {
            texto: `Cifra parcial: ${plural(ranking.documentos_sin_total.n, "documento", "documentos")} sin total (no suman).`,
            docs: ranking.documentos_sin_total.docs,
          },
          ranking.documentos_deducidos && ranking.documentos_deducidos.n > 0 && {
            texto: `${plural(ranking.documentos_deducidos.n, "documento", "documentos")} con el total calculado desde las líneas.`,
            docs: ranking.documentos_deducidos.docs,
          },
        ]}
      />
    </div>
  );
}

function ProductosMasComprados({ datos }: { datos: Extract<DatosAlInstante, { id: "productos-mas-comprados" }> }) {
  const grupos = datos.grupos.filter((g) => g.ranking.filas.length > 0);
  if (grupos.length === 0) return <Vacio texto="No hay líneas de producto en este periodo." />;
  const excluidas = Math.max(0, ...datos.grupos.map((g) => g.ranking.servicios_excluidos?.n ?? 0));
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))]">
        {grupos.map((g) => {
          const maximo = Math.max(0, ...g.ranking.filas.map((f) => f.cantidad ?? 0));
          return (
            <section key={g.unidad} className="rounded-lg border border-border/60 bg-background p-2.5" aria-label={`Más comprados ${g.titulo.toLowerCase()}`}>
              <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.titulo}</h5>
              <ol className="space-y-1.5">
                {g.ranking.filas.map((f) => (
                  <li key={`${f.producto}-${f.unidad ?? ""}`} className="text-sm">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate" title={f.producto}>
                        {f.producto}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {f.cantidad !== undefined ? formatNumero(f.cantidad) : "—"} {f.unidad ?? g.unidad}
                      </span>
                    </span>
                    <Barra valor={f.cantidad ?? 0} maximo={maximo} />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Cantidad sumada de todas las compras del periodo. Kilos con kilos y litros con litros: no se mezclan.</p>
      <Avisos avisos={[excluidas > 0 && { texto: `No cuenta ${plural(excluidas, "línea de servicio", "líneas de servicio")} (portes, mano de obra…).` }]} />
    </div>
  );
}

const VACIO_DOCS: Record<"por-revisar" | "con-avisos" | "sin-total", string> = {
  "por-revisar": "No hay documentos por revisar en este periodo.",
  "con-avisos": "Ningún documento del periodo tiene avisos.",
  "sin-total": "Todos los documentos del periodo tienen total.",
};

function FilaDocumento({ d, conAvisos, onIrA }: { d: DocumentoCompacto; conAvisos: boolean; onIrA?: (enlace: string) => void }) {
  const tipo = d.tipo === "albaran" ? "Albarán" : d.tipo === "abono" ? "Abono" : "Factura";
  const avisos = conAvisos ? d.alertas ?? [] : [];
  return (
    <li className="flex items-start gap-2 py-1.5">
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn("rounded px-1.5 text-xs font-semibold uppercase", d.tipo === "albaran" ? "bg-sky-500/10 text-sky-800 dark:text-sky-300" : "bg-muted text-muted-foreground")}>{tipo}</span>
          <span className="font-medium">{d.numero ?? "sin número"}</span>
          <span className="min-w-0 truncate text-muted-foreground">{d.proveedor ?? "sin proveedor"}</span>
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {formatFechaEs(d.fecha)}
          {d.fecha_dudosa && <span className={AVISO}> (fecha dudosa)</span>}
          {" · "}
          {d.sin_total || d.total === null || d.total === undefined ? (
            <span className={AVISO}>sin total</span>
          ) : (
            <>
              {formatImporte(d.total)}
              {d.total_origen === "deducido" && <span className={AVISO}> (deducido{d.iva_conocido === false ? ", sin IVA" : ""})</span>}
            </>
          )}
        </p>
        {avisos.length > 0 && (
          <ul className="mt-0.5 space-y-0.5">
            {avisos.slice(0, 2).map((a, i) => (
              <li key={`${a.codigo}-${i}`} className={cn(AVISO, "line-clamp-2 break-words")}>
                {a.mensaje}
              </li>
            ))}
            {avisos.length > 2 && <li className="text-xs text-muted-foreground">y {plural(avisos.length - 2, "aviso más", "avisos más")}</li>}
          </ul>
        )}
      </div>
      {onIrA && (
        <button
          type="button"
          onClick={() => onIrA(enlaceDocumentoCompras(d.id))}
          className={cn(ACCION, "text-foreground", FOCO)}
          aria-label={`Abrir ${d.tipo === "albaran" ? "el albarán" : "la factura"} ${d.numero ?? d.id} en Compras`}
        >
          <FolderOpen className="h-4 w-4" aria-hidden /> Abrir
        </button>
      )}
    </li>
  );
}

function Documentos({ datos, onIrA }: { datos: Extract<DatosAlInstante, { id: "por-revisar" | "con-avisos" | "sin-total" }>; onIrA?: (enlace: string) => void }) {
  const { lista, id } = datos;
  if (lista.total_filas === 0) return <Vacio texto={VACIO_DOCS[id]} />;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{plural(lista.total_filas, "documento", "documentos")}</p>
      <ul className="max-h-[26rem] divide-y divide-border/40 overflow-y-auto overscroll-contain rounded-lg border border-border/60 bg-background px-3" aria-label="Documentos">
        {lista.filas.map((d) => (
          <FilaDocumento key={d.id} d={d} conAvisos={id === "con-avisos"} onIrA={onIrA} />
        ))}
      </ul>
      {lista.truncado && (
        <p className="text-xs text-muted-foreground">
          Se enseñan {formatEntero(lista.filas.length)} de {formatEntero(lista.total_filas)}, los más recientes: el resto, en Compras.
        </p>
      )}
      {id === "sin-total" && <p className="text-xs text-muted-foreground">Sin total = no se leyó el importe. No quiere decir sin factura ni sin pagar.</p>}
    </div>
  );
}

function GastoCategoria({
  datos,
  periodo,
  onIrA,
}: {
  datos: Extract<DatosAlInstante, { id: "gasto-categoria" }>;
  periodo: { desde: string | null; hasta: string | null };
  onIrA?: (enlace: string) => void;
}) {
  const d = datos.datos;
  const ex = useMemo(() => exploracionCategorias(d, periodo.desde, periodo.hasta), [d, periodo.desde, periodo.hasta]);
  if (d.sin_datos || !d.total || ex.sinDatos) return <Vacio texto="No hay líneas de producto con importe en este periodo." />;
  const primera = ex.puntos[0];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        Total: <span className="font-semibold tabular-nums">{formatImporte(d.total.importe)}</span> <span className="text-xs text-muted-foreground">· base sin IVA</span>
      </p>
      <GraficaConTabla
        ex={ex}
        tipo="horizontales"
        cuenta={{ uno: "línea", varios: "líneas" }}
        descripcion={`Gasto por categoría, base sin IVA. La primera, ${primera?.etiqueta}: ${formatImporte(primera?.valor ?? null)}.`}
      />
      {d.sin_categoria && d.sin_categoria.importe > 0 && (
        <p className="text-xs text-muted-foreground">
          Productos sin categoría: <span className="tabular-nums">{formatImporte(d.sin_categoria.importe)}</span>
        </p>
      )}
      <Avisos
        avisos={[
          d.sin_clasificar && d.sin_clasificar.lineas > 0 && {
            texto: `${plural(d.sin_clasificar.lineas, "línea", "líneas")} aún sin clasificar (${formatImporte(d.sin_clasificar.importe)}): no están en ninguna categoría.`,
          },
          (d.avisos?.sin_importe ?? 0) > 0 && { texto: `${plural(d.avisos?.sin_importe ?? 0, "línea", "líneas")} sin importe: no suman.` },
        ]}
      />
      {d.sin_clasificar && d.sin_clasificar.lineas > 0 && onIrA && (
        <button type="button" className={cn(ACCION, "-ml-2.5 self-start text-primary", FOCO)} onClick={() => onIrA(ENLACE_PRODUCTOS_COMPRAS)}>
          Clasificarlas en Compras › Productos
        </button>
      )}
    </div>
  );
}

function SubidasPrecio({ datos, onVerPrecio }: { datos: Extract<DatosAlInstante, { id: "subidas-precio" }>; onVerPrecio: (p: ProductoAlInstante) => void }) {
  const d = datos.datos;
  const productos = d.productos ?? [];
  const umbral = `${formatNumero(d.umbral_pct ?? datos.umbral)} %`;
  const avisos = [
    (d.avisos?.sin_referencia ?? 0) > 0 && { texto: `${plural(d.avisos?.sin_referencia ?? 0, "producto", "productos")} sin compras anteriores: no se pueden comparar.` },
    (d.avisos?.sin_clasificar ?? 0) > 0 && { texto: `${plural(d.avisos?.sin_clasificar ?? 0, "línea", "líneas")} aún sin clasificar: no entran en la comparación.` },
  ];
  if (productos.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Vacio
          texto={
            (d.comparados ?? 0) > 0
              ? `Nada ha subido más del ${umbral} (${plural(d.comparados ?? 0, "producto comparado", "productos comparados")}).`
              : "Todavía no hay compras repetidas con las que comparar precios."
          }
        />
        <Avisos avisos={avisos} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">Subidas de más del {umbral}: la última compra frente a la referencia (compras anteriores). Precios sin IVA.</p>
      <ul className="max-h-[26rem] divide-y divide-border/40 overflow-y-auto overscroll-contain rounded-lg border border-border/60 bg-background px-3">
        {productos.map((p) => (
          <li key={`${p.producto}-${p.unidad ?? ""}`} className="flex items-start gap-2 py-1.5 text-sm">
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate font-medium" title={p.producto}>
                  {p.producto}
                </span>
                <span className={cn("shrink-0 font-semibold tabular-nums", p.cambio_proveedor ? "text-muted-foreground" : "text-red-700 dark:text-red-400")}>
                  {formatPorcentaje(p.variacion_pct)}
                </span>
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {formatPrecioUnidad(p.ref_precio, p.unidad)} → {formatPrecioUnidad(p.precio, p.unidad)}
                {p.proveedor && <> · {p.proveedor}</>}
                {p.fecha && <> · {formatFechaEs(p.fecha)}</>}
              </p>
              {(p.cambio_proveedor || p.pocas_compras || p.ref_antigua) && (
                <p className={AVISO}>
                  {[
                    p.cambio_proveedor ? `cambio de proveedor${p.ref_proveedor ? ` (antes ${p.ref_proveedor})` : ""}, no es una subida real` : null,
                    p.pocas_compras ? "referencia de una sola compra" : null,
                    p.ref_antigua ? "referencia antigua (más de 90 días)" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
            <button
              type="button"
              className={cn(ACCION, "text-primary", FOCO)}
              onClick={() => onVerPrecio({ producto: p.producto, unidad: p.unidad ?? null })}
              aria-label={`Ver la evolución del precio de ${p.producto}`}
            >
              <LineChart className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Evolución</span>
            </button>
          </li>
        ))}
      </ul>
      {d.truncado && d.total_productos !== undefined && (
        <p className="text-xs text-muted-foreground">
          Se enseñan {formatEntero(productos.length)} de {formatEntero(d.total_productos)}.
        </p>
      )}
      <Avisos avisos={avisos} />
    </div>
  );
}

/** «Evolución de precio» sin producto: buscador de lo comprado. */
function ElegirProducto({ onElegir }: { onElegir: (p: ProductoAlInstante) => void }) {
  const [texto, setTexto] = useState("");
  const q = useBuscarProductosComprados(texto);
  const t = texto.trim();
  return (
    <div className="flex flex-col gap-2 py-2">
      <label className="text-sm font-medium" htmlFor="al-instante-producto">
        ¿De qué producto?
      </label>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="al-instante-producto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Busca un producto: gamba, aceite…"
          className="h-11 pl-9 text-base"
          autoComplete="off"
        />
      </div>
      <ul className="flex max-w-md flex-col" aria-label="Productos comprados">
        {t.length < 2 ? (
          <li className="text-xs text-muted-foreground">Escribe al menos 2 letras.</li>
        ) : q.isLoading ? (
          <li className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Buscando…
          </li>
        ) : (q.data ?? []).length === 0 ? (
          <li className="text-sm text-muted-foreground">Ningún producto comprado se llama así.</li>
        ) : (
          (q.data ?? []).map((p) => (
            <li key={p}>
              <button type="button" className={cn("flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted/60", FOCO)} onClick={() => onElegir({ producto: p, unidad: null })}>
                <span className="truncate">{p}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function Vacio({ texto }: { texto: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border">
      <EstadoVacio icono={<Zap />} titulo={texto} />
    </div>
  );
}

// ─── El resultado en el hueco de la gráfica ─────────────────────────────────

export function ResultadoAlInstante({
  id,
  periodo,
  textoPeriodo,
  local,
  hoy,
  producto,
  onProducto,
  onElegir,
  onVolver,
  onIrA,
}: {
  id: IdAlInstante;
  periodo: { desde: string | null; hasta: string | null };
  textoPeriodo: string;
  local: LocalRpc;
  hoy: Date;
  /** «Evolución de precio»: el producto elegido (o null: se pregunta). */
  producto: ProductoAlInstante | null;
  onProducto: (p: ProductoAlInstante | null) => void;
  /** Cambiar a otro chip desde un resultado («Qué ha subido» → «Evolución de precio»). */
  onElegir: (id: IdAlInstante) => void;
  onVolver: () => void;
  onIrA?: (enlace: string) => void;
}) {
  const chip = chipAlInstante(id);
  const Icono = ICONOS[id];
  const idTitulo = useId();
  const q = useAlInstante(id, periodo, hoy, producto);
  const datos = q.data && q.data.id === id ? q.data : undefined;
  const pideProducto = chip.pide === "producto" && !producto;
  const subtitulo = chip.usaPeriodo ? textoPeriodo : "Mes en curso";

  let cuerpo: ReactNode;
  if (pideProducto) cuerpo = <ElegirProducto onElegir={onProducto} />;
  else if (q.isError && !datos)
    cuerpo =
      q.error instanceof RpcNoDisponibleError ? (
        <p className="py-6 text-sm text-muted-foreground" role="status">
          {TEXTO_RPC_NO_DISPONIBLE}
        </p>
      ) : (
        <EstadoError titulo="No se ha podido consultar" detalle={(q.error as Error)?.message} onReintentar={() => void q.refetch()} />
      );
  else if (!datos) cuerpo = <div className="h-[300px] animate-pulse rounded-lg bg-muted/50" role="status" aria-label="Consultando…" />;
  else
    cuerpo = (
      <div className={cn("transition-opacity", q.isPlaceholderData && "opacity-60")}>
        {datos.id === "gasto-mes" && <GastoMes datos={datos} />}
        {datos.id === "gasto-por-mes" && <GastoPorMes datos={datos} hoy={hoy} />}
        {datos.id === "top-proveedores" && <TopProveedores datos={datos} periodo={periodo} />}
        {datos.id === "productos-mas-comprados" && <ProductosMasComprados datos={datos} />}
        {(datos.id === "por-revisar" || datos.id === "con-avisos" || datos.id === "sin-total") && <Documentos datos={datos} onIrA={onIrA} />}
        {datos.id === "gasto-categoria" && <GastoCategoria datos={datos} periodo={periodo} onIrA={onIrA} />}
        {datos.id === "subidas-precio" && (
          <SubidasPrecio
            datos={datos}
            onVerPrecio={(p) => {
              onProducto(p);
              onElegir("evolucion-precio");
            }}
          />
        )}
        {datos.id === "evolucion-precio" && <GraficoSeriePrecio datos={datos.serie} compacto alto={300} />}
      </div>
    );

  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-primary/25 bg-primary/[0.03] p-3" aria-labelledby={idTitulo} data-testid="resultado-al-instante">
      <header className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <div className="min-w-[12rem] flex-1">
          <h4 id={idTitulo} className="flex items-start gap-1.5 text-base font-semibold leading-tight text-foreground">
            <Icono className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 break-words">
              {chip.etiqueta}
              {chip.pide === "producto" && producto && <span className="font-normal text-muted-foreground"> · {producto.producto}</span>}
            </span>
            {q.isFetching && !pideProducto && datos && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Actualizando" />}
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {chip.descripcion}. <span className="whitespace-nowrap">{subtitulo}</span>
          </p>
        </div>
        <div className="-ml-2.5 flex max-w-full flex-wrap items-center gap-0.5 sm:ml-0">
          {chip.pide === "producto" && producto && (
            <button type="button" className={cn(ACCION, FOCO)} onClick={() => onProducto(null)}>
              <Search className="h-4 w-4" aria-hidden /> Cambiar producto
            </button>
          )}
          <button type="button" className={cn(ACCION, "text-primary", FOCO)} onClick={onVolver} data-testid="volver-al-explorador">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Volver al explorador
          </button>
        </div>
      </header>
      {local && (
        <p className="text-xs text-muted-foreground" data-testid="al-instante-sin-local">
          Cifras de los dos locales: esta consulta no separa Casa Tomás y Touza.
        </p>
      )}
      {cuerpo}
      <p className="sr-only" aria-live="polite">
        {datos ? `Mostrando ${chip.etiqueta} en lugar de la gráfica del explorador.` : ""}
      </p>
    </section>
  );
}
