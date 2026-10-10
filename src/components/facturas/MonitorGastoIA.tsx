import { AlertTriangle, ChevronDown, Coins } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGastoIa, useGastoIaRealMes, useTopeIaMes } from "@/hooks/useGastoIa";
import { useEstadisticasLectura } from "@/hooks/useEstadisticasLectura";
import { type EstadisticasLectura, fmtCentimos, nombreCortoProveedor, textoResumenLectura } from "@/lib/facturas/costeLectura";
import {
  diaDelMes,
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
import { TEXTO_TIPO_CAMBIO, USD_EUR } from "@/components/costes/formato";

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

/** Coste de leer documentos (media, mediana, el más caro y reparto), solo en «Cargar». */
function DesgloseLectura({ e, eurPorUsd }: { e: EstadisticasLectura; eurPorUsd: number }) {
  const k = eurPorUsd;
  const reparto = [...e.porPaginas, ...e.porLineas];
  return (
    <div data-testid="desglose-lectura" className="mt-3 border-t pt-2">
      <p className="mb-1 font-medium">Coste por documento · mes en curso</p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {fmtEntero.format(e.documentos)} {e.documentos === 1 ? "documento leído" : "documentos leídos"}
        {e.totalUsd !== null ? ` · ${fmtEurIa(e.totalUsd * k)} en total` : ""}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        media {fmtCentimos(e.mediaUsd, k)} · mediana {fmtCentimos(e.medianaUsd, k)}
      </p>
      {e.masCara && (
        <p className="text-xs text-muted-foreground tabular-nums">
          la más cara: {nombreCortoProveedor(e.masCara.proveedor) || "—"}
          {e.masCara.numero ? ` (${e.masCara.numero})` : ""} · {fmtCentimos(e.masCara.usd, k)}
        </p>
      )}
      {reparto.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-l pl-3 text-xs text-muted-foreground" aria-label="Coste medio por tamaño">
          {reparto.map((t) => (
            <li key={t.tramo} className="flex justify-between gap-3 tabular-nums">
              <span>
                {t.tramo} ({fmtEntero.format(t.documentos)})
              </span>
              <span>media {fmtCentimos(t.mediaUsd, k)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Lo que costó leer cada documento (visión, relecturas y embeddings), estimado con la tarifa del modelo.
      </p>
    </div>
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
  lectura,
}: {
  r: ResumenGastoIa;
  real?: ResumenGastoReal | null;
  modo: ModoMonitor;
  estadoTope?: EstadoTope;
  topeEur?: number;
  /** Estadísticas del coste de lectura (solo modo «ocr»). */
  lectura?: EstadisticasLectura | null;
}) {
  const aviso = estadoTope ? <AvisoTopeIa estado={estadoTope} topeEur={topeEur} className="mb-2" /> : null;
  const detalleLectura = modo === "ocr" && lectura ? <DesgloseLectura e={lectura} eurPorUsd={real?.tipo.eurPorUsd ?? USD_EUR} /> : null;
  if (real) {
    return (
      <>
        {aviso}
        <DesgloseGastoReal g={real} modo={modo} />
        {detalleLectura}
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
      {detalleLectura}
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
  // Solo «Cargar»: coste de leer cada documento (media, la más cara…) del mes en curso.
  const { data: lectura } = useEstadisticasLectura(diaDelMes(new Date()), modo === "ocr");
  const resumenLectura = modo === "ocr" ? textoResumenLectura(lectura, real?.tipo.eurPorUsd ?? USD_EUR) : null;
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

  const resumenCompleto = resumenLectura ? `${resumen} · ${resumenLectura}` : resumen;

  // Texto gris compacto, sin tarjeta ni borde; solo el tope lo tiñe de ámbar o rojo.
  const tinte =
    estadoTope.nivel === "superado"
      ? "text-destructive hover:bg-destructive/10"
      : estadoTope.nivel === "aviso"
        ? "text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
        : "text-muted-foreground hover:text-foreground";
  const Icono = estadoTope.nivel === "ok" ? Coins : AlertTriangle;
  const avisoTexto = textoAvisoTope(estadoTope, topeEur);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`monitor-gasto-ia-${modo}`}
          data-nivel-tope={estadoTope.nivel}
          className={`flex min-h-11 w-fit max-w-full items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors ${tinte} ${className}`}
          aria-label={`${TITULO[modo]}: ${resumenCompleto}.${avisoTexto ? ` ${avisoTexto}` : ""} Ver desglose`}
        >
          <Icono className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            <span>{TITULO[modo]}:</span>{" "}
            <span className="tabular-nums">{resumenCompleto}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3 text-sm">
        <DesgloseGastoIa r={r} real={real} modo={modo} estadoTope={estadoTope} topeEur={topeEur} lectura={lectura} />
      </PopoverContent>
    </Popover>
  );
}
