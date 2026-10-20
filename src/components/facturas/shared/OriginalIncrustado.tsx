import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, ImageOff, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ImagenZoom } from "./ImagenZoom";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const BUCKET = "facturas-originales";
/** Vida de la URL firmada de la vista previa (más larga que la del botón: la imagen se pide al desplazarse). */
const SEGUNDOS_FIRMA = 600;
/** Se renueva un minuto antes de que caduque. */
const VIDA_CACHE_MS = (SEGUNDOS_FIRMA - 60) * 1000;

const esPdf = (ruta: string) => /\.pdf$/i.test(ruta.split("?")[0]);

/** URL firmada del original, cacheada por ruta; al caducar se vuelve a pedir. */
function useUrlOriginal(archivoPath: string | null) {
  return useQuery({
    queryKey: ["factura-original-url", archivoPath],
    enabled: !!archivoPath,
    staleTime: VIDA_CACHE_MS,
    gcTime: VIDA_CACHE_MS,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(archivoPath as string, SEGUNDOS_FIRMA);
      if (error || !data?.signedUrl) throw new Error(error?.message || "URL no disponible");
      return data.signedUrl;
    },
  });
}

const ENLACE =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/40 dark:hover:text-blue-300";

/** Visor a pantalla completa: la misma imagen con zoom (rueda, pellizco, arrastre, giro) a todo el alto del diálogo. */
function VisorPantallaCompleta({ url, abierto, onCerrar, titulo }: { url: string; abierto: boolean; onCerrar: () => void; titulo: string }) {
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="h-[94dvh] w-[96vw] max-w-[96vw] gap-0 p-0 sm:rounded-lg pointer-coarse:max-h-[94dvh]">
        <DialogTitle className="sr-only">{titulo}</DialogTitle>
        <DialogDescription className="sr-only">Documento original a pantalla completa</DialogDescription>
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1 pr-14">
          <a href={url} target="_blank" rel="noopener noreferrer" className={ENLACE}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" /> Abrir en pestaña nueva
          </a>
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Rueda o pellizco para ampliar · arrastra para moverte · doble clic para acercar</span>
        </div>
        <div data-testid="visor-original" className="flex min-h-0 flex-1 flex-col">
          <ImagenZoom src={url} alt={titulo} className="min-h-0 flex-1 rounded-none border-0" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Original del documento incrustado al final de la ficha (Compras › Documentos).
 *   - `archivo_path` imagen -> foto en un recuadro con zoom/arrastre/giro; botón de pantalla completa.
 *   - `archivo_path` PDF    -> primera vista con <object> + enlace «Abrir PDF».
 *   - solo `drive_url`      -> una línea con el enlace (Drive no se incrusta: pide permisos).
 *   - nada                  -> no pinta nada.
 * Solo se monta con la ficha abierta, así que la URL firmada no se pide antes.
 */
export function OriginalIncrustado({ driveUrl, archivoPath, titulo }: { driveUrl: string | null; archivoPath: string | null; titulo: string }) {
  if (archivoPath) return <OriginalDeStorage archivoPath={archivoPath} titulo={titulo} />;
  if (driveUrl) {
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
        <span>Original en Google Drive ·</span>
        <a href={driveUrl} target="_blank" rel="noopener noreferrer" className={ENLACE}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" /> Abrir
        </a>
      </p>
    );
  }
  return null;
}

function OriginalDeStorage({ archivoPath, titulo }: { archivoPath: string; titulo: string }) {
  const q = useUrlOriginal(archivoPath);
  const pdf = esPdf(archivoPath);
  const [cargada, setCargada] = useState(false);
  const [falloImagen, setFalloImagen] = useState(false);
  const [visor, setVisor] = useState(false);
  const url = q.data;

  const reintentar = () => {
    setFalloImagen(false);
    setCargada(false);
    void q.refetch();
  };

  const cabecera = (
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Documento original
      </h3>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className={ENLACE}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" /> {pdf ? "Abrir PDF" : "Abrir"}
        </a>
      )}
    </div>
  );

  let cuerpo;
  if (q.isError || falloImagen) {
    cuerpo = (
      <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">No se ha podido cargar el documento original.</span>
        <button type="button" onClick={reintentar} className={ENLACE}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reintentar
        </button>
      </div>
    );
  } else if (!url) {
    cuerpo = (
      <div className="flex h-48 items-center justify-center rounded-md bg-muted/50" aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Cargando el original" />
      </div>
    );
  } else if (pdf) {
    cuerpo = (
      <object data={url} type="application/pdf" aria-label={titulo} className="h-[70dvh] min-h-80 w-full rounded-md border bg-muted/40">
        <p className="p-3 text-sm text-muted-foreground">Este navegador no puede mostrar el PDF aquí. Usa «Abrir PDF».</p>
      </object>
    );
  } else {
    cuerpo = (
      <div className="space-y-1">
        <div className="relative">
          {/* Nada de `display:none` mientras carga: una imagen `lazy` oculta no se pide nunca. */}
          {!cargada && <span className="absolute inset-0 z-10 animate-pulse rounded-md bg-muted" aria-hidden="true" />}
          <ImagenZoom
            src={url}
            alt={titulo}
            lazy
            requiereCtrl
            oculta={!cargada}
            onLoad={() => setCargada(true)}
            onError={() => setFalloImagen(true)}
            onPantallaCompleta={() => setVisor(true)}
            className="h-[65dvh] max-h-[44rem] min-h-72"
          />
        </div>
        <p className="text-xs text-muted-foreground">Ctrl + rueda o pellizca para ampliar · arrastra para moverte · doble clic para acercar</p>
      </div>
    );
  }

  return (
    <section aria-label="Documento original" className="space-y-2" data-tour="facturas-original">
      {cabecera}
      {cuerpo}
      {url && !pdf && <VisorPantallaCompleta url={url} abierto={visor} onCerrar={() => setVisor(false)} titulo={titulo} />}
    </section>
  );
}
