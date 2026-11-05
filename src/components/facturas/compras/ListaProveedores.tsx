import type { ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Truck } from "lucide-react";
import { formatDateCorta, formatImporte, plural } from "@/components/facturas/shared/formatters";
import type { Proveedor } from "@/lib/facturas/proveedores";
import type { AgregadoProveedor } from "@/lib/facturas/resumenCompras";

/**
 * Compras › Proveedores (rediseño del 05/11/2026): lista a todo el ancho, una
 * fila por proveedor canónico, ordenada por GASTO con IVA (sin albaranes ya
 * facturados, abonos restando: el criterio de la RPC corregida 20261105130000),
 * con el local y el periodo elegidos. Al tocar un proveedor se DESPLIEGA ahí
 * mismo (acordeón: uno abierto a la vez) con `despliegue`; otro toque lo pliega.
 */
export function ListaProveedores({
  proveedores,
  agregados,
  abiertoId,
  cargando,
  mensaje,
  hayFiltros,
  onAlternar,
  despliegue,
}: {
  /** Ya filtrados y ordenados. */
  proveedores: Proveedor[];
  /** Lo de cada proveedor (clave `#id`) con el local y el periodo elegidos. */
  agregados: Map<string, AgregadoProveedor>;
  abiertoId: number | null;
  cargando: boolean;
  /** Mensaje de la lista (p. ej. «falta la migración»); sustituye a la lista. */
  mensaje: string | null;
  hayFiltros: boolean;
  onAlternar: (id: number) => void;
  /** El contenido del proveedor desplegado. */
  despliegue: (p: Proveedor) => ReactNode;
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
        const a = agregados.get(`#${p.id}`);
        const abierto = abiertoId === p.id;
        const Chevron = abierto ? ChevronDown : ChevronRight;
        const docs = a?.documentos.length ?? 0;
        const ultima = a?.ultimaFecha ?? (hayFiltros ? null : p.ultima_fecha);
        const sinFactura = a?.albaranesSinFactura ?? 0;
        return (
          <li key={p.id} data-proveedor-id={p.id}>
            <h3 className={`m-0 text-base font-normal ${abierto ? "sticky top-0 z-10 bg-card" : ""}`}>
              <button
                type="button"
                onClick={() => onAlternar(p.id)}
                aria-expanded={abierto}
                className={`flex min-h-12 w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${abierto ? "bg-muted/60" : ""}`}
              >
                <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.nombre}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="whitespace-nowrap">
                      {plural(docs, "documento", "documentos")}
                      {ultima ? ` · último ${formatDateCorta(ultima)}` : ""}
                    </span>
                    {sinFactura > 0 && (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {plural(sinFactura, "albarán sin factura", "albaranes sin factura")}
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-right leading-tight">
                  <span className="text-sm font-semibold tabular-nums">{formatImporte(a?.gasto ?? 0)}</span>
                  <span className="block text-xs text-muted-foreground">
                    <span className="sr-only"> </span>con IVA
                  </span>
                </span>
              </button>
            </h3>
            {abierto && despliegue(p)}
          </li>
        );
      })}
    </ul>
  );
}
