import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGastoIa } from "@/hooks/useGastoIa";
import { DIAS_GASTO_IA, fmtEurIa, resumirGastoIa } from "@/lib/facturas/gastoIa";
import { TEXTO_TIPO_CAMBIO } from "@/components/costes/formato";

const fmtEntero = new Intl.NumberFormat("es-ES");

/**
 * Lo gastado en IA en Facturas, como un texto pequeño junto a la pestaña «IA»
 * («0,22 € este mes»). Al tocarlo se abre el desglose por proceso. Los datos y
 * las cuentas son los del monitor de siempre (`useGastoIa` + `resumirGastoIa`);
 * solo cambia dónde se coloca: ya no ocupa una línea fija encima del chat.
 */
export function GastoIaPestana({ className = "" }: { className?: string }) {
  const { data, isLoading } = useGastoIa();
  const r = resumirGastoIa(data ?? [], "chat");
  const corto = isLoading ? "cargando…" : r.totalFacturasEur === null ? "sin datos" : `${fmtEurIa(r.totalFacturasEur)} este mes`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="gasto-ia-pestana"
          aria-label={`Gasto de IA en Facturas este mes: ${corto}. Ver desglose por proceso`}
          className={`flex min-h-11 shrink-0 items-center rounded-md px-1.5 text-[11px] leading-tight text-muted-foreground tabular-nums underline-offset-2 transition-colors hover:text-foreground hover:underline sm:text-xs ${className}`}
        >
          <span className="max-w-[5.5rem] truncate sm:max-w-none">{corto}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-3 text-sm">
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
            {r.filasSinTarifa} {r.filasSinTarifa === 1 ? "registro usa" : "registros usan"} un modelo sin tarifa: no se suma.
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Coste aproximado: tokens × tarifa de OpenAI. {TEXTO_TIPO_CAMBIO}.</p>
      </PopoverContent>
    </Popover>
  );
}
