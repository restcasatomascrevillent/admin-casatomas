// Facturas › Análisis › «Subidas y proveedor» (informe fijo, 16/11/2026).
//
//   · Arriba, los dos totales: lo que cuestan al año las subidas y lo que se
//     ahorraría comprando al proveedor más barato. SOLO suman las filas de
//     confianza alta («Fiable») y media («Probable»); las de «Revisar» se ven,
//     al final de cada lista y con su motivo, pero no suman.
//   · Filtros: proveedor y categoría (los dos bloques) y con qué se compara
//     la última compra (hace 3, 6 o 12 meses; solo el bloque de subidas).
//   · Los dos totales eligen qué lista se ve (una a la vez, 17/11/2026: las dos
//     juntas no cabían en la tablet); la lista ocupa el alto que queda y hace
//     scroll por dentro (la página no desplaza).
//   · Con error, los totales y la lista lo dicen en castellano y dejan reintentar.
//   · «Comparar facturas» abre el visor de Análisis con las dos facturas y la
//     línea del producto marcada (el mismo de «Qué decidir hoy»).
// Las cuentas están en SQL (20261207110000_informe_subidas_proveedor).
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { FileText, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInformeBarato, useInformeSubidas, type FiltrosInforme } from "@/hooks/useInformeSubidas";
import {
  ETIQUETA_CONFIANZA,
  MESES_INFORME,
  MESES_POR_DEFECTO,
  PAGINA_INFORME,
  LIMITE_MAXIMO_INFORME,
  cantidad,
  euros0,
  euros2,
  fechaEs,
  mensajeErrorInforme,
  notasBarato,
  notasSubida,
  pct,
  productoDeFila,
  resumenBarato,
  resumenSubidas,
  siguienteLimite,
  unirOpciones,
  type Confianza,
  type Excluidos,
  type FilaBarato,
  type FilaSubida,
  type MesesInforme,
  type OpcionFiltro,
  type PrecioAntes,
} from "@/lib/facturas/informeSubidas";
import { proveedorCorto } from "@/lib/facturas/vistasAnalisis";
import { BOTON, Chip, useVisor } from "./Decision";
import { Caja } from "./Vistas";
import { FOCO, Segmentado, SinDatos } from "./piezas";

interface Props {
  local: "casa_tomas" | "touza" | null;
  onIrA?: (enlace: string) => void;
}

const TONO_CONFIANZA = { alta: "baja", media: "plano", baja: "aviso" } as const;
const SELECT =
  "h-9 min-w-0 max-w-full rounded-md border border-border/70 bg-background px-2 text-[0.8125rem] text-foreground pointer-coarse:h-11 max-sm:w-full sm:max-w-[15rem]";

function ChipConfianza({ nivel }: { nivel: Confianza }) {
  return (
    <Chip tono={TONO_CONFIANZA[nivel]} title={`Confianza ${nivel}`}>
      {ETIQUETA_CONFIANZA[nivel]}
    </Chip>
  );
}

function Selector({ etiqueta, todos, opciones, valor, onCambio }: { etiqueta: string; todos: string; opciones: OpcionFiltro[]; valor: number | null; onCambio: (v: number | null) => void }) {
  return (
    <label className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground max-sm:w-full">
      <span className="shrink-0 max-sm:w-20">{etiqueta}</span>
      <select className={cn(SELECT, FOCO)} value={valor ?? ""} onChange={(e) => onCambio(e.target.value === "" ? null : Number(e.target.value))}>
        <option value="">{todos}</option>
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}

type Bloque = "subidas" | "barato";

/**
 * Un total arriba que también elige qué lista se ve debajo (como las cifras del
 * tablero): las dos listas una encima de otra no cabían en la tablet (cada una
 * medía 36 px a 768×1024; revisión del 17/11/2026). Con error, lo dice y deja
 * reintentar; nunca se queda en «Calculando…».
 */
function Total({
  etiqueta,
  valor,
  detalle,
  testId,
  activo,
  onElegir,
  controla,
  error,
  onReintentar,
  reintentando,
}: {
  etiqueta: string;
  valor: string;
  detalle: string;
  testId: string;
  activo: boolean;
  onElegir: () => void;
  controla: string;
  error: string | null;
  onReintentar: () => void;
  reintentando: boolean;
}) {
  return (
    <div
      className={cn(
        "relative min-w-0 rounded-xl border px-3 py-2 transition-colors",
        activo ? "border-foreground/70 bg-card" : "border-transparent bg-muted/50 hover:border-border/70 hover:bg-muted",
      )}
      data-testid={testId}
    >
      <button
        type="button"
        aria-pressed={activo}
        aria-controls={controla}
        onClick={onElegir}
        className={cn("block w-full min-w-0 text-left after:absolute after:inset-0 after:rounded-xl", FOCO)}
      >
        <span className="block text-xs font-medium leading-snug text-muted-foreground">{etiqueta}</span>
        <span className={cn("block font-semibold leading-tight tabular-nums tracking-tight", error ? "text-sm text-destructive" : "text-lg text-foreground")}>
          {error ? "No se ha podido calcular" : valor}
        </span>
        <span className="line-clamp-2 block text-xs leading-snug text-muted-foreground @[64rem]/tablero:line-clamp-1" title={error ?? detalle}>
          {error ?? detalle}
        </span>
      </button>
      {error && <Reintentar onClick={onReintentar} cargando={reintentando} className="relative z-10 mt-1.5" />}
    </div>
  );
}

function Reintentar({ onClick, cargando, className }: { onClick: () => void; cargando: boolean; className?: string }) {
  return (
    <button type="button" className={cn(BOTON, FOCO, className)} onClick={onClick} disabled={cargando}>
      <RotateCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} aria-hidden /> {cargando ? "Reintentando…" : "Reintentar"}
    </button>
  );
}

function Fila({ titulo, nivel, linea, cifra, pieCifra, detalle, motivo, children }: { titulo: string; nivel: Confianza; linea: ReactNode; cifra: string; pieCifra: string; detalle: ReactNode; motivo: string; children?: ReactNode }) {
  return (
    <li className={cn("border-b border-border/60 py-2.5 last:border-0", nivel === "baja" && "opacity-80")} data-confianza={nivel}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-medium leading-snug text-foreground">
            <span className="min-w-0 break-words">{titulo}</span>
            <ChipConfianza nivel={nivel} />
          </p>
          <p className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">{linea}</p>
          <p className="mt-1 break-words text-xs leading-snug text-muted-foreground">{detalle}</p>
          <p className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">
            <span className="font-medium text-foreground/80">{nivel === "baja" ? "Por qué hay que revisarlo: " : "Confianza: "}</span>
            {motivo}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("text-sm font-semibold tabular-nums", nivel === "baja" ? "text-muted-foreground line-through decoration-1" : "text-foreground")}>{cifra}</p>
          <p className="text-xs text-muted-foreground">{pieCifra}</p>
          {/* Desde 640 px el botón va bajo la cifra: cada fila gana una línea de alto (17/11/2026). */}
          {children && <div className="mt-1 flex flex-col items-end gap-1 max-sm:hidden">{children}</div>}
        </div>
      </div>
      {children && <div className="mt-1.5 flex flex-wrap gap-1.5 sm:hidden">{children}</div>}
    </li>
  );
}

const antes = (etiqueta: string, p: PrecioAntes | null) => (p ? `${etiqueta}: ${euros2(p.precio)} €${p.variacionPct !== null ? ` (${pct(p.variacionPct)})` : ""}` : `${etiqueta}: sin compra`);

function FilaDeSubida({ f, onComparar }: { f: FilaSubida; onComparar: () => void }) {
  return (
    <Fila
      titulo={f.producto}
      nivel={f.confianza}
      linea={
        <>
          {proveedorCorto(f.proveedor)} · {euros2(f.precioRef)} → <strong className="font-semibold text-foreground">{euros2(f.precio)} €/{f.unidad}</strong> ({pct(f.variacionPct)})
        </>
      }
      cifra={`+${euros0(f.impactoAnual)} €`}
      pieCifra="al año"
      detalle={`${antes("Hace 3 meses", f.hace3)} · ${antes("6", f.hace6)} · ${antes("12", f.hace12)} · Última compra: ${fechaEs(f.fecha)} · ${cantidad(f.cantidad12m, f.unidad)} en 12 meses`}
      motivo={f.motivo}
    >
      {(f.doc || f.docRef) && (
        <button type="button" className={cn(BOTON, FOCO)} onClick={onComparar}>
          <FileText className="h-3.5 w-3.5" aria-hidden /> {f.doc && f.docRef ? "Comparar facturas" : "Ver factura"}
        </button>
      )}
    </Fila>
  );
}

function FilaDeBarato({ f, onComparar }: { f: FilaBarato; onComparar: () => void }) {
  return (
    <Fila
      titulo={f.producto}
      nivel={f.confianza}
      linea={
        <>
          {proveedorCorto(f.proveedor)}: {euros2(f.precio)} €/{f.unidad} · <strong className="font-semibold text-foreground">{proveedorCorto(f.proveedorBarato)}: {euros2(f.precioBarato)} €/{f.unidad}</strong> ({pct(-f.diferenciaPct)})
        </>
      }
      cifra={`${euros0(f.ahorroAnual)} €`}
      pieCifra="de ahorro al año"
      detalle={`Le compraste ${cantidad(f.cantidad12m, f.unidad)} en 12 meses (${f.compras12m} ${f.compras12m === 1 ? "compra" : "compras"}, la última el ${fechaEs(f.fecha)}) · Al más barato, ${f.comprasBarato12m} ${f.comprasBarato12m === 1 ? "compra" : "compras"}, la última el ${fechaEs(f.fechaBarato)}`}
      motivo={f.motivo}
    >
      {(f.doc || f.docBarato) && (
        <button type="button" className={cn(BOTON, FOCO)} onClick={onComparar}>
          <FileText className="h-3.5 w-3.5" aria-hidden /> {f.doc && f.docBarato ? "Ver las dos facturas" : "Ver factura"}
        </button>
      )}
    </Fila>
  );
}

function NoEntran({ e }: { e: Excluidos }) {
  if (e.nGenericos === 0) return null;
  return (
    <details className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="informe-excluidos">
      <summary className={cn("cursor-pointer font-medium text-foreground/80", FOCO)}>
        No entran {e.nGenericos} productos genéricos ({euros0(e.gastoGenericos)} € en 12 meses)
      </summary>
      <p className="mt-1.5 leading-snug">Agrupan artículos distintos bajo un mismo nombre: comparar sus precios daría subidas y ahorros que no existen.</p>
      <ul className="mt-1.5 space-y-1">
        {e.genericos.map((g) => (
          <li key={g.productoId ?? g.producto} className="break-words leading-snug">
            <span className="font-medium text-foreground/80">{g.producto}</span> · {euros0(g.gasto12m)} € · {g.motivo}
          </li>
        ))}
      </ul>
    </details>
  );
}

function VerMas({ visibles, total, limite, onMas, cargando }: { visibles: number; total: number; limite: number; onMas: () => void; cargando: boolean }) {
  if (visibles >= total) return null;
  if (limite >= LIMITE_MAXIMO_INFORME) return <p className="py-2 text-xs text-muted-foreground">Se ven las {visibles} primeras de {total}. Usa los filtros para ver el resto.</p>;
  return (
    <button type="button" className={cn(BOTON, FOCO, "mt-2")} disabled={cargando} onClick={onMas}>
      {cargando ? "Cargando…" : `Ver más (${visibles} de ${total})`}
    </button>
  );
}

const CALCULANDO = "Calculando… Tarda unos segundos: repasa las compras de dos años.";
const SIN_MIGRACION = "Este informe necesita la migración «informe_subidas_proveedor».";

export function InformeSubidasProveedor({ local, onIrA }: Props) {
  const [bloque, setBloque] = useState<Bloque>("subidas");
  const [meses, setMeses] = useState<MesesInforme>(MESES_POR_DEFECTO);
  const [proveedorId, setProveedorId] = useState<number | null>(null);
  const [familiaId, setFamiliaId] = useState<number | null>(null);
  const [limiteSub, setLimiteSub] = useState(PAGINA_INFORME);
  const [limiteBar, setLimiteBar] = useState(PAGINA_INFORME);
  const filtros: FiltrosInforme = useMemo(() => ({ proveedorId, familiaId, local }), [proveedorId, familiaId, local]);
  const subQ = useInformeSubidas(meses, filtros, limiteSub);
  const barQ = useInformeBarato(filtros, limiteBar);
  // Con error no se enseña lo de antes (placeholderData) como si fuera de estos filtros.
  const sub = subQ.isError ? null : (subQ.data ?? null);
  const bar = barQ.isError ? null : (barQ.data ?? null);
  const errSub = subQ.isError ? mensajeErrorInforme(subQ.error) : null;
  const errBar = barQ.isError ? mensajeErrorInforme(barQ.error) : null;
  const { abrir, visor } = useVisor(onIrA);
  const idLista = useId();
  const filtrado = proveedorId !== null || familiaId !== null;

  // Las opciones de los filtros son las del informe SIN filtrar (con un filtro puesto, la RPC solo devuelve las suyas).
  const [opciones, setOpciones] = useState<{ proveedores: OpcionFiltro[]; familias: OpcionFiltro[] }>({ proveedores: [], familias: [] });
  useEffect(() => {
    if (proveedorId !== null || familiaId !== null || (!sub && !bar)) return;
    if (subQ.isPlaceholderData || barQ.isPlaceholderData) return;
    setOpciones({
      proveedores: unirOpciones(sub?.proveedores ?? [], bar?.proveedores ?? []),
      familias: unirOpciones(sub?.familias ?? [], bar?.familias ?? []),
    });
  }, [sub, bar, proveedorId, familiaId, subQ.isPlaceholderData, barQ.isPlaceholderData]);

  const cambiarFiltro = (hacer: () => void) => {
    hacer();
    setLimiteSub(PAGINA_INFORME);
    setLimiteBar(PAGINA_INFORME);
  };

  const valorTotal = (pendiente: boolean, texto: string | null) => (pendiente ? "—" : (texto ?? "—"));
  const detalleTotal = (pendiente: boolean, texto: string | null) => (pendiente ? "Calculando…" : (texto ?? "Falta la migración del informe"));

  // Vacío: distingue «no hay con qué comparar» de «nada ha subido / nada sale más barato».
  const conFiltros = filtrado ? " con estos filtros" : "";
  const vacioSub = !sub
    ? SIN_MIGRACION
    : sub.comparados === 0
      ? `No hay compras de hace ${meses} meses al mismo proveedor con las que comparar${conFiltros}. Prueba con otro periodo.`
      : `De ${sub.comparados} productos comparados, ninguno ha subido frente a hace ${meses} meses${conFiltros}.`;
  const vacioBar = !bar
    ? SIN_MIGRACION
    : bar.productosVariosProveedores === 0
      ? `Ningún producto se ha comprado a dos o más proveedores en 12 meses${conFiltros}: no hay con qué comparar.`
      : `De ${bar.productosVariosProveedores} productos comprados a varios proveedores, ninguno sale más barato en otro${conFiltros}.`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 max-sm:h-auto" data-testid="informe-subidas-proveedor">
      <div className="grid shrink-0 grid-cols-2 gap-2" role="group" aria-label="Qué lista ver">
        <Total
          testId="total-subidas"
          etiqueta={`Lo que te cuestan las subidas (frente a hace ${meses} meses)`}
          valor={valorTotal(subQ.isPending, sub ? `+${euros0(sub.fiable.importe)} € al año` : null)}
          detalle={detalleTotal(subQ.isPending, sub ? resumenSubidas(sub) : null)}
          activo={bloque === "subidas"}
          onElegir={() => setBloque("subidas")}
          controla={idLista}
          error={errSub}
          onReintentar={() => void subQ.refetch()}
          reintentando={subQ.isFetching}
        />
        <Total
          testId="total-ahorro"
          etiqueta="Ahorro posible cambiando de proveedor"
          valor={valorTotal(barQ.isPending, bar ? `${euros0(bar.fiable.importe)} € al año` : null)}
          detalle={detalleTotal(barQ.isPending, bar ? resumenBarato(bar) : null)}
          activo={bloque === "barato"}
          onElegir={() => setBloque("barato")}
          controla={idLista}
          error={errBar}
          onReintentar={() => void barQ.refetch()}
          reintentando={barQ.isFetching}
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <Selector etiqueta="Proveedor" todos="Todos" opciones={opciones.proveedores} valor={proveedorId} onCambio={(v) => cambiarFiltro(() => setProveedorId(v))} />
        <Selector etiqueta="Categoría" todos="Todas" opciones={opciones.familias} valor={familiaId} onCambio={(v) => cambiarFiltro(() => setFamiliaId(v))} />
        {bloque === "subidas" && (
          <Segmentado
            compacto
            etiqueta="Comparar la última compra con la de hace"
            opciones={MESES_INFORME.map((m) => ({ valor: String(m), etiqueta: `Hace ${m} meses` }))}
            valor={String(meses)}
            onCambio={(v) => cambiarFiltro(() => setMeses(Number(v) as MesesInforme))}
          />
        )}
      </div>

      {/* Una lista a la vez, con todo el alto que queda y scroll dentro (la página no desplaza). En pantallas muy
          bajas no encoge de 16rem: entonces desplaza la vista de Análisis, no la página. En el móvil, el tablero
          entero desplaza como una página (igual que las demás vistas). */}
      <div id={idLista} className="flex min-h-[16rem] flex-1 flex-col max-sm:min-h-0">
        {bloque === "subidas" ? (
          <Caja
            titulo="Subidas de precio"
            subtitulo={`Última compra frente a la de hace ${meses} meses (mismo proveedor, unidad y envase; sin IVA). Impacto: la diferencia por lo comprado en 12 meses.`}
            testId="caja-informe-subidas"
          >
            {errSub ? (
              <SinDatos>
                <span className="block">{errSub}</span>
                <Reintentar onClick={() => void subQ.refetch()} cargando={subQ.isFetching} className="mt-2" />
              </SinDatos>
            ) : subQ.isPending ? (
              <SinDatos>{CALCULANDO}</SinDatos>
            ) : !sub || sub.filas.length === 0 ? (
              <SinDatos>{vacioSub}</SinDatos>
            ) : (
              <>
                <ol aria-label="Subidas de precio, de más a menos impacto" className={cn(subQ.isPlaceholderData && "opacity-60")}>
                  {sub.filas.map((f) => (
                    <FilaDeSubida key={f.id} f={f} onComparar={() => abrir([f.docRef, f.doc], notasSubida(f), productoDeFila(f))} />
                  ))}
                </ol>
                <VerMas visibles={sub.filas.length} total={sub.totalFilas} limite={limiteSub} cargando={subQ.isFetching} onMas={() => setLimiteSub(siguienteLimite(limiteSub))} />
                {sub.sinReferencia > 0 && (
                  <p className="mt-2 text-xs leading-snug text-muted-foreground">
                    {sub.sinReferencia} productos no se pueden comparar: no hay compra al mismo proveedor de hace {meses} meses.
                  </p>
                )}
                <NoEntran e={sub.excluidos} />
              </>
            )}
          </Caja>
        ) : (
          <Caja
            titulo="Proveedor más barato"
            subtitulo="Última factura de cada proveedor en 12 meses (misma unidad y envase; sin IVA). Ahorro: la diferencia por lo comprado al más caro."
            testId="caja-informe-barato"
          >
            {errBar ? (
              <SinDatos>
                <span className="block">{errBar}</span>
                <Reintentar onClick={() => void barQ.refetch()} cargando={barQ.isFetching} className="mt-2" />
              </SinDatos>
            ) : barQ.isPending ? (
              <SinDatos>{CALCULANDO}</SinDatos>
            ) : !bar || bar.filas.length === 0 ? (
              <SinDatos>{vacioBar}</SinDatos>
            ) : (
              <>
                <ol aria-label="Productos más baratos en otro proveedor, de más a menos ahorro" className={cn(barQ.isPlaceholderData && "opacity-60")}>
                  {bar.filas.map((f) => (
                    <FilaDeBarato key={f.id} f={f} onComparar={() => abrir([f.doc, f.docBarato], notasBarato(f), productoDeFila(f))} />
                  ))}
                </ol>
                <VerMas visibles={bar.filas.length} total={bar.totalFilas} limite={limiteBar} cargando={barQ.isFetching} onMas={() => setLimiteBar(siguienteLimite(limiteBar))} />
                <NoEntran e={bar.excluidos} />
              </>
            )}
          </Caja>
        )}
      </div>
      {visor}
    </div>
  );
}
