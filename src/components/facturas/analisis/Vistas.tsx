// Piezas nuevas de Facturas › Análisis en una pantalla (maqueta del dueño, 07/11/2026):
//   · QueDecidirHoy        las 5 decisiones que más dinero mueven (vista por defecto);
//   · PreciosMaestroDetalle lista de subidas / bajadas / pactados / lo más comprado a la
//                          izquierda y la gráfica del precio del elegido a la derecha;
//   · AhorroExplicado      «¿Dónde puedo ahorrar?» con las dos barras y la frase;
//   · AvisosPorRevisar     las alertas que no son de precio ni de familia.
// Todas llenan su caja (`Caja`): la cabecera fija y la lista con scroll por dentro.
// Las acciones que cambian datos (Visto, Es normal, pactado) piden «Editar».
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowUp, Check, Euro, FileText, Handshake, LineChart, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatEntero, plural } from "@/components/facturas/shared/formatters";
import { resumenCortoAlerta, tituloCortoAlerta } from "@/lib/facturas/alertas";
import { textoPctCorto, type CambioPrecio, type DecisionFacturas, type FamiliaDecision, type ProductoTop } from "@/lib/facturas/decision";
import { decisionesDeHoy, explicarAhorro, geometriaPrecio, nombreMes, partesFraseAhorro, mesesHasta, type PuntoPrecio } from "@/lib/facturas/vistasAnalisis";
import { FILTROS_VACIOS, parametrosExplorar, type ConfigExplorador, type LocalRpc } from "@/lib/facturas/explorador";
import { mesCorto } from "@/lib/facturas/resumenCompras";
import { useExplorarCompras } from "@/hooks/useExplorarCompras";
import { useAccionDecision } from "@/hooks/useDecisionFacturas";
import { usePuedeEditarFacturas } from "./edicionFacturas";
import { BOTON, Chip, useVisor } from "./Decision";
import { FOCO, SinDatos } from "./piezas";

const precio2 = (n: number | null) => (n === null ? "—" : n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Caja de una vista: título, subtítulo y el contenido con scroll por dentro. */
export function Caja({
  titulo,
  subtitulo,
  accion,
  children,
  className,
  testId,
  sinScroll = false,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  accion?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
  /** El contenido ya reparte su alto (maestro-detalle). */
  sinScroll?: boolean;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      data-testid={testId}
      className={cn("relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card p-3.5", className)}
    >
      <header className="mb-2 flex shrink-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={id} className="text-sm font-semibold leading-snug tracking-tight text-foreground">
            {titulo}
          </h3>
          {subtitulo && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{subtitulo}</p>}
        </div>
        {accion}
      </header>
      {sinScroll ? children : <div className="-mr-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2" data-testid="caja-scroll">{children}</div>}
    </section>
  );
}

const ICONO_TONO = {
  sube: "bg-red-500/10 text-red-700 dark:text-red-400",
  mejor: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  familia: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
} as const;

// ─── Qué decidir hoy ────────────────────────────────────────────────────────

export function QueDecidirHoy({
  decision,
  pendiente,
  onVerPrecio,
  onVerFamilia,
  onIrA,
}: {
  decision: DecisionFacturas;
  pendiente?: boolean;
  /** Lleva a la vista «Precios» con esa subida elegida. */
  onVerPrecio: (idAlerta: string) => void;
  /** Los documentos de esa familia en el tramo comparado. */
  onVerFamilia: (f: FamiliaDecision) => void;
  onIrA?: (enlace: string) => void;
}) {
  const puedeEditar = usePuedeEditarFacturas();
  const accion = useAccionDecision();
  const { abrir, visor } = useVisor(onIrA);
  const lista = useMemo(() => decisionesDeHoy(decision), [decision]);
  const ocupado = pendiente || accion.isPending;
  const mesComparado = decision.periodo.comparado?.modo === "ultimo_mes" ? nombreMes(decision.periodo.comparado.desde) : null;
  return (
    <Caja
      titulo="Qué decidir hoy"
      subtitulo="Lo 5 que más dinero mueve, de todo el análisis. Lo demás está en su vista."
      testId="caja-decidir"
    >
      {lista.length === 0 ? (
        <SinDatos>Nada que decidir: ningún precio sube de más, nada sale más barato en otro proveedor y las familias están en su media.</SinDatos>
      ) : (
        <ol aria-label="Decisiones, de más a menos dinero">
          {lista.map((x) => {
            if (x.tipo === "familia") {
              const f = x.familia;
              return (
                <Fila
                  key={x.id}
                  tipo="familia"
                  titulo={`${f.familia} gasta un ${formatEntero(Math.abs(f.variacionPct ?? 0))} % más de lo normal`}
                  detalle={`${formatCurrency(f.importe)}${mesComparado ? ` en ${mesComparado}` : " en el periodo"} frente a ${formatCurrency(f.referencia ?? 0)} de media`}
                  euros={`+${formatEntero(x.exceso)} €`}
                >
                  {!pendiente && f.id !== null && (
                    <button type="button" className={cn(BOTON, FOCO)} onClick={() => onVerFamilia(f)}>
                      <FileText className="h-3.5 w-3.5" aria-hidden /> Ver qué se compró
                    </button>
                  )}
                  {!pendiente && puedeEditar && f.alerta && (
                    <button type="button" className={cn(BOTON, FOCO)} disabled={ocupado} onClick={() => accion.mutate({ tipo: "es_normal", id: f.alerta!.id })}>
                      <X className="h-3.5 w-3.5" aria-hidden /> Es normal
                    </button>
                  )}
                </Fila>
              );
            }
            const c = x.cambio;
            const d = c.alerta.datos;
            if (x.tipo === "mejor") {
              const a = explicarAhorro(c);
              return (
                <Fila
                  key={x.id}
                  tipo="mejor"
                  titulo={`${a.producto}: ${a.proveedorOtro ?? "otro proveedor"} te lo deja ${a.precio !== null && a.precioOtro !== null ? `${precio2(a.precio - a.precioOtro)} €/${a.medida} ` : ""}más barato`}
                  detalle={`Pagas ${precio2(a.precio)} €/${a.medida}${a.proveedor ? ` en ${a.proveedor}` : ""} · ${a.proveedorOtro ?? "el otro"} lo vende a ${precio2(a.precioOtro)} €/${a.medida}`}
                  euros={`−${formatEntero(a.ahorro)} € / 90 días`}
                >
                  {!pendiente && (c.doc || c.docOtro) && (
                    <button type="button" className={cn(BOTON, FOCO)} onClick={() => abrir([c.doc, c.docOtro])}>
                      <FileText className="h-3.5 w-3.5" aria-hidden /> Comparar facturas
                    </button>
                  )}
                  {!pendiente && puedeEditar && (
                    <button type="button" className={cn(BOTON, FOCO)} disabled={ocupado} onClick={() => accion.mutate({ tipo: "es_normal", id: c.alerta.id })}>
                      <X className="h-3.5 w-3.5" aria-hidden /> No es lo mismo
                    </button>
                  )}
                </Fila>
              );
            }
            return (
              <Fila
                key={x.id}
                tipo="sube"
                titulo={`${d.producto ?? tituloCortoAlerta(c.alerta)} ha subido ${d.variacionPct !== null ? `un ${formatEntero(Math.abs(d.variacionPct))} %` : ""}`.trim()}
                detalle={`${d.proveedor ? `${d.proveedor} · ` : ""}${resumenCortoAlerta(c.alerta)}`}
                euros={`+${formatEntero(x.eurosMes)} €/mes`}
              >
                {!pendiente && c.doc && (
                  <button type="button" className={cn(BOTON, FOCO)} onClick={() => abrir([c.doc])}>
                    <FileText className="h-3.5 w-3.5" aria-hidden /> Ver factura
                  </button>
                )}
                {!pendiente && (
                  <button type="button" className={cn(BOTON, FOCO)} onClick={() => onVerPrecio(c.alerta.id)}>
                    <LineChart className="h-3.5 w-3.5" aria-hidden /> Ver precio
                  </button>
                )}
                {!pendiente && puedeEditar && (
                  <button type="button" className={cn(BOTON, FOCO)} disabled={ocupado} title="No vuelve a avisar de esto en 90 días" onClick={() => accion.mutate({ tipo: "es_normal", id: c.alerta.id })}>
                    <X className="h-3.5 w-3.5" aria-hidden /> Es normal
                  </button>
                )}
              </Fila>
            );
          })}
        </ol>
      )}
      {visor}
    </Caja>
  );
}

function Fila({ tipo, titulo, detalle, euros, children }: { tipo: "sube" | "mejor" | "familia"; titulo: string; detalle: string; euros: string; children: ReactNode }) {
  const Icono = tipo === "sube" ? ArrowUp : tipo === "mejor" ? Euro : AlertTriangle;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-t border-border/60 py-2.5 first:border-t-0 first:pt-0" data-decision={tipo}>
      <span className={cn("grid h-7 w-7 place-items-center rounded-lg", ICONO_TONO[tipo])} aria-hidden>
        <Icono className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug [overflow-wrap:anywhere]">{titulo}</p>
        <p className="text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">{detalle}</p>
      </div>
      <span className="whitespace-nowrap text-right text-sm font-medium tabular-nums">{euros}</span>
      <div className="col-start-2 col-end-4 flex flex-wrap gap-1.5">{children}</div>
    </li>
  );
}

// ─── Precios: maestro-detalle ───────────────────────────────────────────────

export type ListaPrecios = "sube" | "baja" | "pactado" | "top";

/** Un elemento de la lista de «Precios»: una alerta de cambio o un producto de los más comprados. */
type Elemento = { clave: string; cambio: CambioPrecio; top?: undefined } | { clave: string; top: ProductoTop; cambio?: undefined };

const claveCambio = (c: CambioPrecio) => `a:${c.alerta.id}`;
const claveTop = (p: ProductoTop) => `t:${p.clave}`;

/** En qué lista está una alerta (para «Ver precio» desde «Qué decidir hoy»). */
export function listaDeAlerta(d: DecisionFacturas, id: string): ListaPrecios | null {
  if (d.cambios.sube.some((c) => c.alerta.id === id) || d.cambios.proveedor.some((c) => c.alerta.id === id)) return "sube";
  if (d.cambios.baja.some((c) => c.alerta.id === id)) return "baja";
  if (d.cambios.pactado.some((c) => c.alerta.id === id)) return "pactado";
  return null;
}

export function PreciosMaestroDetalle({
  decision,
  periodo,
  local,
  pendiente,
  conTop = true,
  elegida,
  onElegida,
  onExplorar,
  onVerDocumentosTop,
  onIrA,
}: {
  decision: DecisionFacturas;
  periodo: { desde: string | null; hasta: string | null };
  local: LocalRpc;
  pendiente?: boolean;
  /** «Lo más comprado» (módulo precios_top del configurador). */
  conTop?: boolean;
  /** Elemento elegido (`a:<id alerta>` o `t:<clave>`), lo lleva la vista para «Ver precio». */
  elegida: string | null;
  onElegida: (clave: string | null) => void;
  onExplorar: (c: Partial<ConfigExplorador>) => void;
  onVerDocumentosTop: (p: ProductoTop) => void;
  onIrA?: (enlace: string) => void;
}) {
  const c = decision.cambios;
  const pactadosTop = decision.top.filter((p) => p.pactado);
  const listas: { id: ListaPrecios; etiqueta: string; elementos: Elemento[] }[] = [
    { id: "sube", etiqueta: `Suben (${c.sube.length + c.proveedor.length})`, elementos: [...c.proveedor, ...c.sube].map((x) => ({ clave: claveCambio(x), cambio: x })) },
    { id: "baja", etiqueta: `Bajan (${c.baja.length})`, elementos: c.baja.map((x) => ({ clave: claveCambio(x), cambio: x })) },
    {
      id: "pactado",
      etiqueta: `Pactados (${c.pactado.length + pactadosTop.length})`,
      elementos: [...c.pactado.map((x) => ({ clave: claveCambio(x), cambio: x })), ...pactadosTop.map((p) => ({ clave: claveTop(p), top: p }))],
    },
    ...(conTop ? [{ id: "top" as const, etiqueta: "Lo más comprado", elementos: decision.top.map((p) => ({ clave: claveTop(p), top: p })) }] : []),
  ];
  const deElegida = elegida ? listas.find((l) => l.elementos.some((e) => e.clave === elegida))?.id : undefined;
  const [lista, setLista] = useState<ListaPrecios>(deElegida ?? "sube");
  useEffect(() => {
    if (deElegida) setLista(deElegida);
  }, [deElegida]);
  const actual = listas.find((l) => l.id === lista) ?? listas[0];
  const sel = actual.elementos.find((e) => e.clave === elegida) ?? actual.elementos[0] ?? null;
  const idLista = useId();
  return (
    <>
      <Caja
        titulo="Cambios de precio"
        subtitulo="Ordenados por lo que te cuestan al mes. Toca uno para ver su gráfica. Sin IVA."
        testId="caja-precios-lista"
        sinScroll
      >
        <div role="group" aria-label="Qué precios ver" className="mb-1.5 flex shrink-0 flex-wrap gap-1">
          {listas.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={lista === l.id}
              onClick={() => {
                setLista(l.id);
                onElegida(null);
              }}
              className={cn(
                "min-h-9 rounded-full border border-transparent px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground pointer-coarse:min-h-11",
                "aria-pressed:border-border aria-pressed:bg-muted aria-pressed:font-semibold aria-pressed:text-foreground",
                FOCO,
              )}
            >
              {l.etiqueta}
            </button>
          ))}
        </div>
        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2" data-testid="caja-scroll">
          {actual.elementos.length === 0 ? (
            <SinDatos>
              {lista === "sube"
                ? "Ningún precio ha subido por encima del umbral."
                : lista === "baja"
                  ? "Ninguna bajada de lo que compras a menudo."
                  : lista === "pactado"
                    ? "Sin precios pactados. Márcalos desde un producto."
                    : "No hay compras con precio en los últimos 90 días."}
            </SinDatos>
          ) : (
            <ul id={idLista} role="listbox" aria-label={`Precios: ${actual.etiqueta}`} className="space-y-0.5">
              {actual.elementos.map((e) => (
                <li key={e.clave} role="presentation">
                  <OpcionPrecio e={e} elegido={sel?.clave === e.clave} onElegir={() => onElegida(e.clave)} />
                </li>
              ))}
            </ul>
          )}
          {lista === "top" && decision.revisarUnidades.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="revisar-unidades">
              <span className="font-medium text-amber-800 dark:text-amber-300">Revisar unidades:</span>{" "}
              {decision.revisarUnidades.map((r) => `${r.producto} mezcla ${r.unidades.map((u) => u.unidad).join(" y ")}`).join("; ")}.
            </p>
          )}
        </div>
      </Caja>
      <DetallePrecio key={sel?.clave ?? "nada"} e={sel} decision={decision} periodo={periodo} local={local} pendiente={pendiente} onExplorar={onExplorar} onVerDocumentosTop={onVerDocumentosTop} onIrA={onIrA} />
    </>
  );
}

function OpcionPrecio({ e, elegido, onElegir }: { e: Elemento; elegido: boolean; onElegir: () => void }) {
  let titulo: string;
  let detalle: string;
  let chip: ReactNode = null;
  if (e.cambio) {
    const a = e.cambio.alerta;
    const d = a.datos;
    titulo = a.tipo === "facturas_precio_proveedor" ? tituloCortoAlerta(a) : (d.producto ?? tituloCortoAlerta(a));
    detalle = `${d.proveedor && a.tipo !== "facturas_precio_proveedor" ? `${d.proveedor} · ` : ""}${resumenCortoAlerta(a)}`;
    if (e.cambio.impactoMes !== null && a.tipo !== "facturas_precio_pactado")
      chip = (
        <Chip tono={a.tipo === "facturas_precio_baja" ? "baja" : "sube"}>
          {a.tipo === "facturas_precio_baja" ? "−" : "+"}
          {formatEntero(Math.abs(e.cambio.impactoMes))} €/mes
        </Chip>
      );
    else if (d.variacionPct !== null) chip = <Chip tono="aviso">{textoPctCorto(d.variacionPct)}</Chip>;
  } else {
    const p = e.top;
    const ultimo = [...p.meses].reverse().find((m) => m.precio !== null)?.precio ?? null;
    titulo = p.producto;
    detalle = [p.proveedor, ultimo !== null ? `${precio2(ultimo)} €/${p.unidad}` : null, p.pactado ? `pactado ${precio2(p.pactado.precio)} €` : `${formatEntero(p.importe90)} € en 90 días`]
      .filter(Boolean)
      .join(" · ");
  }
  return (
    <button
      type="button"
      role="option"
      aria-selected={elegido}
      onClick={onElegir}
      className={cn(
        "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/50",
        elegido && "bg-muted",
        FOCO,
      )}
    >
      <span className="min-w-0 text-sm font-medium leading-snug [overflow-wrap:anywhere]">{titulo}</span>
      <span>{chip}</span>
      <span className="col-span-2 text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">{detalle}</span>
    </button>
  );
}

function DetallePrecio({
  e,
  decision,
  periodo,
  local,
  pendiente,
  onExplorar,
  onVerDocumentosTop,
  onIrA,
}: {
  e: Elemento | null;
  decision: DecisionFacturas;
  periodo: { desde: string | null; hasta: string | null };
  local: LocalRpc;
  pendiente?: boolean;
  onExplorar: (c: Partial<ConfigExplorador>) => void;
  onVerDocumentosTop: (p: ProductoTop) => void;
  onIrA?: (enlace: string) => void;
}) {
  const puedeEditar = usePuedeEditarFacturas();
  const accion = useAccionDecision();
  const { abrir, visor } = useVisor(onIrA);
  const d = e?.cambio?.alerta.datos ?? null;
  // Una alerta: su precio en la unidad facturada, 6 meses hasta la compra que avisa, de ESE proveedor.
  const fin = (d?.fecha ?? d?.hasta ?? periodo.hasta ?? decision.periodo.hasta ?? "").slice(0, 10);
  const meses = useMemo(() => (fin ? mesesHasta(fin, 6) : []), [fin]);
  const producto = d?.producto ?? null;
  const params = useMemo(
    () =>
      parametrosExplorar(
        {
          medida: "precio",
          agrupar: "mes",
          desglose: null,
          grafica: "auto",
          top: 5,
          filtros: {
            ...FILTROS_VACIOS,
            productos: producto ? [producto] : [],
            unidad: d?.unidad ? d.unidad.toLowerCase() : null,
            proveedores: d?.proveedorId !== null && d?.proveedorId !== undefined ? [{ id: d.proveedorId, nombre: d.proveedor ?? "" }] : [],
          },
        },
        { desde: meses[0] ? `${meses[0]}-01` : null, hasta: fin || null },
        local,
      ),
    [producto, d?.unidad, d?.proveedorId, d?.proveedor, meses, fin, local],
  );
  const q = useExplorarCompras(params, { retraso: 0, activo: !!producto && !!e?.cambio && e.cambio.alerta.tipo !== "facturas_precio_proveedor" });
  if (!e) {
    return (
      <Caja titulo="Precio" testId="caja-precio-detalle">
        <SinDatos>Elige un precio de la lista para ver su gráfica.</SinDatos>
      </Caja>
    );
  }
  let titulo: string;
  let subtitulo: string;
  let serie: PuntoPrecio[] = [];
  let referencia: number | null = null;
  let textoRef = "";
  let unidad = "ud";
  if (e.top) {
    const p = e.top;
    titulo = p.producto;
    unidad = p.unidad;
    serie = p.meses.map((m) => ({ mes: m.mes, precio: m.precio }));
    referencia = p.pactado?.precio ?? null;
    textoRef = p.pactado ? "precio pactado" : "";
    subtitulo = `${p.proveedor ?? "Varios proveedores"} · precio mediano por mes, sin IVA · ${formatEntero(p.importe90)} € en 90 días`;
  } else {
    const a = e.cambio.alerta;
    titulo = a.tipo === "facturas_precio_proveedor" ? tituloCortoAlerta(a) : (a.datos.producto ?? tituloCortoAlerta(a));
    unidad = a.datos.unidad ?? a.datos.medida ?? "ud";
    const porMes = new Map((q.data?.puntos ?? []).map((p) => [p.clave.slice(0, 7), p.valor]));
    serie = meses.map((m) => ({ mes: m, precio: porMes.get(m) ?? null }));
    referencia = a.datos.precioRefUd ?? a.datos.precioRef;
    textoRef = a.tipo === "facturas_precio_pactado" ? "precio pactado" : "precio de antes (mediana de 90 días)";
    subtitulo = `${a.datos.proveedor ? `${a.datos.proveedor} · ` : ""}${resumenCortoAlerta(a)}`;
  }
  const g = geometriaPrecio(serie, referencia);
  const cargando = !!e.cambio && q.isLoading;
  // Marcar precio pactado: hace falta saber proveedor, línea y precio.
  const pacto = e.top
    ? e.top.proveedorId !== null && e.top.nombreNormalizado
      ? { proveedorId: e.top.proveedorId, nombreNormalizado: e.top.nombreNormalizado, precio: [...e.top.meses].reverse().find((m) => m.precio !== null)?.precio ?? null, unidad: e.top.unidad, producto: e.top.producto, pactado: e.top.pactado }
      : null
    : d && d.proveedorId !== null && d.nombreNormalizado && e.cambio.alerta.tipo !== "facturas_precio_proveedor"
      ? { proveedorId: d.proveedorId, nombreNormalizado: d.nombreNormalizado, precio: d.precioUd ?? d.precio, unidad: d.unidad ?? d.medida ?? "ud", producto: d.producto ?? titulo, pactado: null }
      : null;
  const ocupado = pendiente || accion.isPending;
  return (
    <Caja titulo={titulo} subtitulo={subtitulo} testId="caja-precio-detalle" sinScroll>
      <div className="relative min-h-0 flex-1" data-testid="grafica-precio">
        {cargando ? (
          <div className="h-full animate-pulse rounded-lg bg-muted/50" role="status" aria-label="Cargando la gráfica" />
        ) : !g ? (
          <SinDatos>Sin compras con precio en estos meses.</SinDatos>
        ) : (
          <svg viewBox="0 0 400 180" preserveAspectRatio="none" className="block h-full w-full" role="img" aria-label={`Precio de ${titulo} por mes: ${g.puntos.map((p) => `${mesCorto(p.mes)} ${precio2(p.precio)} €`).join(", ")}${g.referencia !== null ? `. Raya: ${textoRef}, ${precio2(g.referencia)} €` : ""}`}>
            <line x1="12" x2="388" y1="168" y2="168" className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {g.yReferencia !== null && (
              <line x1="12" x2="388" y1={g.yReferencia} y2={g.yReferencia} className="stroke-foreground/50" strokeWidth="1.2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" data-testid="raya-referencia" />
            )}
            <path d={g.linea} fill="none" className="stroke-primary" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {g.puntos.map((p) => (
              <circle key={p.mes} cx={p.x} cy={p.y} r="3" className="fill-primary" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
      </div>
      {g && (
        <div className="mt-1 flex shrink-0 justify-between text-[0.6875rem] tabular-nums text-muted-foreground" aria-hidden>
          {g.meses.map((m) => (
            <span key={m.mes}>{mesCorto(m.mes)}</span>
          ))}
        </div>
      )}
      {g && (
        <p className="mt-1 shrink-0 text-xs text-muted-foreground">
          € por {unidad}, sin IVA
          {g.referencia !== null && (
            <>
              {" "}· <span className="inline-block h-0 w-3 border-t border-dashed border-foreground/60 align-middle" aria-hidden /> {textoRef}: {precio2(g.referencia)} €
            </>
          )}
        </p>
      )}
      {!pendiente && (
        <div className="mt-2 flex shrink-0 flex-wrap gap-1.5">
          {e.cambio?.doc && (
            <button type="button" className={cn(BOTON, FOCO)} onClick={() => abrir([e.cambio!.doc])}>
              <FileText className="h-3.5 w-3.5" aria-hidden /> Ver factura
            </button>
          )}
          {e.top && (
            <button type="button" className={cn(BOTON, FOCO)} onClick={() => onVerDocumentosTop(e.top!)}>
              <FileText className="h-3.5 w-3.5" aria-hidden /> Ver sus facturas
            </button>
          )}
          {(producto || e.top) && (
            <button
              type="button"
              className={cn(BOTON, FOCO)}
              onClick={() =>
                onExplorar({
                  medida: "precio",
                  agrupar: "mes",
                  desglose: "proveedor",
                  filtros: { ...FILTROS_VACIOS, productos: [e.top ? (e.top.linea ?? e.top.producto) : (producto as string)], unidad: unidad ? unidad.toLowerCase() : null },
                })
              }
            >
              <LineChart className="h-3.5 w-3.5" aria-hidden /> En el explorador
            </button>
          )}
          {puedeEditar && pacto && (pacto.pactado ? (
            <button type="button" className={cn(BOTON, FOCO)} disabled={ocupado} onClick={() => accion.mutate({ tipo: "quitar_pacto", proveedorId: pacto.proveedorId, nombreNormalizado: pacto.nombreNormalizado })}>
              <Handshake className="h-3.5 w-3.5" aria-hidden /> Quitar precio pactado
            </button>
          ) : pacto.precio !== null ? (
            <button
              type="button"
              className={cn(BOTON, FOCO)}
              disabled={ocupado}
              title={`Marcar ${precio2(pacto.precio)} €/${pacto.unidad} como el precio pactado con el proveedor`}
              onClick={() => accion.mutate({ tipo: "pactar", proveedorId: pacto.proveedorId, nombreNormalizado: pacto.nombreNormalizado, precio: pacto.precio as number, unidad: pacto.unidad, producto: pacto.producto })}
            >
              <Handshake className="h-3.5 w-3.5" aria-hidden /> Marcar precio pactado
            </button>
          ) : null)}
          {puedeEditar && e.cambio && (
            <>
              <button type="button" className={cn(BOTON, FOCO)} disabled={ocupado} onClick={() => accion.mutate({ tipo: "visto", id: e.cambio!.alerta.id })}>
                <Check className="h-3.5 w-3.5" aria-hidden /> Visto
              </button>
              <button type="button" className={cn(BOTON, FOCO)} disabled={ocupado} title="No vuelve a avisar de esto en 90 días" onClick={() => accion.mutate({ tipo: "es_normal", id: e.cambio!.alerta.id })}>
                <X className="h-3.5 w-3.5" aria-hidden /> Es normal
              </button>
            </>
          )}
        </div>
      )}
      {visor}
    </Caja>
  );
}

// ─── ¿Dónde puedo ahorrar? ──────────────────────────────────────────────────

export function AhorroExplicado({ decision, pendiente, onIrA }: { decision: DecisionFacturas; pendiente?: boolean; onIrA?: (enlace: string) => void }) {
  const puedeEditar = usePuedeEditarFacturas();
  const accion = useAccionDecision();
  const { abrir, visor } = useVisor(onIrA);
  const lista = decision.cambios.mejor;
  const total = lista.reduce((s, c) => s + Math.max(0, c.alerta.datos.ahorro ?? 0), 0);
  const ocupado = pendiente || accion.isPending;
  return (
    <Caja
      titulo="¿Dónde puedo ahorrar? Mismo producto, otro proveedor que ya usas"
      subtitulo="Lo que pagas ahora frente al proveedor más barato, y cuánto te habrías ahorrado con lo que compraste en 90 días. Precios sin IVA; comprueba que es la misma calidad."
      accion={
        <span className="shrink-0 text-right">
          <span className="block text-xs text-muted-foreground">En 90 días</span>
          <span className="text-lg font-medium tabular-nums text-emerald-700 dark:text-emerald-400">{formatCurrency(Math.round(total))}</span>
        </span>
      }
      testId="caja-ahorro"
    >
      {lista.length === 0 ? (
        <SinDatos>Ningún producto sale más barato en otro proveedor que ya uses.</SinDatos>
      ) : (
        <ul aria-label="Productos más baratos en otro proveedor" className="grid gap-x-6 @container lg:grid-cols-2">
          {lista.map((c) => {
            const a = explicarAhorro(c);
            const max = Math.max(a.precio ?? 0, a.precioOtro ?? 0, 0.01);
            return (
              <li key={c.alerta.id} className="space-y-1.5 border-t border-border/60 py-2.5 first:border-t-0 lg:[&:nth-child(2)]:border-t-0" data-testid="fila-ahorro">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{a.producto}</p>
                  {a.pct !== null && <Chip tono="baja">−{formatEntero(a.pct)} %</Chip>}
                </div>
                <BarraPrecio etiqueta="Ahora" proveedor={a.proveedor} precio={a.precio} medida={a.medida} max={max} tono="ahora" />
                <BarraPrecio etiqueta="Más barato" proveedor={a.proveedorOtro} precio={a.precioOtro} medida={a.medida} max={max} tono="barato" />
                <p className="text-xs leading-snug text-muted-foreground" data-testid="frase-ahorro">
                  {partesFraseAhorro(a)[0]}
                  <strong className="font-semibold text-emerald-700 dark:text-emerald-400">{partesFraseAhorro(a)[1]}</strong>
                  {partesFraseAhorro(a)[2]}
                </p>
                {!pendiente && (
                  <div className="flex flex-wrap gap-1.5">
                    {(c.doc || c.docOtro) && (
                      <button type="button" className={cn(BOTON, FOCO)} onClick={() => abrir([c.doc, c.docOtro])}>
                        <FileText className="h-3.5 w-3.5" aria-hidden /> Comparar las dos facturas
                      </button>
                    )}
                    {puedeEditar && (
                      <>
                        <button type="button" className={cn(BOTON, FOCO)} disabled={ocupado} title="No vuelve a avisar de esto en 90 días" onClick={() => accion.mutate({ tipo: "es_normal", id: c.alerta.id })}>
                          <X className="h-3.5 w-3.5" aria-hidden /> No es el mismo producto
                        </button>
                        <button type="button" className={cn(BOTON, FOCO)} disabled={ocupado} onClick={() => accion.mutate({ tipo: "visto", id: c.alerta.id })}>
                          <Check className="h-3.5 w-3.5" aria-hidden /> Visto
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {visor}
    </Caja>
  );
}

function BarraPrecio({ etiqueta, proveedor, precio, medida, max, tono }: { etiqueta: string; proveedor: string | null; precio: number | null; medida: string; max: number; tono: "ahora" | "barato" }) {
  return (
    <div className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] items-center gap-x-2 text-xs">
      <span className="truncate" title={`${etiqueta}: ${proveedor ?? "?"}`}>
        <span className="text-muted-foreground">{etiqueta}:</span> {proveedor ?? "?"}
      </span>
      <span className="relative block h-2.5 rounded-sm bg-muted/70" aria-hidden>
        <span
          className={cn("absolute inset-y-0 left-0 rounded-sm", tono === "ahora" ? "bg-red-600/70 dark:bg-red-400/70" : "bg-emerald-600 dark:bg-emerald-400")}
          style={{ width: `${precio !== null ? (precio / max) * 100 : 0}%` }}
        />
      </span>
      <span className="whitespace-nowrap text-right tabular-nums">
        {precio2(precio)} €/{medida}
      </span>
    </div>
  );
}

// ─── Por revisar: los demás avisos ──────────────────────────────────────────

export function AvisosPorRevisar({ decision, pendiente }: { decision: DecisionFacturas; pendiente?: boolean }) {
  const puedeEditar = usePuedeEditarFacturas();
  const accion = useAccionDecision();
  const otros = decision.cambios.otros;
  const ocupado = pendiente || accion.isPending;
  return (
    <Caja titulo={`Avisos (${otros.length})`} subtitulo="Proveedores nuevos, importes inusuales, posibles duplicados…" testId="caja-avisos">
      {otros.length === 0 ? (
        <SinDatos>Sin avisos pendientes.</SinDatos>
      ) : (
        <ul aria-label="Avisos por revisar">
          {otros.map((o) => (
            <li key={o.alerta.id} className="border-t border-border/60 py-2 first:border-t-0 first:pt-0" data-testid="aviso-por-revisar">
              <p className="text-sm font-medium leading-snug [overflow-wrap:anywhere]">{tituloCortoAlerta(o.alerta)}</p>
              <p className="text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">{resumenCortoAlerta(o.alerta)}</p>
              {puedeEditar && !pendiente && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <button type="button" className={cn(BOTON, FOCO)} disabled={ocupado} onClick={() => accion.mutate({ tipo: "visto", id: o.alerta.id })}>
                    <Check className="h-3.5 w-3.5" aria-hidden /> Visto
                  </button>
                  <button type="button" className={cn(BOTON, FOCO)} disabled={ocupado} title="No vuelve a avisar de esto en 90 días" onClick={() => accion.mutate({ tipo: "es_normal", id: o.alerta.id })}>
                    <X className="h-3.5 w-3.5" aria-hidden /> Es normal
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Caja>
  );
}

