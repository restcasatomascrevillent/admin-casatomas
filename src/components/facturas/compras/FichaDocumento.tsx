import { useState } from "react";
import { Package, Pencil, Sparkles, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AlertaValidacion, Factura } from "@/hooks/useFacturas";
import { formatCurrency, formatDate, formatDateTime } from "@/components/facturas/shared/formatters";
import { BotonOriginal } from "@/components/facturas/shared/BotonOriginal";
import { OriginalIncrustado } from "@/components/facturas/shared/OriginalIncrustado";
import { EstadoDocumento } from "@/components/facturas/shared/EstadoDocumento";
import { FilaProducto } from "@/components/facturas/shared/FilaProducto";
import { esAlbaranSinFactura } from "@/lib/facturas/compras";
import { AlbaranesDeFactura } from "./AlbaranesDeFactura";
import { FacturaDelAlbaran } from "./FacturaDelAlbaran";

/** Observaciones: dos líneas como mucho; el resto, tras «ver más». */
function Observaciones({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false);
  const largo = texto.length > 120 || texto.includes("\n");
  return (
    <p className={`text-xs text-muted-foreground ${abierto ? "whitespace-pre-line" : "line-clamp-2"}`}>
      <span className="font-medium uppercase tracking-wider">Observaciones </span>
      {texto}
      {largo && (
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          className="relative ml-1 font-medium text-primary underline-offset-2 before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[''] hover:underline"
        >
          {abierto ? "ver menos" : "ver más"}
        </button>
      )}
    </p>
  );
}

const SEP = (
  <span aria-hidden="true" className="text-muted-foreground">
    ·
  </span>
);

/**
 * Compras › Documentos › ficha: cabecera en dos líneas (tipo + número + estado,
 * y debajo proveedor · fecha · CIF) con las tres acciones de siempre arriba a
 * la derecha, los importes en una fila y las líneas lo antes posible.
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
  const hayImportes = doc.subtotal != null || doc.iva != null || doc.total != null;
  return (
    <div className="space-y-3 p-3 sm:p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="break-words text-lg font-semibold leading-tight">
              {esAlbaran ? "Albarán" : "Factura"} {doc.numero_documento}
            </h2>
            <EstadoDocumento alertas={avisos} verificada={doc.verificada} onRevisar={() => onEditar(doc)} compacto={false} />
            {esAlbaran &&
              (esAlbaranSinFactura(doc) ? (
                <span className="inline-flex h-7 items-center rounded-md border border-amber-300 bg-amber-50 px-2 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  Sin factura todavía
                </span>
              ) : (
                <span className="inline-flex h-7 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Ya facturado
                </span>
              ))}
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            {doc.proveedor ? (
              <button
                type="button"
                onClick={() => onAbrirProveedor(doc.proveedor as string)}
                className="relative inline-flex items-center gap-1 rounded-sm text-left underline-offset-2 before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[''] hover:text-primary hover:underline"
                title="Ver la ficha del proveedor"
              >
                <Truck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="break-words">
                  {doc.proveedor}
                  <span aria-hidden="true" className="no-underline"> ·</span>
                </span>
              </button>
            ) : (
              <span className="whitespace-nowrap">Sin proveedor ·</span>
            )}
            {/* El separador va pegado al FINAL de cada dato (nunca al principio): si la línea se parte, no empieza por «·». */}
            <span className="whitespace-nowrap">
              {formatDate(doc.fecha)}
              {doc.cif && <span aria-hidden="true"> ·</span>}
            </span>
            {doc.cif && <span className="whitespace-nowrap">CIF {doc.cif}</span>}
          </p>
        </div>

        {/* Acciones compactas: icono + palabra corta; en estrecho, solo icono con su nombre accesible. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <BotonOriginal
            driveUrl={doc.drive_url}
            archivoPath={doc.archivo_path}
            variant="ficha"
            label={esAlbaran ? "Ver albarán" : "Ver original"}
          />
          <Button
            variant="ghost"
            className="h-11 min-w-11 shrink-0 gap-1.5 px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onEditar(doc)}
            aria-label="Editar"
            title={esAlbaran ? "Editar este albarán" : "Editar esta factura"}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            <span className="hidden xl:inline">Editar</span>
          </Button>
          {onPreguntarIA && (
            <Button
              variant="ghost"
              className="h-11 min-w-11 shrink-0 gap-1.5 px-2.5 text-sm font-medium text-[hsl(38,59%,45%)] hover:bg-[hsl(38,59%,45%)/0.1] hover:text-[hsl(38,59%,45%)]"
              onClick={() => onPreguntarIA(doc)}
              aria-label="Preguntar a la IA"
              title={esAlbaran ? "Analizar este albarán con la IA" : "Analizar esta factura con la IA"}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <span className="hidden xl:inline">IA</span>
            </Button>
          )}
        </div>
      </header>

      {/* Importes en una sola fila. */}
      {hayImportes && (
        <p aria-label="Importes" className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm tabular-nums">
          {doc.subtotal != null && (
            <span>
              <span className="text-muted-foreground">Base</span> {formatCurrency(doc.subtotal)}
            </span>
          )}
          {doc.iva != null && (
            <>
              {doc.subtotal != null && SEP}
              <span>
                <span className="text-muted-foreground">IVA</span> {formatCurrency(doc.iva)}
              </span>
            </>
          )}
          {doc.total != null && (
            <>
              {(doc.subtotal != null || doc.iva != null) && SEP}
              <span className="font-bold">
                <span className="font-semibold">Total{doc.total_origen === "deducido" ? " (calculado, no leído)" : ""}</span>{" "}
                {formatCurrency(doc.total)}
              </span>
            </>
          )}
        </p>
      )}

      {/* Albarán ↔ factura: vínculo, candidatos y cotejo (migración 20261010110000). */}
      {esAlbaran ? (
        <FacturaDelAlbaran albaran={doc} factura={facturaDelAlbaran} onAbrirDocumento={onAbrirDocumento} />
      ) : (
        <AlbaranesDeFactura factura={doc} albaranesCargados={albaranesDeLaFactura} onAbrirDocumento={onAbrirDocumento} />
      )}

      {doc.observaciones && <Observaciones texto={doc.observaciones} />}

      <section aria-label="Líneas del documento" className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Package className="h-3.5 w-3.5" aria-hidden="true" /> Líneas ({doc.productos.length})
        </h3>
        {doc.productos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este documento no tiene líneas.</p>
        ) : (
          <div>
            {doc.productos.map((p) => (
              <FilaProducto key={p.id} p={p} isMobile allDocs={mismoTipo} onAbrirProducto={onAbrirProducto} />
            ))}
          </div>
        )}
      </section>

      {(doc.procesado_en || doc.created_at) && (
        <p className="text-[11px] text-muted-foreground/80">
          {doc.procesado_en && <>Procesado {formatDateTime(doc.procesado_en)}</>}
          {doc.procesado_en && doc.created_at && " · "}
          {doc.created_at && <>Creado {formatDateTime(doc.created_at)}</>}
        </p>
      )}

      {/* Al final de la ficha, dentro de su scroll: la foto (o el PDF) del original. */}
      <OriginalIncrustado
        driveUrl={doc.drive_url}
        archivoPath={doc.archivo_path}
        titulo={`${esAlbaran ? "Albarán" : "Factura"} ${doc.numero_documento}`}
      />
    </div>
  );
}
