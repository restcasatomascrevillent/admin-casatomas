import { type FilaCoste, type ResumenCostes, formatearCantidad, formatearEur } from "@/lib/servicios";
import { formatearCambio } from "./TipoCambio";

/** «cuota 17,88 € + uso 1,20 €», con el importe original si no es en euros. */
function detalleFila(f: FilaCoste): string {
  const partes: string[] = [];
  if (f.fijo && f.fijo.importe > 0) {
    const original = f.fijo.moneda.toUpperCase() === "EUR" ? "" : ` (${formatearCantidad(f.fijo.importe, f.fijo.moneda)})`;
    partes.push(`cuota ${formatearEur(f.fijoEur ?? 0)}${original}`);
  }
  if (f.variable && f.variable.importe > 0) {
    const original = f.variable.moneda.toUpperCase() === "EUR" ? "" : ` (${formatearCantidad(f.variable.importe, f.variable.moneda)})`;
    partes.push(`uso ${formatearEur(f.variableEur)}${original}`);
  }
  return partes.join(" + ");
}

interface Props {
  resumen: ResumenCostes;
  eurPorUsd: number;
  /** false si falta 20261103160000: sin coste variable ni proveedores nuevos. */
  costesDisponibles: boolean;
}

/**
 * Costes › coste de este mes por proveedor: barras horizontales (una sola
 * serie, € al mes) con la cifra escrita y de qué sale (cuota y uso), el total
 * y, aparte, lo que es gratis o no tiene precio apuntado.
 */
export function DesgloseCostes({ resumen, eurPorUsd, costesDisponibles }: Props) {
  const conGasto = resumen.filas.filter((f) => f.totalEur > 0);
  const sinGasto = resumen.filas.filter((f) => f.totalEur <= 0);
  const max = Math.max(...conGasto.map((f) => f.totalEur), 0);
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="desglose-costes">
      {conGasto.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este mes no hay ningún gasto medido: todo lo que se usa está en planes gratis o sin consumo.</p>
      ) : (
        <ul className="min-w-0 space-y-3" aria-label="Coste de este mes por proveedor">
          {conGasto.map((f) => {
            const detalle = detalleFila(f);
            return (
              <li key={f.proveedor} className="min-w-0 space-y-1" data-coste={f.proveedor}>
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 break-words text-sm font-medium text-foreground">
                    {f.nombre}
                    {f.porConfirmar && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(por confirmar)</span>}
                  </span>
                  <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">{formatearEur(f.totalEur)}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true" title={`${f.nombre}: ${formatearEur(f.totalEur)}`}>
                  <div className="h-full rounded-full bg-sky-700 dark:bg-sky-400" style={{ width: `${Math.max(2, (f.totalEur / max) * 100)}%` }} />
                </div>
                {detalle && <p className="break-words text-xs text-muted-foreground">{detalle}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex min-w-0 flex-col gap-0.5 border-t pt-3" data-testid="desglose-total">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-foreground">Total este mes</span>
          <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">{formatearEur(resumen.totalMesEur)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {formatearEur(resumen.fijoMesEur)} de cuotas + {formatearEur(resumen.variableMesEur)} por uso, hasta hoy.
        </p>
      </div>
      {sinGasto.length > 0 && (
        <p className="break-words text-xs text-muted-foreground">
          <span className="font-medium">Gratis o sin gasto este mes:</span> {sinGasto.map((f) => f.nombre).join(", ")}.
        </p>
      )}
      {(resumen.sinPrecio.length > 0 || resumen.porConfirmar.length > 0) && (
        <p className="break-words text-xs text-muted-foreground">
          {resumen.sinPrecio.length > 0 && <>El total no incluye lo que no tiene precio apuntado: {resumen.sinPrecio.join(", ")}. </>}
          {resumen.porConfirmar.length > 0 && <>Plan o precio por confirmar: {resumen.porConfirmar.join(", ")}.</>}
        </p>
      )}
      {resumen.hayUsd && (
        <p className="text-xs text-muted-foreground">
          Lo que se paga en dólares va en euros a 1 US$ = {formatearCambio(eurPorUsd)} € (se cambia en «Configurar»).
        </p>
      )}
      {!costesDisponibles && (
        <p className="break-words text-xs text-amber-900 dark:text-amber-200">
          Falta aplicar en Supabase la migración 20261103160000_servicios_planes_costes: hasta entonces no se ven el gasto por uso ni los proveedores nuevos.
        </p>
      )}
    </div>
  );
}
