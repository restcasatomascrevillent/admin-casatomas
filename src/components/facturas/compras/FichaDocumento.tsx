import { Link2, Package, Pencil, Sparkles, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AlertaValidacion, Factura } from "@/hooks/useFacturas";
import { formatCurrency, formatDate, formatDateTime } from "@/components/facturas/shared/formatters";
import { BotonOriginal } from "@/components/facturas/shared/BotonOriginal";
import { EstadoDocumento } from "@/components/facturas/shared/EstadoDocumento";
import { FilaProducto } from "@/components/facturas/shared/FilaProducto";
import { esAlbaranSinFactura } from "@/lib/facturas/compras";

const dato = (etiqueta: string, valor: string | null) =>
  valor ? (
    <div className="flex justify-between gap-3 border-b border-border/30 py-1.5 text-sm">
      <span className="text-muted-foreground">{etiqueta}</span>
      <span className="text-right font-medium tabular-nums">{valor}</span>
    </div>
  ) : null;

/**
 * Compras › Documentos › ficha: la cabecera del documento, sus botones de
 * siempre (original, editar, IA), el estado de revisión y todas sus líneas.
 * Cada línea con producto asignado enlaza con la ficha de ese producto.
 */
export function FichaDocumento({
  doc,
  avisos,
  mismoTipo,
  facturaDelAlbaran,
  albaranesDeLaFactura,
  onEditar,
  onPreguntarIA,
  onAbrirProducto,
  onAbrirProveedor,
  onAbrirDocumento,
}: {
  doc: Factura;
  avisos: AlertaValidacion[];
  /** Documentos del mismo tipo (para detectar precios anómalos en las líneas). */
  mismoTipo: Factura[];
  /** Si es un albarán ya facturado: la factura que lo recoge (si está cargada). */
  facturaDelAlbaran: Factura | null;
  /** Si es una factura: los albaranes que recoge. */
  albaranesDeLaFactura: Factura[];
  onEditar: (doc: Factura) => void;
  onPreguntarIA?: (doc: Factura) => void;
  onAbrirProducto: (productoId: number) => void;
  onAbrirProveedor: (nombre: string) => void;
  onAbrirDocumento: (id: number) => void;
}) {
  const esAlbaran = doc.tipo === "albaran";
  return (
    <div className="space-y-4 p-3 sm:p-4">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{esAlbaran ? "Albarán" : "Factura"}</p>
        <h2 className="break-words text-lg font-semibold leading-tight">{doc.numero_documento}</h2>
        {doc.proveedor ? (
          <button
            type="button"
            onClick={() => onAbrirProveedor(doc.proveedor as string)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-left text-sm text-primary underline-offset-2 hover:underline"
            title="Ver la ficha del proveedor"
          >
            <Truck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="break-words">{doc.proveedor}</span>
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">Sin proveedor</p>
        )}
        <p className="text-sm text-muted-foreground">{formatDate(doc.fecha)}</p>
      </header>

      <div className="flex flex-wrap items-start gap-2">
        <EstadoDocumento alertas={avisos} verificada={doc.verificada} onRevisar={() => onEditar(doc)} compacto={false} />
        {esAlbaran &&
          (esAlbaranSinFactura(doc) ? (
            <span className="inline-flex h-7 items-center rounded-md border border-amber-300 bg-amber-50 px-2 text-xs font-medium text-amber-800">
              Sin factura todavía
            </span>
          ) : (
            <span className="inline-flex h-7 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-medium text-emerald-700">
              Ya facturado
            </span>
          ))}
      </div>

      {/* Los tres botones de siempre, con el tamaño de un dedo. */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <BotonOriginal driveUrl={doc.drive_url} archivoPath={doc.archivo_path} variant="mobile" label={esAlbaran ? "Ver albarán" : "Ver original"} />
        <Button variant="outline" className="h-11 gap-1.5" onClick={() => onEditar(doc)}>
          <Pencil className="h-4 w-4" aria-hidden="true" /> Editar
        </Button>
        {onPreguntarIA && (
          <Button
            variant="outline"
            className="col-span-2 h-11 gap-1.5 border-[hsl(38,59%,45%)/0.3] text-[hsl(38,59%,45%)] hover:bg-[hsl(38,59%,45%)/0.1] hover:text-[hsl(38,59%,45%)] sm:col-span-1"
            onClick={() => onPreguntarIA(doc)}
            title={esAlbaran ? "Analizar este albarán con la IA" : "Analizar esta factura con la IA"}
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Preguntar a la IA
          </Button>
        )}
      </div>

      {esAlbaran && facturaDelAlbaran && (
        <button
          type="button"
          onClick={() => onAbrirDocumento(facturaDelAlbaran.id)}
          className="flex min-h-11 w-full items-center gap-2 rounded-md border px-3 text-left text-sm hover:bg-muted/40"
        >
          <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Recogido en la factura {facturaDelAlbaran.numero_documento}</span>
        </button>
      )}
      {!esAlbaran && albaranesDeLaFactura.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recoge {albaranesDeLaFactura.length} {albaranesDeLaFactura.length === 1 ? "albarán" : "albaranes"}
          </p>
          {albaranesDeLaFactura.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onAbrirDocumento(a.id)}
              className="flex min-h-11 w-full items-center gap-2 rounded-md border px-3 text-left text-sm hover:bg-muted/40"
            >
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">Albarán {a.numero_documento}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDate(a.fecha)}</span>
            </button>
          ))}
        </div>
      )}

      <section aria-label="Importes y datos">
        {dato("CIF", doc.cif)}
        {dato("Base imponible", doc.subtotal != null ? formatCurrency(doc.subtotal) : null)}
        {dato("IVA", doc.iva != null ? formatCurrency(doc.iva) : null)}
        {doc.total != null && (
          <div className="flex justify-between gap-3 border-b border-border/30 py-1.5 text-sm">
            <span className="font-semibold">Total{doc.total_origen === "deducido" ? " (calculado, no leído)" : ""}</span>
            <span className="font-bold tabular-nums">{formatCurrency(doc.total)}</span>
          </div>
        )}
        {dato("Procesado", doc.procesado_en ? formatDateTime(doc.procesado_en) : null)}
        {dato("Creado", doc.created_at ? formatDateTime(doc.created_at) : null)}
        {doc.observaciones && (
          <div className="py-2">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">Observaciones</span>
            <p className="rounded-md border border-border/50 bg-muted/30 p-2 text-sm">{doc.observaciones}</p>
          </div>
        )}
      </section>

      <section aria-label="Líneas del documento" className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Package className="h-3.5 w-3.5" aria-hidden="true" /> Líneas ({doc.productos.length})
        </h3>
        {doc.productos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este documento no tiene líneas.</p>
        ) : (
          <div className="space-y-1.5">
            {doc.productos.map((p) => (
              <FilaProducto key={p.id} p={p} isMobile allDocs={mismoTipo} onAbrirProducto={onAbrirProducto} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
