import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type FilaCoste, type ResumenCostes, formatearCantidad, formatearEur } from "@/lib/servicios";
import { formatearCambio } from "./TipoCambio";

/** «cuota 17,88 € + uso 1,20 €», con el importe original si no es en euros; «metido a mano» si lo hay. */
function detalleFila(f: FilaCoste): string {
  if (f.manualEur != null) return "metido a mano (factura de este mes)";
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
  /**
   * De pago por uso sin lectura automática (Google Maps…): su gasto del mes se
   * mete a mano (13/11/2026). Con `onMeterCoste` sale el botón.
   */
  sinLectura?: Array<{ proveedor: string; nombre: string }>;
  /** «noviembre». */
  textoMesCorto?: string;
  /** Meter (o cambiar) lo gastado este mes por un servicio. */
  onMeterCoste?: (proveedor: string) => void;
}

/**
 * Costes › coste de este mes por proveedor: barras horizontales (una sola
 * serie, € al mes) con la cifra escrita y de qué sale (cuota y uso), el total
 * y, aparte, lo que es gratis o no tiene precio apuntado.
 */
export function DesgloseCostes({ resumen, eurPorUsd, costesDisponibles, sinLectura = [], textoMesCorto = "este mes", onMeterCoste }: Props) {
  const conGasto = resumen.filas.filter((f) => f.totalEur > 0 || f.manualEur != null);
  const manuales = new Set(resumen.filas.filter((f) => f.manualEur != null).map((f) => f.proveedor));
  const porMeter = onMeterCoste ? sinLectura.filter((s) => !manuales.has(s.proveedor)) : [];
  const enPorMeter = new Set(porMeter.map((s) => s.proveedor));
  const sinGasto = resumen.filas.filter((f) => f.totalEur <= 0 && f.manualEur == null && !enPorMeter.has(f.proveedor));
  // `|| 1`: con todo a 0 € (p. ej. una factura de 0 metida a mano) la barra no puede dividir por 0.
  const max = Math.max(...conGasto.map((f) => f.totalEur), 0) || 1;
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
                {(detalle || (f.manualEur != null && onMeterCoste)) && (
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                    {detalle && <p className="break-words text-xs text-muted-foreground">{detalle}</p>}
                    {f.manualEur != null && onMeterCoste && (
                      <Button type="button" variant="ghost" size="sm" className="h-9 gap-1 px-2 text-xs" onClick={() => onMeterCoste(f.proveedor)}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Cambiar
                        <span className="sr-only"> lo gastado este mes en {f.nombre}</span>
                      </Button>
                    )}
                  </div>
                )}
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
          {formatearEur(resumen.fijoMesEur)} de cuotas + {formatearEur(resumen.variableMesEur)} por uso
          {resumen.manualMesEur > 0 ? ` + ${formatearEur(resumen.manualMesEur)} metido a mano` : ""}, hasta hoy.
        </p>
      </div>
      {porMeter.length > 0 && (
        <div className="min-w-0 rounded-md border border-dashed p-3" data-testid="desglose-sin-lectura">
          <p className="text-sm font-medium text-foreground">Sin lectura automática</p>
          <p className="text-xs text-muted-foreground">No tienen forma de leer su gasto: mete lo que diga su factura o su panel de facturación.</p>
          <ul className="mt-2 flex min-w-0 flex-wrap gap-2" aria-label="Servicios sin lectura automática">
            {porMeter.map((s) => (
              <li key={s.proveedor} data-sin-lectura={s.proveedor}>
                <Button type="button" variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => onMeterCoste?.(s.proveedor)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {s.nombre}: meter el gasto de {textoMesCorto}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
