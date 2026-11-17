import { useEffect, useState } from "react";
import { Download, FileX2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { VisorPdf } from "@/components/facturas/shared/VisorPdf";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import { tituloRecibo, type Factura } from "./modelo";

export interface ReciboEnPrevia {
  documento: Factura;
  /** Sin emitir: el PDF sale marcado «BORRADOR · SIN EMITIR» y no se descarga desde aquí. */
  borrador: boolean;
}

/**
 * Vista previa del PDF de un recibo (dueño, 17/11/2026: «que dé vista previa del PDF»): el MISMO
 * PDF que se descarga, hoja a hoja, sin guardar ni emitir nada. Vale para recibos emitidos y para
 * borradores (estos, marcados como tales y aunque les falten datos). El PDF se pinta con pdf.js
 * (`VisorPdf`): incrustado en un <iframe> no se ve en este panel (CSP) ni bien en el móvil.
 */
export function VistaPreviaPdf({ recibo, cerrar }: { recibo: ReciboEnPrevia | null; cerrar: () => void }) {
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPdf(null);
    setError(null);
    if (!recibo) return;
    let cancelado = false;
    void (async () => {
      try {
        const { blobPdfFactura } = await import("./pdf");
        const blob = await blobPdfFactura(recibo.documento, { borrador: recibo.borrador });
        if (!cancelado) setPdf(blob);
      } catch (e) {
        if (!cancelado) setError(mensajeUsuario(e, "No se ha podido generar la vista previa."));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [recibo]);

  const d = recibo?.documento;
  const numero = d?.numero.trim() || "sin número";
  const descargar = async () => {
    if (!pdf || !d) return;
    const { descargarBlobPdf } = await import("./pdf");
    descargarBlobPdf(pdf, d);
  };
  return (
    <Dialog open={!!recibo} onOpenChange={(abierto) => { if (!abierto) cerrar(); }}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[94dvh] sm:max-h-[94dvh] sm:w-[96vw] sm:max-w-4xl sm:rounded-xl pointer-coarse:max-h-[100dvh] sm:pointer-coarse:max-h-[94dvh]">
        <div className="shrink-0 border-b px-4 py-3 pr-12">
          <DialogTitle className="break-words text-base">Vista previa del PDF · {numero}</DialogTitle>
          <DialogDescription className="break-words text-xs">
            {d ? `${tituloRecibo(d)} · ${d.cliente.nombre.trim() || "cliente pendiente"}` : ""}
            {recibo?.borrador ? " · Borrador sin emitir: así quedará el PDF. Nada se guarda al mirarlo." : " · Es el mismo PDF que se descarga."}
          </DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col bg-muted/40 p-2">
          {error ? (
            <p role="alert" className="m-auto flex max-w-sm flex-col items-center gap-2 p-4 text-center text-sm text-destructive"><FileX2 className="h-6 w-6" aria-hidden="true" />{error}</p>
          ) : !pdf ? (
            <p role="status" className="m-auto flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Preparando el PDF…</p>
          ) : (
            <VisorPdf fuente={pdf} titulo={`Recibo ${numero}`} className="min-h-0 flex-1" />
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
          {recibo?.borrador && <p className="mr-auto text-xs text-muted-foreground">Para descargarlo, emite el recibo.</p>}
          {!recibo?.borrador && <Button type="button" className="h-10 gap-2 pointer-coarse:h-11" disabled={!pdf} onClick={() => void descargar()}><Download className="h-4 w-4" aria-hidden="true" />Descargar PDF</Button>}
          <Button type="button" variant="outline" className="h-10 pointer-coarse:h-11" onClick={cerrar}>Cerrar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
