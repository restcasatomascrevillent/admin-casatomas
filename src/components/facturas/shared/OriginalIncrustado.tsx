import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, ImageOff, Loader2, Maximize2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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

/** Visor a pantalla completa: «Ajustar» (cabe entera) o «100 %» (tamaño real; se arrastra o se desplaza). */
function VisorPantallaCompleta({ url, abierto, onCerrar, titulo }: { url: string; abierto: boolean; onCerrar: () => void; titulo: string }) {
  const [real, setReal] = useState(false);
  const marco = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="h-[94dvh] w-[96vw] max-w-[96vw] gap-0 p-0 sm:rounded-lg pointer-coarse:max-h-[94dvh]">
        <DialogTitle className="sr-only">{titulo}</DialogTitle>
        <DialogDescription className="sr-only">Documento original a pantalla completa</DialogDescription>
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1 pr-14">
          <button
            type="button"
            onClick={() => setReal((v) => !v)}
            aria-pressed={real}
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-muted"
          >
            {real ? "Ajustar a la pantalla" : "Ver al 100 %"}
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" className={ENLACE}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" /> Abrir en pestaña nueva
          </a>
        </div>
        <div
          ref={marco}
          data-testid="visor-original"
          className={`min-h-0 flex-1 overflow-auto overscroll-contain bg-muted/40 ${real ? "cursor-grab active:cursor-grabbing" : "flex items-center justify-center"}`}
          style={{ touchAction: real ? "pan-x pan-y pinch-zoom" : "auto" }}
          onPointerDown={(e) => {
            if (!real || e.pointerType !== "mouse" || !marco.current) return;
            arrastre.current = { x: e.clientX, y: e.clientY, sl: marco.current.scrollLeft, st: marco.current.scrollTop };
            marco.current.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const a = arrastre.current;
            if (!a || !marco.current) return;
            marco.current.scrollLeft = a.sl - (e.clientX - a.x);
            marco.current.scrollTop = a.st - (e.clientY - a.y);
          }}
          onPointerUp={() => {
            arrastre.current = null;
          }}
          onPointerCancel={() => {
            arrastre.current = null;
          }}
        >
          <img
            src={url}
            alt={titulo}
            draggable={false}
            className={real ? "max-w-none select-none" : "max-h-full max-w-full select-none object-contain"}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Original del documento incrustado al final de la ficha (Compras › Documentos).
 *   - `archivo_path` imagen -> foto a todo el ancho; al tocarla, pantalla completa con zoom.
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
      <button
        type="button"
        onClick={() => setVisor(true)}
        aria-label="Ver el original a pantalla completa"
        className="group relative block w-full overflow-hidden rounded-md border bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* Nada de `display:none` mientras carga: una imagen `lazy` oculta no se pide nunca. */}
        {!cargada && <span className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />}
        <img
          src={url}
          alt={titulo}
          loading="lazy"
          onLoad={() => setCargada(true)}
          onError={() => setFalloImagen(true)}
          className={`relative block w-full ${cargada ? "" : "min-h-64 opacity-0"}`}
        />
        <span className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-md bg-background/80 text-foreground opacity-80 shadow-sm group-hover:opacity-100">
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>
    );
  }

  return (
    <section aria-label="Documento original" className="space-y-2">
      {cabecera}
      {cuerpo}
      {url && !pdf && <VisorPantallaCompleta url={url} abierto={visor} onCerrar={() => setVisor(false)} titulo={titulo} />}
    </section>
  );
}
