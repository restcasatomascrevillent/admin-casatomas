import { AlertTriangle, EyeOff, FileText } from "lucide-react";
import type { Factura } from "@/hooks/useFacturas";
import { formatCurrency, formatDateCorta } from "@/components/facturas/shared/formatters";
import { esAlbaranSinFactura } from "@/lib/facturas/compras";

const ETIQUETA_TIPO: Record<string, string> = { factura: "Factura", albaran: "Albarán" };

/**
 * Compras › Documentos: lista compacta (una fila por factura o albarán). Lo
 * que antes eran dos tablas con sus columnas ahora es una sola lista corta;
 * todo el detalle, las líneas y los botones están en la ficha de la derecha.
 */
export function ListaDocumentos({
  documentos,
  avisosPorId,
  seleccionadoId,
  cargando,
  hayFiltros,
  onAbrir,
}: {
  documentos: Factura[];
  avisosPorId: Map<number, unknown[]>;
  seleccionadoId: number | null;
  cargando: boolean;
  hayFiltros: boolean;
  onAbrir: (id: number) => void;
}) {
  if (cargando) return <p className="p-4 text-sm text-muted-foreground">Cargando documentos…</p>;
  if (documentos.length === 0) {
    return (
      <div className="p-6 text-center">
        <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">
          {hayFiltros ? "Ningún documento coincide" : "No hay documentos registrados"}
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y" aria-label="Documentos">
      {documentos.map((d) => {
        const avisos = (avisosPorId.get(d.id) ?? []).length;
        const abierto = seleccionadoId === d.id;
        return (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onAbrir(d.id)}
              aria-current={abierto ? "true" : undefined}
              className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40 ${abierto ? "bg-muted/70" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{d.numero_documento}</span>
                  <span className="shrink-0 rounded border border-border/60 bg-muted/50 px-1.5 text-[11px] leading-5 text-muted-foreground">
                    {ETIQUETA_TIPO[d.tipo] ?? d.tipo}
                  </span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {d.proveedor || "Sin proveedor"} · {formatDateCorta(d.fecha)}
                  {d.productos.length > 0 && ` · ${d.productos.length} línea(s)`}
                </span>
                {(avisos > 0 || !d.verificada || esAlbaranSinFactura(d)) && (
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {esAlbaranSinFactura(d) && (
                      <span className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[11px] leading-5 text-amber-800">
                        Sin factura
                      </span>
                    )}
                    {avisos > 0 && (
                      <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 text-[11px] leading-5 text-red-700">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {avisos} {avisos === 1 ? "aviso" : "avisos"}
                      </span>
                    )}
                    {!d.verificada && (
                      <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 text-[11px] leading-5 text-slate-600">
                        <EyeOff className="h-3 w-3" aria-hidden="true" /> Sin revisar
                      </span>
                    )}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{d.total != null ? formatCurrency(d.total) : "—"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
