// Facturas › Análisis › «Subidas y proveedor» (informe fijo, 16/11/2026).
//
//   · Arriba, los dos totales: lo que cuestan al año las subidas y lo que se
//     ahorraría comprando al proveedor más barato. SOLO suman las filas de
//     confianza alta («Fiable») y media («Probable»); las de «Revisar» se ven,
//     al final de cada lista y con su motivo, pero no suman.
//   · Filtros: proveedor y categoría (los dos bloques) y con qué se compara
//     la última compra (hace 3, 6 o 12 meses; solo el bloque de subidas).
//   · Dos listas con scroll propio (la página no desplaza); en estrecho, una
//     debajo de otra dentro de la vista.
//   · «Comparar facturas» abre el visor de Análisis con las dos facturas y la
//     línea del producto marcada (el mismo de «Qué decidir hoy»).
// Las cuentas están en SQL (20261207110000_informe_subidas_proveedor).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
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
  "h-9 min-w-0 max-w-full rounded-md border border-border/70 bg-background px-2 text-[0.8125rem] text-foreground pointer-coarse:h-11 max-sm:w-full";

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

function Total({ etiqueta, valor, detalle, testId }: { etiqueta: string; valor: string; detalle: string; testId: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card px-3 py-2" data-testid={testId}>
      <p className="text-xs font-medium text-muted-foreground">{etiqueta}</p>
      <p className="text-lg font-semibold leading-tight tabular-nums tracking-tight text-foreground">{valor}</p>
      <p className="text-xs leading-snug text-muted-foreground">{detalle}</p>
    </div>
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
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("text-sm font-semibold tabular-nums", nivel === "baja" ? "text-muted-foreground line-through decoration-1" : "text-foreground")}>{cifra}</p>
          <p className="text-xs text-muted-foreground">{pieCifra}</p>
        </div>
      </div>
      <p className="mt-1 break-words text-xs leading-snug text-muted-foreground">{detalle}</p>
      <p className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">
        <span className="font-medium text-foreground/80">{nivel === "baja" ? "Por qué hay que revisarlo: " : "Confianza: "}</span>
        {motivo}
      </p>
      {children && <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>}
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

export function InformeSubidasProveedor({ local, onIrA }: Props) {
  const [meses, setMeses] = useState<MesesInforme>(MESES_POR_DEFECTO);
  const [proveedorId, setProveedorId] = useState<number | null>(null);
  const [familiaId, setFamiliaId] = useState<number | null>(null);
  const [limiteSub, setLimiteSub] = useState(PAGINA_INFORME);
  const [limiteBar, setLimiteBar] = useState(PAGINA_INFORME);
  const filtros: FiltrosInforme = useMemo(() => ({ proveedorId, familiaId, local }), [proveedorId, familiaId, local]);
  const subQ = useInformeSubidas(meses, filtros, limiteSub);
  const barQ = useInformeBarato(filtros, limiteBar);
  const sub = subQ.data ?? null;
  const bar = barQ.data ?? null;
  const { abrir, visor } = useVisor(onIrA);

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

  const vacio = (q: { isPending: boolean; isError: boolean; error: unknown }, dato: unknown, nada: string) =>
    q.isPending ? "Calculando… Tarda unos segundos: repasa las compras de dos años." : q.isError ? (q.error instanceof Error ? q.error.message : "No se ha podido calcular.") : dato === null ? "Este informe necesita la migración «informe_subidas_proveedor»." : nada;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 max-sm:h-auto" data-testid="informe-subidas-proveedor">
      <div className="grid shrink-0 grid-cols-1 gap-2 @[48rem]/tablero:grid-cols-2">
        <Total
          testId="total-subidas"
          etiqueta={`Lo que te cuestan las subidas (frente a hace ${meses} meses)`}
          valor={sub ? `+${euros0(sub.fiable.importe)} € al año` : "—"}
          detalle={sub ? resumenSubidas(sub) : "Calculando…"}
        />
        <Total testId="total-ahorro" etiqueta="Ahorro posible cambiando de proveedor" valor={bar ? `${euros0(bar.fiable.importe)} € al año` : "—"} detalle={bar ? resumenBarato(bar) : "Calculando…"} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <Selector etiqueta="Proveedor" todos="Todos" opciones={opciones.proveedores} valor={proveedorId} onCambio={(v) => cambiarFiltro(() => setProveedorId(v))} />
        <Selector etiqueta="Categoría" todos="Todas" opciones={opciones.familias} valor={familiaId} onCambio={(v) => cambiarFiltro(() => setFamiliaId(v))} />
        <Segmentado
          compacto
          etiqueta="Comparar la última compra con la de hace"
          opciones={MESES_INFORME.map((m) => ({ valor: String(m), etiqueta: `Hace ${m} meses` }))}
          valor={String(meses)}
          onCambio={(v) => cambiarFiltro(() => setMeses(Number(v) as MesesInforme))}
        />
        <p className="text-xs text-muted-foreground">Precios sin IVA. Sin abonos ni líneas regaladas.</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @[48rem]/tablero:grid-cols-2 @[48rem]/tablero:[grid-template-rows:minmax(0,1fr)]">
        <Caja
          titulo="Subidas de precio"
          subtitulo={`La última compra frente a la de hace ${meses} meses, al mismo proveedor y en la misma unidad. El impacto es la diferencia por lo comprado en 12 meses.`}
          testId="caja-informe-subidas"
        >
          {!sub || sub.filas.length === 0 ? (
            <SinDatos>{vacio(subQ, subQ.data, `Ningún producto ha subido frente a hace ${meses} meses con estos filtros.`)}</SinDatos>
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

        <Caja
          titulo="Proveedor más barato"
          subtitulo="Productos comprados a dos o más proveedores en 12 meses: la última factura de cada uno, en la misma unidad. El ahorro es la diferencia por lo comprado al más caro."
          testId="caja-informe-barato"
        >
          {!bar || bar.filas.length === 0 ? (
            <SinDatos>{vacio(barQ, barQ.data, "Con estos filtros, nada sale más barato en otro proveedor al que ya compras.")}</SinDatos>
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
      </div>
      {visor}
    </div>
  );
}
