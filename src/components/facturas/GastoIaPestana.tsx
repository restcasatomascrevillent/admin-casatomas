import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGastoIa, useGastoIaReal } from "@/hooks/useGastoIa";
import { fmtEurIa, resumirGastoIa, resumirGastoReal } from "@/lib/facturas/gastoIa";
import { DesgloseGastoIa } from "./MonitorGastoIA";

/**
 * Lo gastado en IA en Facturas, como un texto pequeño junto a la pestaña «IA»
 * («0,22 € este mes»). Al tocarlo se abre el desglose por proceso. Los datos y
 * las cuentas son los del monitor de siempre (`useGastoIa` + `resumirGastoIa`);
 * solo cambia dónde se coloca: ya no ocupa una línea fija encima del chat.
 */
export function GastoIaPestana({ className = "" }: { className?: string }) {
  const { data, isLoading } = useGastoIa();
  const { data: dataReal, isLoading: cargandoReal } = useGastoIaReal();
  const r = resumirGastoIa(data ?? [], "chat");
  const real = dataReal ? resumirGastoReal(dataReal, "chat") : null;
  // Real (OpenAI) + estimado de hoy; sin datos reales, el estimado de `ia_uso`.
  const corto =
    isLoading || cargandoReal
      ? "cargando…"
      : real
        ? `${fmtEurIa(real.totalEur)} este mes`
        : r.totalFacturasEur === null
          ? "sin datos"
          : `${fmtEurIa(r.totalFacturasEur)} este mes (est.)`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="gasto-ia-pestana"
          aria-label={`Gasto de IA este mes${real ? " (real, sin IVA)" : " (estimado)"}: ${corto}. Ver desglose por proceso`}
          className={`flex min-h-11 shrink-0 items-center rounded-md px-1.5 text-[11px] leading-tight text-muted-foreground tabular-nums underline-offset-2 transition-colors hover:text-foreground hover:underline sm:text-xs ${className}`}
        >
          <span className="max-w-[5.5rem] truncate sm:max-w-none">{corto}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-3 text-sm">
        <DesgloseGastoIa r={r} real={real} />
      </PopoverContent>
    </Popover>
  );
}
