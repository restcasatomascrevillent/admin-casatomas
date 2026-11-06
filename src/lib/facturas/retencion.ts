// ============================================================================
//  Facturas · retención de IRPF (migración 20261106300000, 06/11/2026)
// ----------------------------------------------------------------------------
//  `facturas.total` es lo que se paga al proveedor: base + IVA − retención.
//  La retención (alquileres, gestoría, profesionales) se ingresa a Hacienda,
//  así que el coste real del documento es total + retención.
// ============================================================================
import { formatImporte } from "@/components/facturas/shared/formatters";

/** «Retención IRPF (−19 %)»; sin porcentaje conocido, «Retención IRPF». */
export function etiquetaRetencion(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return "Retención IRPF";
  return `Retención IRPF (−${pct.toLocaleString("es-ES", { maximumFractionDigits: 2 })} %)`;
}

/**
 * Nota bajo «Gasto con IVA» en Análisis: «incluye −142,50 € de IRPF retenido;
 * coste real 1.049,50 €». null si el periodo no tiene retención.
 */
export function notaRetencionGasto(gasto: number, retencion: number | null | undefined): string | null {
  if (retencion == null || !Number.isFinite(retencion) || Math.abs(retencion) < 0.005) return null;
  return `incluye ${formatImporte(-retencion)} de IRPF retenido; coste real ${formatImporte(gasto + retencion)}`;
}
