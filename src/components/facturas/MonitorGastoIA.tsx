import { AlertTriangle, ChevronDown, Coins } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGastoIa, useGastoIaRealMes, useTopeIaMes } from "@/hooks/useGastoIa";
import {
  type EstadoTope,
  evaluarTope,
  fmtEurIa,
  fmtFechaCorta,
  type ModoMonitor,
  type ResumenGastoIa,
  type ResumenGastoReal,
  resumirGastoIa,
  resumirGastoReal,
  TOPE_IA_POR_DEFECTO,
  textoTipoCambioReal,
} from "@/lib/facturas/gastoIa";
import { TEXTO_TIPO_CAMBIO } from "@/components/costes/formato";

const fmtEntero = new Intl.NumberFormat("es-ES");
const fmtPct = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });

const TITULO: Record<ModoMonitor, string> = {
  chat: "IA este mes",
  ocr: "Lectura de facturas este mes",
};

/** Texto del aviso del tope; null si todo va bien. Sin euros de otros procesos: solo el porcentaje. */
export function textoAvisoTope(e: EstadoTope, topeEur: number): string | null {
  if (e.nivel === "ok") return null;
  const tope = fmtEurIa(topeEur);
  return e.nivel === "superado"
    ? `El gasto de IA del restaurante este mes ha superado el tope (${tope}).`
    : `El gasto de IA del restaurante este mes lleva el ${fmtPct.format(e.pct)} % del tope (${tope}).`;
}

/** Aviso visual del tope (ámbar al 80 %, rojo al pasarlo). No pinta nada si va bien. */
export function AvisoTopeIa({ estado, topeEur, className = "" }: { estado: EstadoTope; topeEur: number; className?: string }) {
  const texto = textoAvisoTope(estado, topeEur);
  if (!texto) return null;
  const rojo = estado.nivel === "superado";
  return (
    <p
      role="alert"
      data-testid="aviso-tope-ia"
      data-nivel={estado.nivel}
      className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
        rojo
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300"
      } ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{texto}</span>
    </p>
  );
}

/** Desglose con el gasto REAL del proceso de la pestaña (mes en curso) + lo estimado de hoy. */
function DesgloseGastoReal({ g, modo }: { g: ResumenGastoReal; modo: ModoMonitor }) {
  const hasta = fmtFechaCorta(g.ultimoDia);
  const linea = g.lineas.find((l) => l.clave === modo);
  return (
    <>
      <p className="mb-2 font-medium">Gasto de IA (OpenAI) · mes en curso · sin IVA</p>
      {linea && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0">
            {linea.etiqueta}
            <span className="block text-xs text-muted-foreground tabular-nums">
              Real (OpenAI) hasta {hasta}: {fmtEurIa(linea.realEur)}
            </span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              hoy, estimado: {fmtEurIa(linea.hoyEur)}
            </span>
          </span>
          <span className="shrink-0 font-medium tabular-nums">{fmtEurIa(linea.totalEur)}</span>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {g.repartoTexto}. Sin IVA. {textoTipoCambioReal(g.tipo)}.
      </p>
    </>
  );
}

/**
 * Cuerpo del desglose del proceso de la pestaña (OCR en «Cargar», chatbot en
 * «IA»): solo lo que cuesta ese proceso; el resto del gasto de IA se ve en
 * Super Admin › Costes. Lo comparten el monitor de «Cargar» y el texto de la
 * pestaña «IA» (`GastoIaPestana`): un solo sitio donde cambiarlo.
 */
export function DesgloseGastoIa({
  r,
  real,
  modo,
  estadoTope,
  topeEur = TOPE_IA_POR_DEFECTO,
}: {
  r: ResumenGastoIa;
  real?: ResumenGastoReal | null;
  modo: ModoMonitor;
  estadoTope?: EstadoTope;
  topeEur?: number;
}) {
  const aviso = estadoTope ? <AvisoTopeIa estado={estadoTope} topeEur={topeEur} className="mb-2" /> : null;
  if (real) {
    return (
      <>
        {aviso}
        <DesgloseGastoReal g={real} modo={modo} />
      </>
    );
  }
  const lineas = r.desglose.filter((l) => (modo === "chat" ? l.clave === "chat" : l.clave !== "chat"));
  return (
    <>
      {aviso}
      <p className="mb-2 font-medium">Gasto de IA · mes en curso · estimado</p>
      <ul className="space-y-1.5" aria-label="Desglose por proceso">
        {lineas.map((l) => (
          <li key={l.clave} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">
              {l.etiqueta}
              {l.eur !== null && (
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {fmtEntero.format(l.unidades)} {l.unidad}
                  {l.unidades > 0 ? ` · ${fmtEurIa(l.eur / l.unidades)} por ${l.unidad.replace(/s$/, "")}` : ""}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">{l.eur === null ? "sin datos todavía" : fmtEurIa(l.eur)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-baseline justify-between border-t pt-2 font-medium">
        <span>Total</span>
        <span className="tabular-nums">{r.eur === null ? "sin datos todavía" : fmtEurIa(r.eur)}</span>
      </div>
      {r.filasSinTarifa > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          {r.filasSinTarifa} {r.filasSinTarifa === 1 ? "registro usa" : "registros usan"} un modelo sin tarifa: no se
          suma.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Estimado: tokens × tarifa de OpenAI (aún sin el gasto real de OpenAI). Sin IVA. {TEXTO_TIPO_CAMBIO}.
      </p>
    </>
  );
}

/**
 * Datos del monitor compartidos por «Cargar» y la pestaña «IA»: estimado,
 * real del mes en curso y estado del tope. El tope se mide contra el gasto de
 * IA de todo el restaurante (real si lo hay, si no el estimado de Facturas).
 */
export function useMonitorGastoIa(modo: ModoMonitor) {
  const { data, isLoading } = useGastoIa();
  const { data: dataReal, isLoading: cargandoReal } = useGastoIaRealMes();
  const { data: tope } = useTopeIaMes();
  const topeEur = tope ?? TOPE_IA_POR_DEFECTO;
  const r = resumirGastoIa(data ?? [], modo);
  const real = dataReal ? resumirGastoReal(dataReal.actual, modo) : null;
  const gastoTotalEur = real ? real.totalEur : r.totalFacturasEur;
  return {
    r,
    real,
    cargando: isLoading || cargandoReal,
    topeEur,
    estadoTope: evaluarTope(gastoTotalEur, topeEur),
  };
}

/**
 * Monitor compacto de lo gastado en IA en Facturas (mes en curso, en €).
 * Una sola línea de 44 px (táctil); el desglose se abre en un desplegable
 * flotante, así que no añade alto a la página (regla del dueño: sin scroll
 * vertical de página). Si el mes se acerca o supera el tope, la línea se
 * tiñe de ámbar o rojo.
 *
 *   modo="chat"  → «IA este mes: 0,21 € · 187 preguntas · 0,001 € por pregunta»
 *   modo="ocr"   → «Lectura de facturas este mes: X € · N documentos · Y € por documento»
 *                  (OCR + clasificación de productos)
 */
export function MonitorGastoIA({ modo, className = "" }: { modo: ModoMonitor; className?: string }) {
  const { r, real, cargando, topeEur, estadoTope } = useMonitorGastoIa(modo);
  const singular = modo === "chat" ? "pregunta" : "documento";

  // Con gasto real de OpenAI manda lo real (+ el estimado de hoy); si la RPC no
  // existe o aún no hay datos reales, el estimado de siempre, marcado «estimado».
  const resumen = cargando
    ? "cargando…"
    : real
      ? [
          fmtEurIa(real.procesoEur),
          `real hasta ${fmtFechaCorta(real.ultimoDia)} + hoy est. ${fmtEurIa(real.procesoHoyEur)}`,
          "sin IVA",
        ].join(" · ")
      : r.eur === null
        ? "sin datos todavía"
        : [
            fmtEurIa(r.eur),
            `${fmtEntero.format(r.unidades)} ${r.unidadTexto}`,
            ...(r.porUnidadEur !== null ? [`${fmtEurIa(r.porUnidadEur)} por ${singular}`] : []),
            "estimado",
          ].join(" · ");

  const tinte =
    estadoTope.nivel === "superado"
      ? "border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive/15"
      : estadoTope.nivel === "aviso"
        ? "border-amber-500/60 bg-amber-500/10 text-amber-900 hover:bg-amber-500/15 dark:text-amber-200"
        : "border-border/50 bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground";
  const Icono = estadoTope.nivel === "ok" ? Coins : AlertTriangle;
  const avisoTexto = textoAvisoTope(estadoTope, topeEur);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`monitor-gasto-ia-${modo}`}
          data-nivel-tope={estadoTope.nivel}
          className={`flex min-h-11 w-full items-center gap-2 rounded-md border px-3 text-left text-xs sm:text-sm shadow-sm transition-colors ${tinte} ${className}`}
          aria-label={`${TITULO[modo]}: ${resumen}.${avisoTexto ? ` ${avisoTexto}` : ""} Ver desglose`}
        >
          <Icono className={`h-4 w-4 shrink-0 ${estadoTope.nivel === "ok" ? "text-primary" : ""}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            <span className={`font-medium ${estadoTope.nivel === "ok" ? "text-foreground" : ""}`}>{TITULO[modo]}:</span>{" "}
            <span className="tabular-nums">{resumen}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3 text-sm">
        <DesgloseGastoIa r={r} real={real} modo={modo} estadoTope={estadoTope} topeEur={topeEur} />
      </PopoverContent>
    </Popover>
  );
}
