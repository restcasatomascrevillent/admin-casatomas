import { AlertTriangle, Truck } from "lucide-react";
import { formatCurrency, formatDateCorta } from "@/components/facturas/shared/formatters";
import type { Proveedor } from "@/lib/facturas/proveedores";

/** Compras › Proveedores: una fila por proveedor canónico (cada uno una sola vez). */
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
    <ul className="divide-y" aria-label="Proveedores" data-testid="lista-proveedores-compras">
      {proveedores.map((p) => {
        const sinFactura = sinFacturaPorClave.get(`#${p.id}`) ?? 0;
        const abierto = seleccionadoId === p.id;
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onAbrir(p.id)}
              aria-current={abierto ? "true" : undefined}
              className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40 ${abierto ? "bg-muted/70" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{p.nombre}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {p.cif ? `CIF ${p.cif} · ` : ""}
                  {p.documentos} documento(s)
                  {p.ultima_fecha ? ` · último ${formatDateCorta(p.ultima_fecha)}` : ""}
                </span>
                {sinFactura > 0 && (
                  <span className="mt-0.5 inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 text-[11px] leading-5 text-amber-800">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {sinFactura}{" "}
                    {sinFactura === 1 ? "albarán sin factura" : "albaranes sin factura"}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(p.total_facturas + p.total_albaranes)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
