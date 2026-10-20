import { AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtEurIa } from "@/lib/facturas/gastoIa";
import { DesgloseGastoIa, textoAvisoTope, useMonitorGastoIa } from "./MonitorGastoIA";

/**
 * Lo que cuesta el chatbot de Facturas este mes, como un texto pequeño gris en
 * la barra de pestañas, a la derecha («0,22 € este mes»; en pantallas estrechas, solo el importe). Al tocarlo se abre el desglose. Solo el
 * chatbot: el resto del gasto de IA está en Super Admin › Costes. Si el mes
 * se acerca o supera el tope de gasto de IA, el texto se tiñe de ámbar o rojo.
 */
export function GastoIaPestana({ className = "" }: { className?: string }) {
  const { r, real, cargando, topeEur, estadoTope } = useMonitorGastoIa("chat");
  // Real (OpenAI) + estimado de hoy; sin datos reales, el estimado de `ia_uso`.
  // `importe` es lo que siempre se ve; `sufijo`, solo si hay sitio (≥ sm).
  const importe = cargando
    ? "cargando…"
    : real
      ? fmtEurIa(real.procesoEur)
      : r.eur === null
        ? "sin datos"
        : fmtEurIa(r.eur);
  const sufijo = cargando || (!real && r.eur === null) ? "" : real ? " este mes" : " este mes (est.)";
  const corto = `${importe}${sufijo}`;
  const avisoTexto = textoAvisoTope(estadoTope, topeEur);
  const color =
    estadoTope.nivel === "superado"
      ? "font-medium text-destructive"
      : estadoTope.nivel === "aviso"
        ? "font-medium text-amber-700 dark:text-amber-400"
        : "text-muted-foreground hover:text-foreground";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          data-tour="facturas-gasto-ia"
          type="button"
          data-testid="gasto-ia-pestana"
          data-nivel-tope={estadoTope.nivel}
          aria-label={`Gasto del chatbot este mes${real ? " (real, sin IVA)" : " (estimado)"}: ${corto}.${avisoTexto ? ` ${avisoTexto}` : ""} Ver desglose`}
          className={`flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] leading-tight tabular-nums underline-offset-2 transition-colors hover:underline sm:text-xs ${color} ${className}`}
        >
          {estadoTope.nivel !== "ok" && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span className="whitespace-nowrap">
            {importe}
            {sufijo && <span className="hidden sm:inline">{sufijo}</span>}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-3 text-sm">
        <DesgloseGastoIa r={r} real={real} modo="chat" estadoTope={estadoTope} topeEur={topeEur} />
      </PopoverContent>
    </Popover>
  );
}
