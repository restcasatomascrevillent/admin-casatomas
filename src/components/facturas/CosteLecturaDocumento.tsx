import { useCosteLecturaFactura } from "@/hooks/useEstadisticasLectura";
import { fmtCentimos } from "@/lib/facturas/costeLectura";
import { USD_EUR } from "@/components/costes/formato";
import { cn } from "@/lib/utils";

const fmtUsd = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/**
 * Lo que costó LEER un documento con IA, en texto pequeño gris: «lectura 0,4 cént.»
 * (céntimos de euro; el detalle exacto en USD, llamadas y modelo, en el tooltip).
 * No pinta nada si no hay dato. Presentacional: lo usan las filas de «Cargar»
 * y puede usarlo la ficha del documento (`<CosteLecturaFactura facturaId />`
 * lo busca solo).
 */
export function CosteLecturaDocumento({
  costeUsd,
  llamadas,
  modelo,
  eurPorUsd = USD_EUR,
  className,
}: {
  costeUsd: number | null | undefined;
  llamadas?: number | null;
  modelo?: string | null;
  eurPorUsd?: number;
  className?: string;
}) {
  if (costeUsd === null || costeUsd === undefined || !Number.isFinite(costeUsd)) return null;
  const detalle = [
    `Coste de leer este documento con IA: ${fmtUsd.format(costeUsd)} $`,
    ...(llamadas ? [`${llamadas} ${llamadas === 1 ? "llamada" : "llamadas"}`] : []),
    ...(modelo ? [modelo] : []),
  ].join(" · ");
  return (
    <span data-testid="coste-lectura" title={detalle} className={cn("whitespace-nowrap text-xs tabular-nums text-muted-foreground", className)}>
      lectura {fmtCentimos(costeUsd, eurPorUsd)}
    </span>
  );
}

/** Como `CosteLecturaDocumento`, pero busca el coste de la factura `facturaId` en la base de datos. */
export function CosteLecturaFactura({ facturaId, className }: { facturaId: number | null | undefined; className?: string }) {
  const { data } = useCosteLecturaFactura(facturaId);
  if (!data) return null;
  return <CosteLecturaDocumento costeUsd={data.costeUsd} llamadas={data.llamadas} modelo={data.modelo} className={className} />;
}
