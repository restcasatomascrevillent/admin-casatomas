// «Gráficas de decisión» de Facturas › Análisis (maqueta aprobada por el dueño,
// RPC facturas_decision, 20261115100000). Son módulos del tablero, no una
// pestaña aparte; cada uno responde a una pregunta:
//   · FamiliasFrenteMedia   ¿En qué se va el dinero?   (módulo «familias»)
//   · CambiosDePrecio       ¿Qué me están subiendo?    (módulo «subidas»)
//   · PreciosLoMasComprado  ¿Cómo van los precios de lo que más compro? («precios_top»)
//   · DondeAhorrar          ¿Dónde puedo ahorrar?      («ahorro»)
// Las alertas van DENTRO de las tarjetas (no en una lista suelta). Desde
// cualquier fila se abre la factura de origen (VisorDocumento) o se lleva al
// explorador. «Visto», «Es normal» y el precio pactado piden «Editar».
// Textos cortos propios: nada de recortar el mensaje largo con «…».
import { useId, useState, type ReactNode } from "react";
import { Check, FileText, Handshake, LineChart, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatEntero, plural } from "@/components/facturas/shared/formatters";
import {
  geometriaMini,
  resumenDecision,
  textoMesesReferencia,
  textoPctCorto,
  tonoVariacion,
  type CambioPrecio,
  type DecisionFacturas,
  type FamiliaDecision,
  type PestanaCambios,
  type ProductoTop,
} from "@/lib/facturas/decision";
import { resumenCortoAlerta, tituloCortoAlerta } from "@/lib/facturas/alertas";
import type { DocumentoCifra } from "@/lib/facturas/documentosCifra";
import { FILTROS_VACIOS, type ConfigExplorador } from "@/lib/facturas/explorador";
import type { Tamano } from "@/lib/facturas/widgetsTablero";
import { mesCorto } from "@/lib/facturas/resumenCompras";
import { nombreMes as nombreMesLargo } from "@/lib/facturas/vistasAnalisis";
import { useAccionDecision } from "@/hooks/useDecisionFacturas";
import { usePuedeEditarFacturas } from "./edicionFacturas";
import { VisorDocumento } from "./VisorDocumento";
import { BotonVerMas, FILAS_TAMANO, FilaConMenu, FOCO, SinDatos, Tarjeta, type AccionMenu } from "./piezas";

const ICONO = "h-4 w-4 text-muted-foreground";
const LISTA = "space-y-0.5 @[52rem]:grid @[52rem]:grid-cols-2 @[52rem]:gap-x-6 @[52rem]:space-y-0";

const CHIP = "inline-flex items-center whitespace-nowrap rounded-full px-1.5 py-px text-xs font-semibold tabular-nums";
const TONO_CHIP = {
  sube: "bg-red-500/10 text-red-700 dark:text-red-400",
  baja: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  plano: "bg-primary/10 text-primary",
  aviso: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
} as const;

export function Chip({ tono, children, title }: { tono: keyof typeof TONO_CHIP; children: ReactNode; title?: string }) {
  return (
    <span className={cn(CHIP, TONO_CHIP[tono])} title={title}>
      {children}
    </span>
  );
}

export const BOTON =
  "inline-flex min-h-9 items-center gap-1 rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium text-foreground hover:border-primary/50 hover:text-primary disabled:opacity-50 pointer-coarse:min-h-11";

interface Comunes {
  decision: DecisionFacturas;
  tamano?: Tamano;
  onAmpliar?: () => void;
  pendiente?: boolean;
}

const nombreMes = (mes: string) => mesCorto(mes, false);

/** El visor de un documento (o dos, para comparar) dentro de una tarjeta. */
export function useVisor(onIrA?: (enlace: string) => void) {
  const [docs, setDocs] = useState<DocumentoCifra[]>([]);
  const [indice, setIndice] = useState<number | null>(null);
  const abrir = (d: (DocumentoCifra | null)[]) => {
    const lista = d.filter((x): x is DocumentoCifra => !!x);
    if (lista.length === 0) return;
    setDocs(lista);
    setIndice(0);
  };
  const visor = (
    <VisorDocumento
      documentos={docs}
      indice={indice}
      onIndice={setIndice}
      onCerrar={() => setIndice(null)}
      onAbrirEnCompras={onIrA}
      total={docs.length}
    />
  );
  return { abrir, visor };
}

const explorarPrecio = (producto: string, unidad: string | null, proveedor?: { id: number; nombre: string } | null): Partial<ConfigExplorador> => ({
  medida: "precio",
  agrupar: "mes",
  desglose: "proveedor",
  filtros: { ...FILTROS_VACIOS, productos: [producto], unidad: unidad ? unidad.toLowerCase() : null, ...(proveedor ? { proveedores: [proveedor] } : {}) },
});

// ─── 1. ¿En qué se va el dinero? ────────────────────────────────────────────

export function FamiliasFrenteMedia({
  decision,
  tamano = "m",
  onAmpliar,
  acciones,
  sinClasificar,
  onClasificar,
}: Comunes & {
  acciones: (f: FamiliaDecision) => AccionMenu[];
  sinClasificar?: { lineas: number; importe: number };
  onClasificar?: () => void;
}) {
  const puedeEditar = usePuedeEditarFacturas();
  const [todas, setTodas] = useState(false);
  const idLista = useId();
  const fams = decision.familias;
  const limite = Math.max(FILAS_TAMANO[tamano], 8);
  const visibles = todas ? fams : fams.slice(0, limite);
  const max = Math.max(1, ...fams.flatMap((f) => [f.importe, f.referencia ?? 0]));
  const ref = textoMesesReferencia(decision.referencia.meses);
  const pct = decision.umbrales.familiaPct;
  const fuera = fams.filter((f) => f.aviso);
  // Con «Año» o «Todo» no suele haber meses completos ANTES del periodo (20261115300000):
  // entonces se compara su último mes completo con la media de los anteriores del periodo.
  const comparado = decision.periodo.comparado;
  const ultimoMes = comparado?.modo === "ultimo_mes" ? nombreMesLargo(comparado.desde) : null;
  return (
    <Tarjeta
      titulo="¿En qué se va el dinero?"
      subtitulo={
        ref && ultimoMes
          ? `Base sin IVA. Barra: ${ultimoMes}, el último mes completo (no hay meses anteriores al periodo); raya: media de ${ref}. Aviso si se sale más de un ${pct} %.`
          : ref
            ? `Base sin IVA por familia. La barra es el periodo; la raya, la media de ${ref}. Aviso si se sale más de un ${pct} %.`
            : "Base sin IVA por familia (aún no hay meses completos para comparar)."
      }
      resumen={
        fams.length
          ? `${fams[0].familia} es la familia con más gasto, ${formatCurrency(fams[0].importe)}.${fuera.length ? ` Fuera de lo normal: ${fuera.map((f) => f.familia).join(", ")}.` : ""}`
          : "No hay gasto por familia en este periodo."
      }
      testId="tarjeta-familias"
      onAmpliar={onAmpliar}
    >
      {sinClasificar && sinClasificar.lineas > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-900 dark:text-amber-200" role="note">
          <span className="min-w-0 flex-1">
            <strong className="font-medium">{plural(sinClasificar.lineas, "línea sin clasificar", "líneas sin clasificar")}</strong> ({formatCurrency(sinClasificar.importe)}): salen en «Sin clasificar».
          </span>
          {puedeEditar && onClasificar && (
            <button type="button" onClick={onClasificar} className={cn(BOTON, FOCO)}>
              <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden /> Clasificar con IA
            </button>
          )}
        </div>
      )}
      {decision.periodo.enCurso && !ultimoMes && (
        <p className="mb-1.5 text-xs text-muted-foreground">Periodo en curso: la media se cuenta hasta hoy.</p>
      )}
      {fams.length === 0 ? (
        <SinDatos>No hay líneas con importe en este periodo.</SinDatos>
      ) : (
        <>
          <ul className={LISTA} id={idLista} aria-label="Gasto por familia frente a su media">
            {visibles.map((f) => {
              const tono = tonoVariacion(f.variacionPct);
              return (
                <li key={f.id ?? f.familia} data-aviso={f.aviso || undefined}>
                  <FilaConMenu
                    nombre={`${f.familia}: ${formatCurrency(f.importe)}${f.referencia !== null ? `, media ${formatCurrency(f.referencia)}, ${textoPctCorto(f.variacionPct)}` : ""}${f.aviso ? ". Fuera de lo normal" : ""}. Opciones`}
                    cabecera={{
                      titulo: `${f.familia} · ${formatCurrency(f.importe)}`,
                      detalle: f.referencia !== null ? `Media ${formatCurrency(f.referencia)} · ${textoPctCorto(f.variacionPct)}` : undefined,
                    }}
                    acciones={acciones(f)}
                    className={cn(
                      "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 rounded-md px-1.5 py-1 text-left hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent",
                      "@[30rem]:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto_3.75rem]",
                      FOCO,
                    )}
                  >
                    <span className="col-span-3 flex min-w-0 items-center gap-1.5 text-sm @[30rem]:col-span-1">
                      <span className="min-w-0 truncate" title={f.familia}>{f.familia}</span>
                      {f.aviso && <Chip tono="aviso" title="Genera aviso">Aviso</Chip>}
                    </span>
                    <span className="relative block h-3.5 min-w-10" aria-hidden>
                      <span className="absolute inset-y-0.5 left-0 rounded-sm bg-primary/80" style={{ width: `${(Math.max(0, f.importe) / max) * 100}%` }} />
                      {f.referencia !== null && f.referencia > 0 && (
                        <span className="absolute -inset-y-px w-0.5 bg-foreground/60" style={{ left: `${(f.referencia / max) * 100}%` }} />
                      )}
                    </span>
                    <span className="whitespace-nowrap text-right text-sm tabular-nums">{formatCurrency(f.importe)}</span>
                    <span className="text-right">
                      <Chip tono={tono}>{textoPctCorto(f.variacionPct)}</Chip>
                    </span>
                  </FilaConMenu>
                </li>
              );
            })}
          </ul>
          <BotonVerMas total={fams.length} visibles={limite} abierto={todas} onCambio={setTodas} controla={idLista} femenino />
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3.5 rounded-sm bg-primary/80" />{ultimoMes ? ultimoMes.charAt(0).toUpperCase() + ultimoMes.slice(1) : "Periodo"}</span>
            {ref && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-0.5 bg-foreground/60" />Media {ref}</span>}
          </p>
        </>
      )}
    </Tarjeta>
  );
}

// ─── 2. ¿Qué me están subiendo? ─────────────────────────────────────────────

function FilaCambio({
  c,
  pestana,
  onVerDocs,
  onExplorar,
  puedeEditar,
  pendiente,
}: {
  c: CambioPrecio;
  pestana: PestanaCambios | "aviso";
  onVerDocs: (docs: (DocumentoCifra | null)[]) => void;
  onExplorar: (cfg: Partial<ConfigExplorador>) => void;
  puedeEditar: boolean;
  pendiente?: boolean;
}) {
  const accion = useAccionDecision();
  const a = c.alerta;
  const d = a.datos;
  const pct = d.variacionPct;
  const titulo = tituloCortoAlerta(a);
  const resumen = resumenCortoAlerta(a);
  const ocupado = pendiente || accion.isPending;
  return (
    <li className="border-t border-border/60 py-2 first:border-t-0" data-tipo={a.tipo} data-campana={c.campana || undefined}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium leading-snug [overflow-wrap:anywhere]">
          {a.tipo === "facturas_precio_mejor" ? d.producto ?? titulo : titulo.replace(/\s[+−-][\d.,]+\s%$/, "")}
        </p>
        {a.tipo === "facturas_precio_mejor" ? (
          <Chip tono="baja">{d.ahorro !== null ? `${formatEntero(d.ahorro)} €` : "más barato"}</Chip>
        ) : pct !== null ? (
          <Chip tono={a.tipo === "facturas_precio_baja" ? "baja" : a.tipo === "facturas_precio_pactado" ? "aviso" : "sube"}>{textoPctCorto(pct)}</Chip>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">
        {d.proveedor && a.tipo !== "facturas_precio_mejor" && a.tipo !== "facturas_precio_proveedor" ? `${d.proveedor} · ` : ""}
        <span className="tabular-nums">{resumen}</span>
        {c.impactoMes !== null && a.tipo === "facturas_precio_sube" && !c.campana && <span> · sin aviso</span>}
      </p>
      {!pendiente && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {a.tipo === "facturas_precio_mejor" ? (
            (c.doc || c.docOtro) && (
              <button type="button" className={cn(BOTON, FOCO)} onClick={() => onVerDocs([c.docOtro, c.doc])}>
                <FileText className="h-3.5 w-3.5" aria-hidden /> Comparar facturas
              </button>
            )
          ) : (
            c.doc && (
              <button type="button" className={cn(BOTON, FOCO)} onClick={() => onVerDocs([c.doc])}>
                <FileText className="h-3.5 w-3.5" aria-hidden /> Ver factura
              </button>
            )
          )}
          {d.producto && a.tipo !== "facturas_precio_proveedor" && (
            <button
              type="button"
              className={cn(BOTON, FOCO)}
              onClick={() => onExplorar(explorarPrecio(d.producto as string, a.tipo === "facturas_precio_mejor" ? null : d.unidad))}
            >
              <LineChart className="h-3.5 w-3.5" aria-hidden /> Ver en la gráfica
            </button>
          )}
          {puedeEditar && (
            <>
              <button type="button" className={cn(BOTON, FOCO)} disabled={ocupado} onClick={() => accion.mutate({ tipo: "visto", id: a.id })}>
                <Check className="h-3.5 w-3.5" aria-hidden /> Visto
              </button>
              <button
                type="button"
                className={cn(BOTON, FOCO)}
                disabled={ocupado}
                title="No vuelve a avisar de esto en 90 días"
                onClick={() => accion.mutate({ tipo: "es_normal", id: a.id })}
              >
                <X className="h-3.5 w-3.5" aria-hidden /> {pestana === "mejor" ? "No es lo mismo" : "Es normal"}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function CambiosDePrecio({
  decision,
  tamano = "m",
  onAmpliar,
  pendiente,
  onExplorar,
  onIrA,
}: Comunes & { onExplorar: (c: Partial<ConfigExplorador>) => void; onIrA?: (enlace: string) => void }) {
  const puedeEditar = usePuedeEditarFacturas();
  const [pestana, setPestana] = useState<PestanaCambios>("sube");
  const [todas, setTodas] = useState(false);
  const idLista = useId();
  const { abrir, visor } = useVisor(onIrA);
  const c = decision.cambios;
  const min = decision.umbrales.campanaMinEur;
  // Arriba de «Suben», lo que va a la campana sin ser una subida suelta: precio pactado roto y proveedor que sube varias.
  const avisos = pestana === "sube" ? [...c.pactado, ...c.proveedor] : [];
  const lista = c[pestana];
  const limite = FILAS_TAMANO[tamano];
  const visibles = todas ? lista : lista.slice(0, limite);
  const pequenas = c.sube.filter((x) => !x.campana && (x.impactoMes ?? 0) < min);
  const pies: Record<PestanaCambios, string> = {
    sube: pequenas.length
      ? `${plural(pequenas.length, "subida pequeña", "subidas pequeñas")} (menos de ${formatEntero(min)} € al mes): se ven aquí y no avisan en la campana.`
      : `A la campana solo llegan las subidas que cuestan ${formatEntero(min)} € al mes o más.`,
    mejor: "Comprueba que es la misma calidad antes de cambiar de proveedor.",
    baja: "Productos que compras a menudo y bajan más de un 10 %: buen momento para hacer acopio.",
  };
  const r = resumenDecision(decision);
  return (
    <Tarjeta
      titulo="¿Qué me están subiendo?"
      subtitulo="Cambios de precio ordenados por lo que te cuestan al mes, no por el porcentaje. Sin IVA, frente a la mediana de los 90 días anteriores."
      resumen={
        c.sube.length
          ? `${plural(c.sube.length, "precio ha subido", "precios han subido")}: unos ${formatEntero(r.impactoMes)} € más al mes. El que más pesa: ${tituloCortoAlerta(c.sube[0].alerta)}.`
          : "Ningún precio ha subido por encima del umbral."
      }
      testId="tarjeta-subidas"
      onAmpliar={onAmpliar}
    >
      <div role="group" aria-label="Tipo de cambio" className="mb-1 flex flex-wrap gap-1.5">
        {(
          [
            ["sube", `Suben (${c.sube.length})`],
            ["mejor", `Más barato en otro (${c.mejor.length})`],
            ["baja", `Bajan (${c.baja.length})`],
          ] as [PestanaCambios, string][]
        ).map(([v, t]) => (
          <button
            key={v}
            type="button"
            aria-pressed={pestana === v}
            onClick={() => {
              setPestana(v);
              setTodas(false);
            }}
            className={cn(
              "min-h-9 rounded-md border border-border/70 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground pointer-coarse:min-h-11",
              "aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:font-semibold aria-pressed:text-primary",
              FOCO,
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {avisos.length > 0 && (
        <ul aria-label="Avisos de precio" className="mb-1 rounded-lg bg-amber-500/10 px-2.5" data-testid="avisos-precio">
          {avisos.map((x) => (
            <FilaCambio key={x.alerta.id} c={x} pestana="aviso" onVerDocs={abrir} onExplorar={onExplorar} puedeEditar={puedeEditar} pendiente={pendiente} />
          ))}
        </ul>
      )}
      {lista.length === 0 ? (
        <SinDatos>
          {pestana === "sube" ? "Ningún precio ha subido por encima del umbral." : pestana === "mejor" ? "Nada más barato en otro proveedor que ya uses." : "Ninguna bajada de lo que compras a menudo."}
        </SinDatos>
      ) : (
        <>
          <ul id={idLista} aria-label="Cambios de precio">
            {visibles.map((x) => (
              <FilaCambio key={x.alerta.id} c={x} pestana={pestana} onVerDocs={abrir} onExplorar={onExplorar} puedeEditar={puedeEditar} pendiente={pendiente} />
            ))}
          </ul>
          <BotonVerMas total={lista.length} visibles={limite} abierto={todas} onCambio={setTodas} controla={idLista} />
        </>
      )}
      <p className="mt-1 text-xs text-muted-foreground">{pies[pestana]}</p>
      {visor}
    </Tarjeta>
  );
}

// ─── 3. ¿Cómo van los precios de lo que más compro? ─────────────────────────

function Mini({ p, acciones }: { p: ProductoTop; acciones: AccionMenu[] }) {
  const g = geometriaMini(
    p.meses,
    p.alertas.map((a) => a.mes ?? ""),
  );
  const alerta = p.alertas.length > 0;
  const tono = tonoVariacion(g.variacionPct, 3);
  const precio = g.ultimoPrecio;
  const nota = p.pactado
    ? `Pactado ${formatCurrency(p.pactado.precio)}`
    : alerta
      ? `Aviso de subida en ${p.alertas.map((a) => (a.mes ? nombreMes(a.mes) : "")).filter(Boolean).join(", ")}`
      : tono === "plano"
        ? "Estable"
        : null;
  return (
    <FilaConMenu
      nombre={`${p.producto}: ${precio !== null ? `${formatCurrency(precio)} por ${p.unidad}` : "sin precio"}, ${textoPctCorto(g.variacionPct)} en 6 meses${alerta ? ", con aviso de subida" : ""}${p.pactado ? `, precio pactado ${formatCurrency(p.pactado.precio)}` : ""}. Opciones`}
      cabecera={{ titulo: p.producto, detalle: [p.proveedor, precio !== null ? `${formatCurrency(precio)}/${p.unidad}` : null].filter(Boolean).join(" · ") }}
      acciones={acciones}
      className={cn(
        "grid w-full min-w-0 gap-0.5 rounded-lg border px-2.5 py-2 text-left hover:bg-muted/40 disabled:cursor-default",
        alerta ? "border-red-400/70 dark:border-red-500/50" : "border-border/70",
        FOCO,
      )}
    >
      <span className="truncate text-xs font-medium" title={p.producto}>{p.producto}</span>
      <span className="flex items-baseline justify-between gap-1.5 text-xs">
        <span className="tabular-nums">{precio !== null ? `${formatCurrency(precio)}/${p.unidad}` : "—"}</span>
        <Chip tono={tono}>{textoPctCorto(g.variacionPct)}</Chip>
      </span>
      <svg viewBox="0 0 150 42" preserveAspectRatio="none" className="block h-10 w-full" aria-hidden>
        <line x1="4" x2="146" y1="38" y2="38" className="stroke-border" strokeWidth="1" />
        {g.area && <path d={g.area} className="fill-primary/10" />}
        {g.linea && <path d={g.linea} fill="none" className="stroke-primary" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />}
        {g.ultimo && <circle cx={g.ultimo.x} cy={g.ultimo.y} r="2.6" className="fill-primary" />}
        {g.alertas.map((a) => (
          <circle key={a.mes} cx={a.x} cy={a.y} r="3.5" className="fill-red-600 dark:fill-red-400" data-alerta-mes={a.mes} />
        ))}
      </svg>
      <span className="text-[0.6875rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
        {nota ? `${nota} · ` : ""}
        {formatEntero(p.importe90)} € en 90 días
      </span>
    </FilaConMenu>
  );
}

export function PreciosLoMasComprado({
  decision,
  onAmpliar,
  pendiente,
  onExplorar,
  onVerDocumentos,
}: Comunes & {
  onExplorar: (c: Partial<ConfigExplorador>) => void;
  /** Las facturas de ese producto (DocumentosDeCifra). */
  onVerDocumentos: (p: ProductoTop) => void;
}) {
  const puedeEditar = usePuedeEditarFacturas();
  const accion = useAccionDecision();
  const top = decision.top;
  const desde = decision.topDesde ? nombreMes(decision.topDesde.slice(0, 7)) : null;
  const hasta = decision.periodo.hasta ? nombreMes(decision.periodo.hasta.slice(0, 7)) : null;
  const acciones = (p: ProductoTop): AccionMenu[] => {
    if (pendiente) return [];
    const l: AccionMenu[] = [
      {
        etiqueta: "Ver su precio en el explorador",
        icono: <LineChart className={ICONO} aria-hidden />,
        onClick: () => onExplorar(explorarPrecio(p.linea ?? p.producto, p.unidad)),
      },
      { etiqueta: "Ver sus facturas", icono: <FileText className={ICONO} aria-hidden />, onClick: () => onVerDocumentos(p) },
    ];
    const ultimo = geometriaMini(p.meses, []).ultimoPrecio;
    if (puedeEditar && p.proveedorId !== null && p.nombreNormalizado) {
      if (p.pactado)
        l.push({
          etiqueta: `Quitar el precio pactado (${formatCurrency(p.pactado.precio)})`,
          icono: <Handshake className={ICONO} aria-hidden />,
          onClick: () => accion.mutate({ tipo: "quitar_pacto", proveedorId: p.proveedorId as number, nombreNormalizado: p.nombreNormalizado as string }),
        });
      else if (ultimo !== null)
        l.push({
          etiqueta: `Marcar ${formatCurrency(ultimo)}/${p.unidad} como precio pactado`,
          icono: <Handshake className={ICONO} aria-hidden />,
          onClick: () =>
            accion.mutate({
              tipo: "pactar",
              proveedorId: p.proveedorId as number,
              nombreNormalizado: p.nombreNormalizado as string,
              precio: ultimo,
              unidad: p.unidad,
              producto: p.producto,
            }),
        });
    }
    return l;
  };
  return (
    <Tarjeta
      titulo="¿Cómo van los precios de lo que más compro?"
      subtitulo={`Precio mediano por mes${desde && hasta ? `, ${desde}–${hasta}` : ""}, de los ${top.length || 6} productos con más gasto en 90 días. Punto rojo: aviso de subida. Toca uno para ver sus facturas o marcar su precio pactado.`}
      resumen={top.length ? `Con más gasto: ${top.slice(0, 3).map((p) => p.producto).join(", ")}.` : "No hay compras suficientes para comparar precios."}
      testId="tarjeta-precios-top"
      onAmpliar={onAmpliar}
    >
      {top.length === 0 ? (
        <SinDatos>No hay compras con precio en los últimos 90 días.</SinDatos>
      ) : (
        <ul className="grid grid-cols-2 gap-2 @[30rem]:grid-cols-3 @[52rem]:grid-cols-6" aria-label="Precio de los productos con más gasto">
          {top.map((p) => (
            <li key={p.clave} className="min-w-0">
              <Mini p={p} acciones={acciones(p)} />
            </li>
          ))}
        </ul>
      )}
      {decision.revisarUnidades.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="revisar-unidades">
          <span className="font-medium text-amber-800 dark:text-amber-300">Revisar unidades:</span>{" "}
          {decision.revisarUnidades
            .map((r) => `${r.producto} mezcla compras por ${r.unidades.map((u) => `${u.unidad} (${formatCurrency(u.precio)})`).join(" y por ")}`)
            .join("; ")}
          . Fuera de la lista hasta que se corrija.
        </p>
      )}
    </Tarjeta>
  );
}

// ─── 4. ¿Dónde puedo ahorrar? ───────────────────────────────────────────────

export function DondeAhorrar({
  decision,
  onAmpliar,
  pendiente,
  onIrA,
}: Comunes & { onIrA?: (enlace: string) => void }) {
  const puedeEditar = usePuedeEditarFacturas();
  const accion = useAccionDecision();
  const { abrir, visor } = useVisor(onIrA);
  const mejor = decision.cambios.mejor;
  const r = resumenDecision(decision);
  const max = Math.max(1, ...mejor.map((m) => m.alerta.datos.ahorro ?? 0));
  return (
    <Tarjeta
      titulo="¿Dónde puedo ahorrar?"
      subtitulo="Lo que habrías pagado de menos en 90 días comprando el mismo producto al proveedor más barato que ya usas."
      resumen={mejor.length ? `Ahorro posible en 90 días: ${formatCurrency(r.ahorro90)}.` : "No hay nada más barato en otro proveedor."}
      testId="tarjeta-ahorro"
      onAmpliar={onAmpliar}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">Ahorro posible en 90 días</span>
        <span className="text-2xl font-medium tabular-nums text-emerald-700 dark:text-emerald-400">{formatCurrency(r.ahorro90)}</span>
      </div>
      {mejor.length === 0 ? (
        <SinDatos>Ningún producto sale más barato en otro proveedor que ya uses.</SinDatos>
      ) : (
        <ul className="space-y-0.5" aria-label="Productos más baratos en otro proveedor">
          {mejor.map((m) => {
            const d = m.alerta.datos;
            const nombre = d.producto ?? m.alerta.titulo;
            const acciones: AccionMenu[] = pendiente
              ? []
              : [
                  ...(m.doc || m.docOtro
                    ? [{ etiqueta: "Comparar facturas", icono: <FileText className={ICONO} aria-hidden />, onClick: () => abrir([m.docOtro, m.doc]) }]
                    : []),
                  ...(puedeEditar
                    ? [
                        { etiqueta: "Visto", icono: <Check className={ICONO} aria-hidden />, onClick: () => accion.mutate({ tipo: "visto", id: m.alerta.id }) },
                        { etiqueta: "No es lo mismo", icono: <X className={ICONO} aria-hidden />, onClick: () => accion.mutate({ tipo: "es_normal", id: m.alerta.id }) },
                      ]
                    : []),
                ];
            return (
              <li key={m.alerta.id}>
                <FilaConMenu
                  nombre={`${nombre}: ${formatCurrency(d.ahorro)} menos en 90 días en ${d.proveedor ?? "otro proveedor"}. Opciones`}
                  cabecera={{ titulo: nombre, detalle: resumenCortoAlerta(m.alerta) }}
                  acciones={acciones}
                  className={cn(
                    "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-md px-1.5 py-1 text-left hover:bg-muted/50 disabled:cursor-default",
                    "@[30rem]:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]",
                    FOCO,
                  )}
                >
                  <span className="col-span-2 min-w-0 text-sm [overflow-wrap:anywhere] @[30rem]:col-span-1">{nombre}</span>
                  <span className="block h-1.5 min-w-6 rounded-full bg-muted/70" aria-hidden>
                    <span className="block h-full rounded-full bg-emerald-600 dark:bg-emerald-400" style={{ width: `${((d.ahorro ?? 0) / max) * 100}%` }} />
                  </span>
                  <span className="whitespace-nowrap text-right text-sm tabular-nums">{formatCurrency(d.ahorro)}</span>
                  <span className="col-span-2 text-xs text-muted-foreground [overflow-wrap:anywhere] @[30rem]:col-span-3">{d.proveedor && d.proveedorOtro ? `${d.proveedor} → ${d.proveedorOtro}` : ""}</span>
                </FilaConMenu>
              </li>
            );
          })}
        </ul>
      )}
      {visor}
    </Tarjeta>
  );
}
