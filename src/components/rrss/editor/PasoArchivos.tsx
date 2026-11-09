import { useRef, useState, type DragEvent } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ImagePlus, Loader2, Play, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { ACEPTA_ARCHIVOS, type Archivo } from "@/components/rrss/api";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Subida } from "./useSubidas";
import { formatoBytes, formatoSegundos } from "./util";

interface Props {
  archivos: Archivo[];
  /** Se están leyendo los archivos guardados del trabajo. */
  cargando?: boolean;
  subidas: Subida[];
  rechazos: string[];
  urls: Record<string, string>;
  enReintento: Set<string>;
  onAnadir: (archivos: File[]) => void;
  onReintentarSubida: (clave: string) => void;
  onDescartarSubida: (clave: string) => void;
  onReintentarArchivo: (a: Archivo) => void;
  onQuitar: (a: Archivo) => Promise<void>;
  onOrden: (ids: string[]) => void;
  onLimpiarRechazos: () => void;
}

function Miniatura({ src, video, nombre }: { src?: string; video: boolean; nombre: string }) {
  return (
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {src ? <img src={src} alt={`Miniatura de ${nombre}`} className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
      {video && (
        <span className="absolute bottom-1 right-1 rounded-full bg-black/60 p-1 text-white">
          <Play className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

export function PasoArchivos({ archivos, cargando = false, subidas, rechazos, urls, enReintento, onAnadir, onReintentarSubida, onDescartarSubida, onReintentarArchivo, onQuitar, onOrden, onLimpiarRechazos }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [porQuitar, setPorQuitar] = useState<Archivo | null>(null);
  const [quitando, setQuitando] = useState(false);
  const [origen, setOrigen] = useState<string | null>(null);

  const idsConSubida = new Set(subidas.filter((s) => s.archivo).map((s) => (s.archivo as Archivo).id));
  const visibles = archivos.filter((a) => !idsConSubida.has(a.id));
  const ids = visibles.map((a) => a.id);

  function soltar(e: DragEvent) {
    e.preventDefault();
    setArrastrando(false);
    const lista = Array.from(e.dataTransfer?.files ?? []);
    if (lista.length > 0) onAnadir(lista);
  }

  function mover(id: string, destino: number) {
    const i = ids.indexOf(id);
    if (i < 0 || destino < 0 || destino >= ids.length || i === destino) return;
    const nuevo = [...ids];
    nuevo.splice(i, 1);
    nuevo.splice(destino, 0, id);
    onOrden(nuevo);
  }

  const total = visibles.length + subidas.length;

  return (
    <div className="space-y-4">
      <div
        data-testid="zona-soltar"
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
            e.preventDefault();
            setArrastrando(true);
          }
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={soltar}
        className={cn("flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors", arrastrando ? "border-primary bg-primary/5" : "border-border")}
      >
        <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">Suelta aquí tus fotos y vídeos</p>
        <p className="text-xs text-muted-foreground">JPEG, PNG, WebP, HEIC, MP4, MOV o WebM. Hasta 50 MB cada uno.</p>
        <Button type="button" variant="outline" onClick={() => entrada.current?.click()}>
          Elegir archivos
        </Button>
        <input
          ref={entrada}
          type="file"
          multiple
          accept={ACEPTA_ARCHIVOS}
          className="sr-only"
          tabIndex={-1}
          aria-label="Elegir fotos y vídeos"
          data-testid="entrada-archivos"
          onChange={(e) => {
            const lista = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (lista.length > 0) onAnadir(lista);
          }}
        />
        <p className="text-xs text-muted-foreground">El original se guarda siempre sin tocar.</p>
      </div>

      {rechazos.length > 0 && (
        <div role="alert" data-testid="rechazos" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <ul className="space-y-1">
              {rechazos.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            <Button type="button" variant="ghost" size="icon" aria-label="Cerrar aviso" onClick={onLimpiarRechazos}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {cargando && total === 0 ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando los archivos">
          <Skeleton className="h-20 w-full" />
        </div>
      ) : total === 0 ? (
        <p data-testid="sin-archivos" className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Todavía no has subido nada. Con la primera foto o vídeo se crea el trabajo y se guarda solo.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Archivos del trabajo">
          {visibles.map((a, i) => {
            const previa = a.estado === "listo" && a.analisis?.previa_ruta ? urls[a.analisis.previa_ruta] : undefined;
            const reintentando = enReintento.has(a.id);
            return (
              <li
                key={a.id}
                data-testid={`archivo:${a.id}`}
                draggable
                onDragStart={(e) => {
                  setOrigen(a.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", `rrss-archivo:${a.id}`);
                }}
                onDragOver={(e) => origen && e.preventDefault()}
                onDrop={(e) => {
                  if (!origen) return;
                  e.preventDefault();
                  e.stopPropagation();
                  mover(origen, i);
                  setOrigen(null);
                }}
                onDragEnd={() => setOrigen(null)}
                className={cn("flex items-center gap-3 rounded-md border bg-card p-2", origen === a.id && "opacity-50")}
              >
                <Miniatura src={previa} video={a.tipo === "video"} nombre={a.nombre} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatoBytes(a.bytes)}
                    {a.tipo === "video" && a.duracion_s ? ` · ${formatoSegundos(a.duracion_s)}` : ""}
                    {a.ancho && a.alto ? ` · ${a.ancho}×${a.alto}` : ""}
                  </p>
                  {a.estado === "listo" && !reintentando && (
                    <p className="flex items-center gap-1 text-xs text-[#117e39]">
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Listo
                    </p>
                  )}
                  {(a.estado === "subido" || a.estado === "analizando" || reintentando) && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Preparando…
                    </p>
                  )}
                  {a.estado === "error" && !reintentando && (
                    <p className="text-xs text-destructive">
                      Error: {a.error || "no se ha podido preparar el archivo"}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {(a.estado === "error" || a.estado === "subido") && !reintentando && (
                    <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => onReintentarArchivo(a)}>
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Reintentar
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="icon" aria-label={`Subir ${a.nombre}`} disabled={i === 0} onClick={() => mover(a.id, i - 1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Bajar ${a.nombre}`} disabled={i === visibles.length - 1} onClick={() => mover(a.id, i + 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Quitar ${a.nombre}`} onClick={() => setPorQuitar(a)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
          {subidas.map((s) => (
            <li key={s.clave} data-testid={`subida:${s.nombre}`} className="flex items-center gap-3 rounded-md border bg-card p-2">
              <Miniatura src={s.urlLocal} video={s.medio === "video"} nombre={s.nombre} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-medium">{s.nombre}</p>
                <p className="text-xs text-muted-foreground">{formatoBytes(s.bytes)}</p>
                {s.fase === "subiendo" && (
                  <>
                    <p className="text-xs text-muted-foreground">Subiendo {Math.round(s.progreso * 100)} %</p>
                    <Progress value={Math.round(s.progreso * 100)} className="h-1.5" aria-label={`Progreso de ${s.nombre}`} />
                  </>
                )}
                {s.fase === "preparando" && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Preparando…
                  </p>
                )}
                {s.fase === "error" && <p className="text-xs text-destructive">Error: {s.error}</p>}
              </div>
              {s.fase === "error" && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => onReintentarSubida(s.clave)}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Reintentar
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Descartar ${s.nombre}`} onClick={() => onDescartarSubida(s.clave)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!porQuitar} onOpenChange={(o) => !o && !quitando && setPorQuitar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar este archivo?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra «{porQuitar?.nombre}» del trabajo, también el original guardado. Las piezas ya generadas no cambian.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={quitando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={quitando}
              onClick={async (e) => {
                e.preventDefault();
                if (!porQuitar) return;
                setQuitando(true);
                try {
                  await onQuitar(porQuitar);
                } finally {
                  setQuitando(false);
                  setPorQuitar(null);
                }
              }}
            >
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
