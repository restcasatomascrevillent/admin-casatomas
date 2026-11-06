import { useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditarFacturaDialog } from "@/components/facturas/EditarFacturaDialog";
import { BotonOriginal } from "@/components/facturas/shared/BotonOriginal";
import { FilaProducto } from "@/components/facturas/shared/FilaProducto";
import { formatDate, formatImporte } from "@/components/facturas/shared/formatters";
import type { ProductoFactura } from "@/hooks/useFacturas";
import { useDocumentoCompras } from "@/hooks/useListaCompras";
import { usePuedeCorregirDocumento } from "@/hooks/usePermisosFacturas";

const LINEA_VACIA: ProductoFactura = { id: 0, producto_nombre: "", precio: 0, proveedor: null };

/**
 * «Corregir» un documento desde «Cargar» (06/11/2026), para quien sube con
 * «Facturas · Subida» y no consulta Compras: la cabecera leída (proveedor, CIF,
 * número, fecha, importes y observaciones, sin «verificada») y sus líneas
 * (corregir y añadir las que faltan). Solo lo que ha subido él: si no es suyo,
 * se ve pero sin lápices (y el servidor tampoco lo dejaría, migración
 * 20261106510000). Quien consulta Compras lo corrige en su ficha.
 */
export function CorregirDocumentoDialog({ facturaId, onCerrar }: { facturaId: number | null; onCerrar: () => void }) {
  const q = useDocumentoCompras(facturaId);
  const puedeCorregir = usePuedeCorregirDocumento(facturaId);
  const [editandoCabecera, setEditandoCabecera] = useState(false);
  const [añadiendo, setAñadiendo] = useState(false);
  useEffect(() => {
    setEditandoCabecera(false);
    setAñadiendo(false);
  }, [facturaId]);

  const doc = q.data ?? null;
  const nombreTipo = doc?.tipo === "albaran" ? "Albarán" : "Factura";
  const titulo = doc ? `${nombreTipo} ${doc.numero_documento ?? ""}`.trim() : "Documento";
  const datos: [string, string][] = doc
    ? ([
        ["Proveedor", doc.proveedor],
        ["CIF", doc.cif],
        ["Número", doc.numero_documento],
        ["Fecha", doc.fecha ? formatDate(doc.fecha) : null],
        ["Base imponible", doc.subtotal != null ? formatImporte(doc.subtotal) : null],
        ["IVA", doc.iva != null ? formatImporte(doc.iva) : null],
        ["Total", doc.total != null ? formatImporte(doc.total) : null],
      ].filter(([, v]) => !!v) as [string, string][])
    : [];

  return (
    <>
      <Dialog open={facturaId !== null && !editandoCabecera} onOpenChange={(abierto) => !abierto && onCerrar()}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription>
              {puedeCorregir
                ? "Corrige lo que se haya leído mal: los datos de arriba y las líneas. Verificarlo o clasificar productos lo hace quien tiene «Editar» en Facturas."
                : "Solo puedes corregir los documentos que has subido tú."}
            </DialogDescription>
          </DialogHeader>

          {q.isLoading ? (
            <p className="text-sm text-muted-foreground" role="status">Abriendo el documento…</p>
          ) : !doc ? (
            <p className="text-sm text-muted-foreground">No se ha podido abrir este documento.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" aria-label="Datos leídos">
                  {datos.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="min-w-0 break-words font-medium tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <BotonOriginal driveUrl={doc.drive_url} archivoPath={doc.archivo_path} variant="ficha" label="Ver original" />
                  {puedeCorregir && (
                    <Button variant="outline" className="h-11 gap-1.5" onClick={() => setEditandoCabecera(true)}>
                      <Pencil className="h-4 w-4" aria-hidden="true" /> Corregir datos
                    </Button>
                  )}
                </div>
              </div>

              <section aria-label="Líneas del documento" className="space-y-1 [container-type:inline-size]">
                <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Líneas ({doc.productos.length})</h3>
                {doc.productos.length === 0 && !añadiendo && <p className="py-2 text-sm text-muted-foreground">Este documento no tiene líneas.</p>}
                {doc.productos.map((p) => (
                  <FilaProducto key={p.id} p={p} isMobile editable={puedeCorregir} />
                ))}
                {puedeCorregir &&
                  (añadiendo ? (
                    <FilaProducto key={`nueva-${doc.id}`} p={LINEA_VACIA} isMobile nuevaEnFacturaId={doc.id} onCerrarNueva={() => setAñadiendo(false)} />
                  ) : (
                    <Button variant="ghost" className="-ml-3 h-11 gap-1.5 px-3 text-sm text-muted-foreground hover:text-foreground" onClick={() => setAñadiendo(true)}>
                      <Plus className="h-4 w-4" aria-hidden="true" /> Añadir línea
                    </Button>
                  ))}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* La cabecera, con el diálogo de siempre (sin «verificada» para quien no tiene «Editar»). */}
      <EditarFacturaDialog factura={editandoCabecera ? doc : null} open={editandoCabecera && !!doc} onOpenChange={(abierto) => !abierto && setEditandoCabecera(false)} />
    </>
  );
}
