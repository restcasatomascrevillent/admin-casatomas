// Facturas › Análisis › vista «Proveedores» (09/11/2026: el dueño decía que
// «da muy poca información»). Maestro-detalle, como «Precios»:
//   · arriba, una franja: cuántos proveedores, cuánto pesan los 5 primeros y
//     el reparto Casa Tomás / Touza (antes una tarjeta que dejaba media pantalla vacía);
//   · a la izquierda, la lista con filtros (Todos, Gastas más, Nuevos, Ya no
//     compras, Con avisos): gasto con IVA, % del periodo, documentos, ticket
//     medio, cambio frente al periodo anterior y avisos;
//   · a la derecha, el elegido: cifras, gasto por mes (y la última compra), qué
//     le compras, sus avisos (con enlace a Precios / Ahorro / Por revisar) y
//     «Ver documentos» / «Abrir en Compras».
// Datos: `explorar_compras` (por proveedor, el periodo y el anterior) y las alertas
// de `facturas_decision`. Sin `explorar_compras`, la lista del tablero sin comparar.
import { useId, useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, FileText, Maximize2, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatEntero, plural } from "@/components/facturas/shared/formatters";
import { resumenCortoAlerta, tituloCortoAlerta } from "@/lib/facturas/alertas";
import type { DecisionFacturas } from "@/lib/facturas/decision";
import { FILTROS_VACIOS, parametrosExplorar, type Agrupar, type LocalRpc, type Medida } from "@/lib/facturas/explorador";
import { fechaCorta, nombreCorto, textoPct, type TableroCompras as Datos, type Tramo } from "@/lib/facturas/tableroCompras";
import { mesCorto } from "@/lib/facturas/resumenCompras";
import { nombreMes } from "@/lib/facturas/vistasAnalisis";
import {
  FILTROS_PROVEEDORES,
  avisosPorProveedor,
  concentracion,
  filasProveedores,
  filtrarProveedores,
  idsPorCompletar,
  numAvisos,
  textoDiferencia,
  ultimoMesConCompras,
  type FilaProveedor,
  type FiltroProveedores,
} from "@/lib/facturas/vistaProveedores";
import { useExplorarCompras } from "@/hooks/useExplorarCompras";
import { BOTON, Chip } from "./Decision";
import { Caja } from "./Vistas";
import { COLOR_CASA_TOMAS, COLOR_TOUZA, FOCO, SinDatos } from "./piezas";

type Periodo = { desde: string | null; hasta: string | null };

/** Parámetros de `explorar_compras` con, si hace falta, unos proveedores. */
function params(medida: Medida, agrupar: Agrupar, top: number, tramo: Periodo, local: LocalRpc, proveedores: number[] = []) {
  return parametrosExplorar(
    { medida, agrupar, desglose: null, grafica: "auto", top, filtros: { ...FILTROS_VACIOS, proveedores: proveedores.map((id) => ({ id, nombre: "" })) } },
    tramo,
    local,
  );
}

/** Los datos de una consulta solo si está activa y son de sus parámetros (no los de antes). */
const datosDe = <T,>(q: { data?: T; isPlaceholderData: boolean }, activo: boolean): T | null => (activo && !q.isPlaceholderData ? (q.data ?? null) : null);

const euros = (n: number) => `${formatEntero(n)} €`;

export function VistaProveedores({
  datos,
  periodo,
  local,
  decision,
  pendiente,
  conLocales,
  extra,
  onVerDocumentos,
  onVerLocal,
  onAbrirEnCompras,
  onVerPrecio,
  onIrAVista,
  onAmpliar,
}: {
  datos: Datos;
  periodo: Periodo;
  local: LocalRpc;
  decision: DecisionFacturas | null;
  pendiente?: boolean;
  /** Reparto entre locales en la franja (módulo «Casa Tomás y Touza»). */
  conLocales: boolean;
  /** Otros módulos de la vista (Regalado por proveedor), bajo el detalle. */
  extra?: ReactNode;
  onVerDocumentos: (f: FilaProveedor, tramo: Periodo) => void;
  onVerLocal: (l: "casa_tomas" | "touza", gasto: number) => void;
  onAbrirEnCompras: (id: number) => void;
  onVerPrecio: (idAlerta: string) => void;
  onIrAVista: (v: "ahorro" | "revisar") => void;
  onAmpliar: () => void;
}) {
  const anterior: Tramo | null = datos.periodo.anterior;
  const i = datos.indicadores;
  // El anterior solo cuenta si está cargado de verdad (la misma regla que la variación del tablero).
  const comparable = !!anterior && i.documentosAnterior !== null && i.documentos > 0 && i.documentosAnterior >= 0.5 * i.documentos;

  const qActual = useExplorarCompras(useMemo(() => params("gasto", "proveedor", 50, periodo, local), [periodo, local]), { retraso: 0 });
  const qAnterior = useExplorarCompras(
    useMemo(() => params("gasto", "proveedor", 50, anterior ?? { desde: null, hasta: null }, local), [anterior, local]),
    { retraso: 0, activo: comparable },
  );
  const actual = datosDe(qActual, true);
  const ant = datosDe(qAnterior, comparable);
  const idsActual = useMemo(() => idsPorCompletar(actual, ant), [actual, ant]);
  const idsAnterior = useMemo(() => idsPorCompletar(ant, actual), [ant, actual]);
  const qCompAct = useExplorarCompras(useMemo(() => params("gasto", "proveedor", 50, periodo, local, idsActual), [periodo, local, idsActual]), {
    retraso: 0,
    activo: idsActual.length > 0,
  });
  const qCompAnt = useExplorarCompras(
    useMemo(() => params("gasto", "proveedor", 50, anterior ?? { desde: null, hasta: null }, local, idsAnterior), [anterior, local, idsAnterior]),
    { retraso: 0, activo: comparable && idsAnterior.length > 0 },
  );

  const avisos = useMemo(() => avisosPorProveedor(decision), [decision]);
  const filas = useMemo(
    () =>
      filasProveedores({
        actual,
        anterior: ant,
        completarActual: datosDe(qCompAct, idsActual.length > 0),
        completarAnterior: datosDe(qCompAnt, comparable && idsAnterior.length > 0),
        respaldo: datos.proveedores,
        total: i.gasto,
        comparable: comparable && !!ant,
        avisos,
      }),
    [actual, ant, qCompAct, qCompAnt, idsActual, idsAnterior, datos.proveedores, i.gasto, comparable, avisos],
  );
  const cargando = qActual.isPending && !qActual.isError;
  const conComparacion = comparable && !!ant && !!actual;

  const [filtro, setFiltro] = useState<FiltroProveedores>("todos");
  const filtros = FILTROS_PROVEEDORES.filter((f) => !f.conAnterior || conComparacion).map((f) => ({ ...f, filas: filtrarProveedores(filas, f.id) }));
  const actualFiltro = filtros.find((f) => f.id === filtro) ?? filtros[0];
  const [elegido, setElegido] = useState<string | null>(null);
  const lista = actualFiltro.filas;
  const sel = lista.find((f) => f.clave === elegido) ?? lista[0] ?? null;
  const max = Math.max(1, ...lista.map((f) => Math.max(f.gasto, f.anterior ?? 0)));
  const conc = concentracion(filas, i.gasto);
  const idLista = useId();

  const ct = datos.locales.casaTomas.gasto;
  const tz = datos.locales.touza.gasto;
  const totalLocales = ct + tz;

  return (
    <div className="flex flex-col gap-3 @[48rem]/tablero:h-full" data-testid="vista-proveedores">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" data-testid="franja-proveedores">
        <span>
          <b className="font-semibold tabular-nums text-foreground">{formatEntero(i.proveedores)}</b> {i.proveedores === 1 ? "proveedor" : "proveedores"} con compras
        </span>
        {conc && (
          <span data-testid="concentracion">
            Los {conc.n} primeros: <b className="font-semibold tabular-nums text-foreground">{textoPct(conc.pct, false)}</b> del gasto
          </span>
        )}
        {conComparacion && anterior && (
          <span>
            Comparado con {fechaCorta(anterior.desde)} – {fechaCorta(anterior.hasta)}
          </span>
        )}
        {conLocales && totalLocales > 0 && (
          <span className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="franja-locales" aria-label="Gasto por local, con IVA">
            <span className="flex h-2 w-16 overflow-hidden rounded-full bg-muted/60" aria-hidden>
              <span className={COLOR_CASA_TOMAS} style={{ width: `${(Math.max(0, ct) / totalLocales) * 100}%` }} />
              <span className={COLOR_TOUZA} style={{ width: `${(Math.max(0, tz) / totalLocales) * 100}%` }} />
            </span>
            {(
              [
                { l: "casa_tomas" as const, nombre: "Casa Tomás", gasto: ct, color: COLOR_CASA_TOMAS },
                { l: "touza" as const, nombre: "Touza", gasto: tz, color: COLOR_TOUZA },
              ]
            ).map((b) => (
              <button
                key={b.l}
                type="button"
                disabled={pendiente}
                onClick={() => onVerLocal(b.l, b.gasto)}
                className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 text-xs text-foreground hover:border-primary/50 disabled:opacity-50 pointer-coarse:min-h-11", FOCO)}
              >
                <span className={cn("h-2 w-2 rounded-sm", b.color)} aria-hidden />
                {b.nombre} <b className="font-semibold tabular-nums">{euros(b.gasto)}</b>
                <span className="tabular-nums text-muted-foreground">{textoPct((Math.max(0, b.gasto) / totalLocales) * 100, false)}</span>
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @[48rem]/tablero:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] @[48rem]/tablero:[grid-template-rows:minmax(0,1fr)]">
        <Caja
          titulo="Tus proveedores"
          subtitulo={conComparacion ? "Con IVA · % del gasto del periodo y cambio frente al anterior. Toca uno para ver su ficha." : "Con IVA · % del gasto del periodo. Toca uno para ver su ficha."}
          accion={
            <button type="button" onClick={onAmpliar} disabled={pendiente} aria-label="Ampliar: Tus proveedores" aria-haspopup="dialog" title="Ver en grande, con filtros" className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11", FOCO)}>
              <Maximize2 className="h-4 w-4" aria-hidden />
            </button>
          }
          className="max-h-[32rem] @[48rem]/tablero:max-h-none"
          testId="caja-proveedores-lista"
          sinScroll
        >
          <div role="group" aria-label="Qué proveedores ver" className="mb-1.5 flex shrink-0 flex-wrap gap-1">
            {filtros.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={actualFiltro.id === f.id}
                onClick={() => {
                  setFiltro(f.id);
                  setElegido(null);
                }}
                className={cn(
                  "min-h-9 rounded-full border border-transparent px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground pointer-coarse:min-h-11",
                  "aria-pressed:border-border aria-pressed:bg-muted aria-pressed:font-semibold aria-pressed:text-foreground",
                  FOCO,
                )}
              >
                {f.etiqueta} ({formatEntero(f.filas.length)})
              </button>
            ))}
          </div>
          <div className="-mr-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2" data-testid="caja-scroll">
            {cargando && filas.length === 0 ? (
              <div className="h-40 animate-pulse rounded-lg bg-muted/50" role="status" aria-label="Cargando proveedores" />
            ) : lista.length === 0 ? (
              <SinDatos>
                {actualFiltro.id === "mas"
                  ? `Ningún proveedor sube más de un ${UMBRAL_TEXTO} frente al periodo anterior.`
                  : actualFiltro.id === "nuevos"
                    ? "Ningún proveedor nuevo en este periodo."
                    : actualFiltro.id === "dejados"
                      ? "Sigues comprando a todos los del periodo anterior."
                      : actualFiltro.id === "avisos"
                        ? "Ningún proveedor con avisos de precio o albaranes."
                        : "Ningún proveedor con gasto en este periodo."}
              </SinDatos>
            ) : (
              <ul id={idLista} role="listbox" aria-label={`Proveedores: ${actualFiltro.etiqueta}`} className="space-y-0.5">
                {lista.map((f) => (
                  <li key={f.clave} role="presentation">
                    <OpcionProveedor f={f} max={max} elegido={sel?.clave === f.clave} deshabilitado={pendiente} onElegir={() => setElegido(f.clave)} />
                  </li>
                ))}
              </ul>
            )}
            {actual?.resto && actualFiltro.id === "todos" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Y {plural(actual.resto.entidades, "proveedor más", "proveedores más")} con {euros(actual.resto.valor ?? 0)} entre todos.
              </p>
            )}
          </div>
        </Caja>
        <div className={cn("grid min-h-0 grid-cols-1 gap-3", extra && "@[48rem]/tablero:[grid-template-rows:minmax(0,1.6fr)_minmax(0,1fr)]")}>
          <FichaProveedor
            key={sel?.clave ?? "nada"}
            f={sel}
            periodo={periodo}
            anterior={anterior}
            local={local}
            pendiente={pendiente}
            onVerDocumentos={onVerDocumentos}
            onAbrirEnCompras={onAbrirEnCompras}
            onVerPrecio={onVerPrecio}
            onIrAVista={onIrAVista}
          />
          {extra}
        </div>
      </div>
    </div>
  );
}

const UMBRAL_TEXTO = "10 %";

function Variacion({ f }: { f: FilaProveedor }) {
  if (f.estado === "nuevo") return <Chip tono="plano">nuevo</Chip>;
  if (f.estado === "dejado") return <Chip tono="aviso">ya no compras</Chip>;
  if (f.variacionPct === null) return null;
  const sube = f.variacionPct > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-medium tabular-nums", sube ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
      {sube ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}
      {textoPct(f.variacionPct)}
    </span>
  );
}

function OpcionProveedor({ f, max, elegido, deshabilitado, onElegir }: { f: FilaProveedor; max: number; elegido: boolean; deshabilitado?: boolean; onElegir: () => void }) {
  const a = f.avisos;
  const n = numAvisos(a);
  const dejado = f.estado === "dejado";
  return (
    <button
      type="button"
      role="option"
      aria-selected={elegido}
      disabled={deshabilitado}
      onClick={onElegir}
      title={f.nombre}
      data-testid="fila-proveedor"
      className={cn("grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/50 disabled:cursor-default", elegido && "bg-muted", FOCO)}
    >
      <span className="truncate text-sm font-medium leading-snug">{nombreCorto(f.nombre)}</span>
      <span className="text-sm font-semibold tabular-nums">{dejado ? "0 €" : euros(f.gasto)}</span>
      <span className="col-span-2 block h-1.5 rounded-full bg-muted/70" aria-hidden>
        <span className={cn("block h-full rounded-full", dejado ? "bg-muted-foreground/30" : "bg-primary/70")} style={{ width: `${((dejado ? (f.anterior ?? 0) : f.gasto) / max) * 100}%` }} />
      </span>
      <span className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-snug text-muted-foreground">
        {dejado ? (
          <span>antes {euros(f.anterior ?? 0)}</span>
        ) : (
          <>
            {f.pct !== null && <span className="tabular-nums">{textoPct(f.pct, false)}</span>}
            <span>{plural(f.documentos, "doc.", "docs.")}</span>
          </>
        )}
        <Variacion f={f} />
        {a.subidas.length > 0 && (
          <Chip tono="sube" title="Precios que le han subido">
            {a.subidas.length === 1 ? "1 precio sube" : `${formatEntero(a.subidas.length)} precios suben`}
          </Chip>
        )}
        {a.masBarato.length > 0 && <Chip tono="baja">más barato en otro</Chip>}
        {n - a.subidas.length - a.masBarato.length > 0 && <Chip tono="aviso">{plural(n - a.subidas.length - a.masBarato.length, "aviso", "avisos")}</Chip>}
      </span>
    </button>
  );
}

function Dato({ etiqueta, valor, nota }: { etiqueta: string; valor: ReactNode; nota?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/50 px-2.5 py-1.5">
      <dt className="truncate text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="truncate text-base font-semibold tabular-nums tracking-tight">{valor}</dd>
      {nota && <dd className="truncate text-xs text-muted-foreground">{nota}</dd>}
    </div>
  );
}

function FichaProveedor({
  f,
  periodo,
  anterior,
  local,
  pendiente,
  onVerDocumentos,
  onAbrirEnCompras,
  onVerPrecio,
  onIrAVista,
}: {
  f: FilaProveedor | null;
  periodo: Periodo;
  anterior: Tramo | null;
  local: LocalRpc;
  pendiente?: boolean;
  onVerDocumentos: (f: FilaProveedor, tramo: Periodo) => void;
  onAbrirEnCompras: (id: number) => void;
  onVerPrecio: (idAlerta: string) => void;
  onIrAVista: (v: "ahorro" | "revisar") => void;
}) {
  const id = f?.id ?? null;
  const dejado = f?.estado === "dejado";
  // Al que ya no se compra se le mira en el periodo anterior (qué se le compraba y cuándo se dejó).
  const ad = dejado && anterior ? anterior.desde : null;
  const ah = dejado && anterior ? anterior.hasta : null;
  const tramoCompras: Periodo = useMemo(() => (ad && ah ? { desde: ad, hasta: ah } : periodo), [ad, ah, periodo]);
  const tramoMeses: Periodo = useMemo(() => (ad ? { desde: ad, hasta: periodo.hasta } : periodo), [ad, periodo]);
  const qMeses = useExplorarCompras(useMemo(() => params("gasto", "mes", 10, tramoMeses, local, id !== null ? [id] : []), [tramoMeses, local, id]), {
    retraso: 0,
    activo: id !== null,
  });
  const qProductos = useExplorarCompras(useMemo(() => params("base", "producto", 5, tramoCompras, local, id !== null ? [id] : []), [tramoCompras, local, id]), {
    retraso: 0,
    activo: id !== null,
  });
  if (!f) {
    return (
      <Caja titulo="Proveedor" testId="caja-proveedor-ficha">
        <SinDatos>Elige un proveedor de la lista para ver su ficha.</SinDatos>
      </Caja>
    );
  }
  const meses = datosDe(qMeses, id !== null)?.puntos.slice(-12) ?? [];
  const maxMes = Math.max(1, ...meses.map((m) => m.valor ?? 0));
  const ultimo = ultimoMesConCompras(meses);
  const productos = datosDe(qProductos, id !== null);
  const totalProd = productos?.total.valor ?? 0;
  const a = f.avisos;
  const dif = f.anterior !== null ? f.gasto - f.anterior : null;
  return (
    <Caja
      titulo={nombreCorto(f.nombre)}
      subtitulo={`${f.nombre !== nombreCorto(f.nombre) ? `${f.nombre} · ` : ""}${dejado ? "sin compras en este periodo" : "con IVA, en el periodo"}`}
      testId="caja-proveedor-ficha"
    >
      <dl className="grid grid-cols-2 gap-2 @[28rem]:grid-cols-4" data-testid="cifras-proveedor">
        <Dato etiqueta="Gasto" valor={formatCurrency(f.gasto)} nota={f.pct !== null ? `${textoPct(f.pct, false)} del periodo` : undefined} />
        <Dato
          etiqueta="Frente al anterior"
          valor={dif === null ? "—" : f.estado === "nuevo" ? "Nuevo" : textoDiferencia(dif)}
          nota={f.anterior === null ? "sin periodo con que comparar" : f.estado === "nuevo" ? "no le comprabas" : `antes ${euros(f.anterior)}${f.variacionPct !== null ? ` · ${textoPct(f.variacionPct)}` : ""}`}
        />
        <Dato etiqueta="Documentos" valor={formatEntero(f.documentos)} nota={ultimo ? `última compra: ${nombreMes(ultimo).toLowerCase()} ${ultimo.slice(0, 4)}` : undefined} />
        <Dato etiqueta="Ticket medio" valor={f.ticket !== null ? euros(f.ticket) : "—"} nota="por documento" />
      </dl>

      {id !== null && (
        <section className="mt-3" aria-label="Gasto por mes">
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground">Gasto por mes{meses.length === 12 ? " (últimos 12)" : ""}</h4>
          {qMeses.isLoading ? (
            <div className="h-16 animate-pulse rounded-md bg-muted/50" role="status" aria-label="Cargando el gasto por mes" />
          ) : meses.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin datos por mes.</p>
          ) : (
            <>
              <div className="flex h-16 items-end gap-1" role="img" aria-label={`Gasto por mes: ${meses.map((m) => `${mesCorto(m.clave)} ${euros(m.valor ?? 0)}`).join(", ")}`}>
                {meses.map((m) => (
                  <span key={m.clave} className="flex h-full min-w-0 flex-1 items-end" title={`${mesCorto(m.clave, true)}: ${euros(m.valor ?? 0)}`}>
                    <span className={cn("block w-full rounded-t-sm", (m.valor ?? 0) > 0 ? "bg-primary/70" : "bg-muted")} style={{ height: `${Math.max(3, ((m.valor ?? 0) / maxMes) * 100)}%` }} />
                  </span>
                ))}
              </div>
              <div className="mt-0.5 flex gap-1 text-[0.625rem] tabular-nums text-muted-foreground" aria-hidden>
                {meses.map((m) => (
                  <span key={m.clave} className="min-w-0 flex-1 truncate text-center">
                    {mesCorto(m.clave)}
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {id !== null && (
        <section className="mt-3" aria-label="Qué le compras">
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground">Qué le compras{dejado ? " (periodo anterior)" : ""} · sin IVA</h4>
          {qProductos.isLoading ? (
            <div className="h-12 animate-pulse rounded-md bg-muted/50" role="status" aria-label="Cargando productos" />
          ) : !productos || productos.puntos.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin líneas de producto (puede que solo facture servicios).</p>
          ) : (
            <ol className="space-y-0.5 text-xs" data-testid="productos-proveedor">
              {productos.puntos.map((p) => (
                <li key={p.clave} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-2">
                  <span className="truncate" title={p.etiqueta}>
                    {p.etiqueta}
                  </span>
                  <span className="tabular-nums">{euros(p.valor ?? 0)}</span>
                  <span className="w-12 text-right tabular-nums text-muted-foreground">{totalProd > 0 ? textoPct(((p.valor ?? 0) / totalProd) * 100, false) : ""}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {numAvisos(a) > 0 && (
        <section className="mt-3" aria-label="Avisos del proveedor">
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground">Avisos</h4>
          <ul className="space-y-1" data-testid="avisos-proveedor">
            {a.subidas.map((c) => (
              <li key={c.alerta.id}>
                <button type="button" disabled={pendiente} onClick={() => onVerPrecio(c.alerta.id)} className={cn("flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs hover:bg-muted/50 disabled:opacity-50 pointer-coarse:min-h-11", FOCO)}>
                  <span className="min-w-0 flex-1 truncate">
                    <b className="font-medium">{c.alerta.datos.producto ?? tituloCortoAlerta(c.alerta)}</b> · {resumenCortoAlerta(c.alerta)}
                  </span>
                  {c.impactoMes !== null && c.impactoMes > 0 && <Chip tono="sube">+{formatEntero(c.impactoMes)} €/mes</Chip>}
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
            {a.masBarato.length > 0 && (
              <li>
                <button type="button" disabled={pendiente} onClick={() => onIrAVista("ahorro")} className={cn("flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs hover:bg-muted/50 disabled:opacity-50 pointer-coarse:min-h-11", FOCO)}>
                  <span className="min-w-0 flex-1 truncate">
                    <b className="font-medium">{plural(a.masBarato.length, "producto", "productos")} más barato en otro proveedor</b>
                    {a.masBarato[0].alerta.datos.producto ? ` · ${a.masBarato.map((c) => c.alerta.datos.producto).filter(Boolean).slice(0, 3).join(", ")}` : ""}
                  </span>
                  {a.ahorro90 > 0 && <Chip tono="baja">{euros(a.ahorro90)} en 90 días</Chip>}
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            )}
            {a.otros.map((c) => (
              <li key={c.alerta.id}>
                <button type="button" disabled={pendiente} onClick={() => onIrAVista("revisar")} className={cn("flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs hover:bg-muted/50 disabled:opacity-50 pointer-coarse:min-h-11", FOCO)}>
                  <span className="min-w-0 flex-1 truncate">
                    <b className="font-medium">{tituloCortoAlerta(c.alerta)}</b> · {resumenCortoAlerta(c.alerta)}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!pendiente && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {id !== null && (
            <button type="button" className={cn(BOTON, FOCO)} onClick={() => onVerDocumentos(f, tramoCompras)}>
              <FileText className="h-3.5 w-3.5" aria-hidden /> Ver documentos
            </button>
          )}
          {id !== null && (
            <button type="button" className={cn(BOTON, FOCO)} onClick={() => onAbrirEnCompras(id)}>
              <ShoppingCart className="h-3.5 w-3.5" aria-hidden /> Abrir en Compras
            </button>
          )}
        </div>
      )}
    </Caja>
  );
}
