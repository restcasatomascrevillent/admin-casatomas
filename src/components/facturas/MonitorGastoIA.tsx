import { ChevronDown, Coins } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGastoIa } from "@/hooks/useGastoIa";
import { DIAS_GASTO_IA, fmtEurIa, type ModoMonitor, resumirGastoIa } from "@/lib/facturas/gastoIa";
import { TEXTO_TIPO_CAMBIO } from "@/components/costes/formato";

const fmtEntero = new Intl.NumberFormat("es-ES");

const TITULO: Record<ModoMonitor, string> = {
  chat: "IA este mes",
  ocr: "Lectura de facturas este mes",
};

/**
 * Monitor compacto de lo gastado en IA en Facturas (últimos 30 días, en €).
 * Una sola línea de 44 px (táctil); el desglose por proceso se abre en un
 * desplegable flotante, así que no añade alto a la página (regla del dueño:
 * sin scroll vertical de página).
 *
 *   modo="chat"  → «IA este mes: 0,21 € · 187 preguntas · 0,001 € por pregunta»
 *   modo="ocr"   → «Lectura de facturas este mes: X € · N documentos · Y € por documento»
 *                  (OCR + clasificación de productos)
 */
export function MonitorGastoIA({ modo, className = "" }: { modo: ModoMonitor; className?: string }) {
  const { data, isLoading } = useGastoIa();
  const r = resumirGastoIa(data ?? [], modo);
  const singular = modo === "chat" ? "pregunta" : "documento";

  const resumen = isLoading
    ? "cargando…"
    : r.eur === null
      ? "sin datos todavía"
      : [
          fmtEurIa(r.eur),
          `${fmtEntero.format(r.unidades)} ${r.unidadTexto}`,
          ...(r.porUnidadEur !== null ? [`${fmtEurIa(r.porUnidadEur)} por ${singular}`] : []),
        ].join(" · ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`monitor-gasto-ia-${modo}`}
          className={`flex min-h-11 w-full items-center gap-2 rounded-md border border-border/50 bg-card px-3 text-left text-xs sm:text-sm text-muted-foreground shadow-sm transition-colors hover:bg-muted/40 hover:text-foreground ${className}`}
          aria-label={`${TITULO[modo]}: ${resumen}. Ver desglose por proceso`}
        >
          <Coins className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-foreground">{TITULO[modo]}:</span>{" "}
            <span className="tabular-nums">{resumen}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3 text-sm">
        <p className="mb-2 font-medium">Gasto de IA en Facturas · últimos {DIAS_GASTO_IA} días</p>
        <ul className="space-y-1.5" aria-label="Desglose por proceso">
          {r.desglose.map((l) => (
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
          <span className="tabular-nums">{r.totalFacturasEur === null ? "sin datos todavía" : fmtEurIa(r.totalFacturasEur)}</span>
        </div>
        {r.filasSinTarifa > 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            {r.filasSinTarifa} {r.filasSinTarifa === 1 ? "registro usa" : "registros usan"} un modelo sin tarifa: no se
            suma.
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Coste aproximado: tokens × tarifa de OpenAI. {TEXTO_TIPO_CAMBIO}.
        </p>
      </PopoverContent>
    </Popover>
  );
}
