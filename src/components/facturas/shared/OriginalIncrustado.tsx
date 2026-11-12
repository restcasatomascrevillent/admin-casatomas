import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, FileX2, ImageOff, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ImagenZoom } from "./ImagenZoom";
import { urlSegura } from "@/lib/url-segura";
import { vistaPreviaDrive } from "@/lib/facturas/documentosCifra";
import { useOriginalDrive, useUrlDeBlob } from "@/lib/facturas/originalDrive";
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
function VisorPantallaCompleta({
  url,
  abierto,
  onCerrar,
  titulo,
  conEnlace = true,
}: {
  url: string;
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  /** Sin él con un blob URL: en otra pestaña se libera al cerrar la ficha. */
  conEnlace?: boolean;
}) {
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="h-[94dvh] w-[96vw] max-w-[96vw] gap-0 p-0 sm:rounded-lg pointer-coarse:max-h-[94dvh]">
        <DialogTitle className="sr-only">{titulo}</DialogTitle>
        <DialogDescription className="sr-only">Documento original a pantalla completa</DialogDescription>
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1 pr-14">
          {conEnlace && (
            <a href={url} target="_blank" rel="noopener noreferrer" className={ENLACE}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" /> Abrir en pestaña nueva
            </a>
          )}
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Rueda o pellizco para ampliar · arrastra para moverte · doble clic para acercar</span>
        </div>
        <div data-testid="visor-original" className="flex min-h-0 flex-1 flex-col">
          <ImagenZoom src={url} alt={titulo} className="min-h-0 flex-1 rounded-none border-0" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Cabecera común del visor: título pequeño y, a la derecha, un único enlace para abrirlo fuera. */
function CabeceraVisor({ enlace }: { enlace: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Documento original
      </h3>
      {enlace}
    </div>
  );
}

/**
 * EL sitio de la ficha (Compras › Documentos) donde se ve el original — no hay
 * otro botón «Original» en la cabecera (dueño, 09/11/2026: ver el papel AL LADO
 * de los datos, sin abrir otra pestaña).
 *   - `drive_url` de Drive  -> el servidor (Edge Function `facturas-original`)
 *                              lo descarga con la cuenta del restaurante: foto
 *                              con zoom o PDF incrustado + «Abrir en Drive».
 *                              No depende de la sesión de Google del navegador
 *                              (dueño, 12/11/2026). Sin `documentoId`, la vista
 *                              previa de Drive en un iframe, como antes.
 *   - `archivo_path` imagen -> foto en un recuadro con zoom/arrastre/giro; botón de pantalla completa.
 *   - `archivo_path` PDF    -> PDF incrustado + enlace «Abrir PDF».
 *   - `drive_url` sin id    -> una línea con el enlace (no se sabe incrustar).
 *   - nada                  -> estado vacío discreto, en una línea.
 * Drive va primero: `archivo_path` es la copia TEMPORAL mientras Drive no la tiene.
 * Solo se monta con la ficha abierta, así que el original no se pide antes.
 */
export function OriginalIncrustado({
  driveUrl: driveUrlBruta,
  archivoPath,
  titulo,
  documentoId,
  relleno = false,
}: {
  driveUrl: string | null;
  archivoPath: string | null;
  titulo: string;
  /** `facturas.id`: con él, el original de Drive lo sirve el servidor. */
  documentoId?: number | null;
  /** Visor lateral de la ficha: el original ocupa todo el alto disponible (el padre es `flex flex-col`). */
  relleno?: boolean;
}) {
  const driveUrl = urlSegura(driveUrlBruta); // CT-REM-FE-06
  const previa = vistaPreviaDrive(driveUrl);
  if (previa && driveUrl) {
    return typeof documentoId === "number" && documentoId > 0 ? (
      <OriginalDeDrive documentoId={documentoId} driveUrl={driveUrl} titulo={titulo} relleno={relleno} />
    ) : (
      <VistaPreviaDrive previa={previa} driveUrl={driveUrl} titulo={titulo} relleno={relleno} />
    );
  }
  if (archivoPath) return <OriginalDeStorage archivoPath={archivoPath} titulo={titulo} relleno={relleno} />;
  if (driveUrl) {
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground" data-tour="facturas-original">
        <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Original en Google Drive ·</span>
        <EnlaceDrive driveUrl={driveUrl} />
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="sin-original">
      <FileX2 className="h-4 w-4 shrink-0" aria-hidden="true" /> No se guardó el original de este documento.
    </p>
  );
}

function EnlaceDrive({ driveUrl }: { driveUrl: string }) {
  return (
    <a href={driveUrl} target="_blank" rel="noopener noreferrer" className={ENLACE}>
      <ExternalLink className="h-4 w-4" aria-hidden="true" /> Abrir en Drive
    </a>
  );
}

/** Vista previa de Drive en un <iframe>: pide estar dentro de la cuenta de Google con acceso. Solo sin `documentoId`. */
function VistaPreviaDrive({ previa, driveUrl, titulo, relleno }: { previa: string; driveUrl: string; titulo: string; relleno: boolean }) {
  return (
    <section aria-label="Documento original" className={relleno ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"} data-tour="facturas-original">
      <CabeceraVisor enlace={<EnlaceDrive driveUrl={driveUrl} />} />
      <iframe
        src={previa}
        title={`Original: ${titulo}`}
        loading="lazy"
        allow="autoplay"
        referrerPolicy="no-referrer"
        className={`w-full rounded-md border bg-muted/40 ${relleno ? "min-h-0 flex-1" : "h-[70dvh] min-h-80"}`}
      />
    </section>
  );
}

/** Texto del error sin el punto final, para meterlo entre paréntesis. */
const sinPunto = (t: string) => t.replace(/\.$/, "");

/** El original de Drive, descargado por el servidor (blob URL): no hace falta sesión de Google. */
function OriginalDeDrive({ documentoId, driveUrl, titulo, relleno }: { documentoId: number; driveUrl: string; titulo: string; relleno: boolean }) {
  const q = useOriginalDrive(documentoId);
  const url = useUrlDeBlob(q.data);
  const motivo = q.error instanceof Error && q.error.message ? ` (${sinPunto(q.error.message)})` : "";
  return (
    <VisorArchivo
      key={url ?? "sin-url"}
      url={url}
      pdf={q.data?.type === "application/pdf"}
      fallo={q.isError && !q.isFetching}
      mensajeFallo={`No se ha podido cargar el original desde Google Drive${motivo}. Puedes verlo con «Abrir en Drive».`}
      onReintentar={() => void q.refetch()}
      enlace={<EnlaceDrive driveUrl={driveUrl} />}
      enlacePantallaCompleta={false}
      titulo={titulo}
      relleno={relleno}
    />
  );
}

function OriginalDeStorage({ archivoPath, titulo, relleno }: { archivoPath: string; titulo: string; relleno: boolean }) {
  const q = useUrlOriginal(archivoPath);
  const pdf = esPdf(archivoPath);
  const url = q.data;
  return (
    <VisorArchivo
      key={url ?? "sin-url"}
      url={url}
      pdf={pdf}
      fallo={q.isError && !q.isFetching}
      mensajeFallo="No se ha podido cargar el documento original."
      onReintentar={() => void q.refetch()}
      enlace={
        url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className={ENLACE}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" /> {pdf ? "Abrir PDF" : "Abrir"}
          </a>
        )
      }
      titulo={titulo}
      relleno={relleno}
    />
  );
}

/** Lo común: cabecera, cargando, aviso de fallo con «Reintentar», PDF incrustado o foto con zoom y pantalla completa. */
function VisorArchivo({
  url,
  pdf,
  fallo,
  mensajeFallo,
  onReintentar,
  enlace,
  enlacePantallaCompleta = true,
  titulo,
  relleno,
}: {
  url: string | undefined;
  pdf: boolean;
  fallo: boolean;
  mensajeFallo: string;
  onReintentar: () => void;
  enlace: ReactNode;
  /** «Abrir en pestaña nueva» en el visor a pantalla completa (no con un blob URL). */
  enlacePantallaCompleta?: boolean;
  titulo: string;
  relleno: boolean;
}) {
  const [cargada, setCargada] = useState(false);
  const [falloImagen, setFalloImagen] = useState(false);
  const [visor, setVisor] = useState(false);

  const reintentar = () => {
    setFalloImagen(false);
    setCargada(false);
    onReintentar();
  };

  let cuerpo;
  if (fallo || falloImagen) {
    cuerpo = (
      <div role="status" className={`flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground ${relleno ? "m-auto" : ""}`}>
        <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{mensajeFallo}</span>
        <button type="button" onClick={reintentar} className={ENLACE}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reintentar
        </button>
      </div>
    );
  } else if (!url) {
    cuerpo = (
      <div className={`flex items-center justify-center rounded-md bg-muted/50 ${relleno ? "min-h-0 flex-1" : "h-48"}`} aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Cargando el original" />
      </div>
    );
  } else if (pdf) {
    cuerpo = (
      <object data={url} type="application/pdf" aria-label={titulo} className={`w-full rounded-md border bg-muted/40 ${relleno ? "min-h-0 flex-1" : "h-[70dvh] min-h-80"}`}>
        <p className="p-3 text-sm text-muted-foreground">Este navegador no puede mostrar el PDF aquí. Ábrelo con el enlace de arriba.</p>
      </object>
    );
  } else {
    cuerpo = (
      <div className={relleno ? "flex min-h-0 flex-1 flex-col gap-1" : "space-y-1"}>
        <div className={relleno ? "relative min-h-0 flex-1" : "relative"}>
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
            className={relleno ? "h-full bg-background" : "h-[55dvh] max-h-[44rem] min-h-72 bg-background"}
          />
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">Ctrl + rueda o pellizca para ampliar · arrastra para moverte · doble clic para acercar</p>
      </div>
    );
  }

  return (
    <section aria-label="Documento original" className={relleno ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"} data-tour="facturas-original">
      <CabeceraVisor enlace={enlace} />
      {cuerpo}
      {url && !pdf && <VisorPantallaCompleta url={url} abierto={visor} onCerrar={() => setVisor(false)} titulo={titulo} conEnlace={enlacePantallaCompleta} />}
    </section>
  );
}
