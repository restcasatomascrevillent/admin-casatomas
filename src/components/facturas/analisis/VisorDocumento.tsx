// Visor emergente de un documento desde «Ver documentos» de Análisis.
//
//   · Diálogo grande (pantalla completa en móvil) con el ORIGINAL incrustado:
//       drive_url    → vista previa de Drive (`/file/d/<id>/preview`);
//       archivo_path → URL firmada de Storage (PDF en <iframe>, foto con zoom).
//     Si no se puede incrustar, quedan los botones para abrirlo.
//   · Cabecera: proveedor, nº, fecha, tipo, local y total; «Abrir en Drive»
//     (pestaña nueva) y «Abrir en Compras» (su ficha).
//   · Anterior / Siguiente (y las flechas ← →) recorren la lista sin cerrar.
//   · Radix Dialog: foco atrapado, Escape cierra, título y descripción.
import type { KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, FileSearch, FileX2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ImagenZoom } from "@/components/facturas/shared/ImagenZoom";
import { formatCurrency, formatEntero, formatImporte } from "@/components/facturas/shared/formatters";
import { cn } from "@/lib/utils";
import { urlSegura } from "@/lib/url-segura";
import { fechaCorta } from "@/lib/facturas/tableroCompras";
import { ETIQUETA_LOCAL, ETIQUETA_TIPO, enlaceDocumentoCompras, esPdf, vistaPreviaDrive, type DocumentoCifra } from "@/lib/facturas/documentosCifra";
import { FOCO } from "./piezas";
import { useFocoAlCerrar } from "./desplazar";

const BUCKET = "facturas-originales";
const SEGUNDOS_FIRMA = 600;

/** URL firmada del original en Storage (la misma regla que OriginalIncrustado: 10 min, se renueva antes). */
function useUrlFirmada(ruta: string | null) {
  return useQuery({
    queryKey: ["factura-original-url", ruta],
    enabled: !!ruta,
    staleTime: (SEGUNDOS_FIRMA - 60) * 1000,
    gcTime: (SEGUNDOS_FIRMA - 60) * 1000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta as string, SEGUNDOS_FIRMA);
      if (error || !data?.signedUrl) throw new Error(error?.message || "URL no disponible");
      return data.signedUrl;
    },
  });
}

const ACCION =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-40";

function Original({ doc, titulo }: { doc: DocumentoCifra; titulo: string }) {
  const previa = vistaPreviaDrive(doc.driveUrl);
  const firmada = useUrlFirmada(!previa ? doc.archivoPath : null);
  if (previa) {
    return <iframe key={doc.id} src={previa} title={`Original: ${titulo}`} className="h-full w-full border-0 bg-muted/30" allow="autoplay" referrerPolicy="no-referrer" />;
  }
  if (doc.archivoPath) {
    if (firmada.isError)
      return (
        <p role="status" className="m-auto flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <FileX2 className="h-5 w-5" aria-hidden /> No se ha podido cargar el original.
        </p>
      );
    if (!firmada.data)
      return (
        <div className="m-auto flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Cargando el original…
        </div>
      );
    return esPdf(doc.archivoPath) ? (
      <iframe key={doc.id} src={firmada.data} title={`Original: ${titulo}`} className="h-full w-full border-0 bg-muted/30" />
    ) : (
      <ImagenZoom key={doc.id} src={firmada.data} alt={`Original: ${titulo}`} className="h-full min-h-0 w-full rounded-none border-0" />
    );
  }
  return (
    <p role="status" className="m-auto flex max-w-sm flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <FileSearch className="h-6 w-6" aria-hidden />
      No se guardó el original de este documento. Sus datos están en Compras.
    </p>
  );
}

export function VisorDocumento({
  documentos,
  indice,
  onIndice,
  onCerrar,
  onAbrirEnCompras,
  total,
}: {
  documentos: DocumentoCifra[];
  indice: number | null;
  onIndice: (i: number) => void;
  onCerrar: () => void;
  onAbrirEnCompras?: (enlace: string) => void;
  /** Cuántos hay en total (la lista puede no estar cargada entera). */
  total: number;
}) {
  const doc = indice !== null ? documentos[indice] : undefined;
  const abierto = !!doc;
  const drive = urlSegura(doc?.driveUrl ?? null);
  const firmada = useUrlFirmada(doc && !drive ? doc.archivoPath : null);
  const enlaceExterno = drive ?? firmada.data ?? null;
  const hayAnterior = indice !== null && indice > 0;
  const haySiguiente = indice !== null && indice < documentos.length - 1;
  // Al cerrar, el foco vuelve al documento de la lista que lo abrió.
  const focoAlCerrar = useFocoAlCerrar(abierto);
  const titulo = doc ? `${ETIQUETA_TIPO[doc.tipo]} ${doc.numero ?? "sin número"} · ${doc.proveedor}` : "";

  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    if (e.key === "ArrowLeft" && hayAnterior) {
      e.preventDefault();
      onIndice((indice as number) - 1);
    } else if (e.key === "ArrowRight" && haySiguiente) {
      e.preventDefault();
      onIndice((indice as number) + 1);
    }
  };

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent
        onKeyDown={teclas}
        onCloseAutoFocus={focoAlCerrar}
        className="h-[100dvh] max-h-[100dvh] w-screen max-w-none gap-0 overflow-hidden rounded-none p-0 sm:h-[94dvh] sm:max-h-[94dvh] sm:w-[96vw] sm:max-w-6xl sm:rounded-xl pointer-coarse:max-h-[100dvh] sm:pointer-coarse:max-h-[94dvh]"
        data-testid="visor-documento"
      >
        {doc && (
          <>
            <header className="flex shrink-0 flex-col gap-2 border-b border-border/70 px-3 py-2 pr-14 sm:px-4 sm:pr-16">
              <div className="min-w-0">
                <DialogTitle className="truncate text-base font-semibold leading-tight sm:text-lg" title={titulo}>
                  {doc.proveedor}
                </DialogTitle>
                <DialogDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground sm:text-sm">
                  <span className="font-medium text-foreground">{ETIQUETA_TIPO[doc.tipo]}</span>
                  <span>nº {doc.numero ?? "—"}</span>
                  <span>{doc.fecha ? fechaCorta(doc.fecha) : "sin fecha"}</span>
                  <span>{ETIQUETA_LOCAL[doc.local]}</span>
                  <span className="font-semibold tabular-nums text-foreground">{doc.total === null ? "sin total" : formatImporte(doc.total)}</span>
                </DialogDescription>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" className={cn(ACCION, FOCO, "min-w-11 px-2")} onClick={() => onIndice((indice as number) - 1)} disabled={!hayAnterior} aria-label="Documento anterior">
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Anterior</span>
                </button>
                <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
                  {(indice as number) + 1} de {formatEntero(total)}
                </span>
                <button type="button" className={cn(ACCION, FOCO, "min-w-11 px-2")} onClick={() => onIndice((indice as number) + 1)} disabled={!haySiguiente} aria-label="Documento siguiente">
                  <span className="hidden sm:inline">Siguiente</span>
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
                <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
                {enlaceExterno ? (
                  <a href={enlaceExterno} target="_blank" rel="noopener noreferrer" className={cn(ACCION, FOCO)}>
                    <ExternalLink className="h-4 w-4" aria-hidden /> {drive ? "Abrir en Drive" : "Abrir original"}
                  </a>
                ) : (
                  <button type="button" disabled className={ACCION} title="No se guardó el original">
                    <ExternalLink className="h-4 w-4" aria-hidden /> Abrir original
                  </button>
                )}
                {onAbrirEnCompras && (
                  <button type="button" className={cn(ACCION, FOCO)} onClick={() => onAbrirEnCompras(enlaceDocumentoCompras(doc.id))}>
                    Abrir en Compras
                  </button>
                )}
                {doc.aporta !== doc.total && doc.total !== null && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Aporta a la cifra <span className="font-medium tabular-nums text-foreground">{formatCurrency(doc.aporta)}</span>
                  </span>
                )}
              </div>
            </header>
            <div className="flex min-h-0 flex-1 flex-col bg-muted/20">
              <Original doc={doc} titulo={titulo} />
            </div>
            {drive && (
              <p className="shrink-0 border-t border-border/70 px-3 py-1.5 text-xs text-muted-foreground">
                La vista previa es la de Google Drive: si pide iniciar sesión o no se ve, usa «Abrir en Drive».
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
