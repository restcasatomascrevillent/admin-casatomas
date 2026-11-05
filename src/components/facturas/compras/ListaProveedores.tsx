import { AlertTriangle, Truck } from "lucide-react";
import { formatCurrency, formatDateCorta, plural } from "@/components/facturas/shared/formatters";
import type { Proveedor } from "@/lib/facturas/proveedores";

/**
 * Compras › Proveedores: una fila por proveedor canónico (cada uno una sola vez).
 * Total = facturas + albaranes SIN factura, con IVA (el albarán ya recogido en
 * una factura no cuenta dos veces: migración 20261105130000).
 */
export function ListaProveedores({
  proveedores,
  sinFacturaPorClave,
  seleccionadoId,
  cargando,
  mensaje,
  hayFiltros,
  onAbrir,
}: {
  proveedores: Proveedor[];
  /** Albaranes sin factura de cada proveedor, por clave `#id`. */
  sinFacturaPorClave: Map<string, number>;
  seleccionadoId: number | null;
  cargando: boolean;
  /** Mensaje de la lista (p. ej. «falta la migración»); sustituye a la lista. */
  mensaje: string | null;
  hayFiltros: boolean;
  onAbrir: (id: number) => void;
}) {
  if (cargando) return <p className="p-4 text-sm text-muted-foreground">Cargando proveedores…</p>;
  if (mensaje) return <p className="p-4 text-sm text-muted-foreground">{mensaje}</p>;
  if (proveedores.length === 0) {
    return (
      <div className="p-6 text-center">
        <Truck className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">{hayFiltros ? "Ningún proveedor coincide" : "No hay proveedores todavía"}</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border/50" aria-label="Proveedores" data-testid="lista-proveedores-compras">
      {proveedores.map((p) => {
        const sinFactura = sinFacturaPorClave.get(`#${p.id}`) ?? 0;
        const abierto = seleccionadoId === p.id;
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onAbrir(p.id)}
              aria-current={abierto ? "true" : undefined}
              className={`flex min-h-12 w-full items-center gap-3 px-2 py-1.5 text-left transition-colors hover:bg-muted/40 ${abierto ? "bg-muted/70" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{p.nombre}</span>
                <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate" title={p.ultima_fecha ? `Último documento: ${formatDateCorta(p.ultima_fecha)}` : undefined}>
                    {plural(p.documentos, "doc", "docs")}
                    {p.ultima_fecha ? ` · ${formatDateCorta(p.ultima_fecha)}` : ""}
                  </span>
                  {sinFactura > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {plural(sinFactura, "albarán sin factura", "albaranes sin factura")}
                    </span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-right leading-tight">
                <span className="text-sm font-semibold tabular-nums">{formatCurrency(p.total_facturas + p.total_albaranes)}</span>
                <span className="block text-[11px] pointer-coarse:text-xs text-muted-foreground">
                  <span className="sr-only"> </span>con IVA
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
