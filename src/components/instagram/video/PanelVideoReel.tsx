import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clapperboard, Loader2, Music, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { validarReel, type ReelPieza } from "@/lib/instagram/reels";
import type { MarcaId } from "@/lib/instagram";
import { AccionesReel } from "./AccionesReel";
import { botonesReel, estadoVisible, firmaEstable, resumenVideo, revisarPista } from "./logica";
import {
  CLAVE_REEL,
  CLAVE_REELS,
  cancelarRender,
  encolarRender,
  prepararFotosReel,
  subirPistaAudio,
  textoErrorVideo,
  urlCuboVideo,
  useEstadoReel,
} from "./useVideoReel";

interface Props {
  reel: ReelPieza;
  /** Pieza guardada del reel (null hasta el primer «Generar vídeo»). */
  piezaId: string | null;
  onPiezaId: (id: string) => void;
  className?: string;
}

const TONO: Record<string, string> = {
  neutro: "bg-muted text-muted-foreground",
  trabajando: "bg-sky-100 text-sky-800",
  bien: "bg-emerald-100 text-emerald-800",
  mal: "bg-red-100 text-red-800",
};

/**
 * «Generar vídeo» del reel (fase 6, docs/instagram-video.md): guarda el reel,
 * prepara sus fotos y lo encola para el trabajador de render. Enseña el estado
 * (en cola, renderizando, listo, error), la vista previa del MP4 y, con el
 * vídeo listo, los mismos pasos que una imagen: probar, publicar o programar.
 */
export function PanelVideoReel({ reel, piezaId, onPiezaId, className }: Props) {
  const qc = useQueryClient();
  const { data, error: errorEstado, refetch } = useEstadoReel(piezaId);
  const pieza = data?.pieza ?? null;
  const trabajo = data?.trabajo ?? null;
  const [encolando, setEncolando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [caption, setCaption] = useState("");
  const [pista, setPista] = useState<File | null>(null);
  const [portada, setPortada] = useState("");
  const entradaPista = useRef<HTMLInputElement>(null);
  const captionCargado = useRef<string | null>(null);

  // El texto guardado de la pieza, una vez por pieza.
  useEffect(() => {
    if (pieza && captionCargado.current !== pieza.id) {
      captionCargado.current = pieza.id;
      setCaption(pieza.caption ?? "");
    }
  }, [pieza]);

  const validacion = useMemo(() => validarReel(reel), [reel]);
  // Se compara con el reel tal como se encola (validarReel recorta espacios).
  const reelAlDia = !!pieza && firmaEstable(pieza.datos) === firmaEstable(validacion.ok ? validacion.reel : reel);
  const visible = estadoVisible(trabajo);
  const trabajoActivo = !!visible?.activo;
  const b = botonesReel({ valido: validacion.ok, ocupado: encolando, trabajoActivo, pieza, reelAlDia, caption, captionValido: true });
  const urlVideo = pieza?.video_ruta ? urlCuboVideo(pieza.video_ruta, pieza.updated_at) : null;
  const urlPortada = pieza?.portada_ruta ? urlCuboVideo(pieza.portada_ruta, pieza.updated_at) : null;
  const refrescar = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: CLAVE_REELS });
    void qc.invalidateQueries({ queryKey: ["instagram_piezas"] });
  };

  const generar = async () => {
    if (!validacion.ok) return;
    setEncolando(true);
    try {
      const fotos = await prepararFotosReel(qc, validacion.reel);
      const audioRuta = pista ? await subirPistaAudio(pista) : null;
      const segundos = portada.trim() ? Number(portada.replace(",", ".")) : null;
      const r = await encolarRender({
        piezaId: pieza?.estado === "publicada" ? null : piezaId,
        marca: validacion.reel.marca as MarcaId,
        reel: validacion.reel,
        fotos,
        caption: caption.trim() ? caption : null,
        portadaS: segundos !== null && Number.isFinite(segundos) ? segundos : null,
        audioRuta,
      });
      onPiezaId(r.piezaId);
      await qc.invalidateQueries({ queryKey: [...CLAVE_REEL, r.piezaId] });
      void qc.invalidateQueries({ queryKey: CLAVE_REELS });
      toast.success("Vídeo en cola", { description: "Se generará en el equipo de render. Puedes seguir trabajando." });
    } catch (e) {
      toast.error("No se pudo encolar el vídeo", { description: textoErrorVideo(e) });
    } finally {
      setEncolando(false);
    }
  };

  const cancelar = async () => {
    if (!trabajo) return;
    setCancelando(true);
    try {
      await cancelarRender(trabajo.id);
      refrescar();
    } catch (e) {
      toast.error("No se pudo cancelar", { description: textoErrorVideo(e) });
    } finally {
      setCancelando(false);
    }
  };

  const elegirPista = (f: File | null) => {
    if (!f) return setPista(null);
    const r = revisarPista(f.name, f.size);
    if ("motivo" in r) {
      toast.error(r.motivo);
      return;
    }
    setPista(f);
  };

  return (
    <div className={cn("space-y-4", className)} data-testid="panel-video-reel">
      <section className="space-y-2" aria-labelledby="titulo-video-reel">
        <h3 id="titulo-video-reel" className="text-sm font-medium">
          Vídeo MP4
        </h3>

        <details className="rounded-md border p-2 text-xs">
          <summary className="cursor-pointer select-none font-medium">Música y portada</summary>
          <div className="mt-2 space-y-2">
            <p className="text-muted-foreground">
              Sin pista, el vídeo lleva silencio. Instagram no deja poner su música desde aquí: solo una pista propia con licencia.
            </p>
            <input ref={entradaPista} type="file" accept=".m4a,.mp3,.aac,.wav,audio/*" className="hidden" onChange={(e) => elegirPista(e.target.files?.[0] ?? null)} />
            {pista ? (
              <p className="flex items-center gap-1">
                <Music className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{pista.name}</span>
                <Button type="button" size="sm" variant="ghost" className="h-7 px-1" onClick={() => setPista(null)} aria-label="Quitar la pista">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </p>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => entradaPista.current?.click()} className="pointer-coarse:min-h-11">
                <Music className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Añadir pista (M4A, MP3, AAC o WAV)
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Label htmlFor="portada-reel" className="shrink-0">
                Portada en el segundo
              </Label>
              <Input id="portada-reel" inputMode="decimal" placeholder="auto" value={portada} onChange={(e) => setPortada(e.target.value)} className="h-8 w-20" />
            </div>
          </div>
        </details>

        <Button type="button" className="w-full pointer-coarse:min-h-11" onClick={generar} disabled={!b.generar}>
          {encolando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Clapperboard className="mr-2 h-4 w-4" aria-hidden="true" />}
          {encolando ? "Preparando fotos…" : pieza?.video_ruta && reelAlDia ? "Volver a generar el vídeo" : "Generar vídeo"}
        </Button>
        {!validacion.ok && <p className="text-xs text-destructive">Arregla los problemas del reel (en rojo, en el editor) para poder generar el vídeo.</p>}
        {errorEstado && <p className="text-xs text-destructive">{textoErrorVideo(errorEstado)}</p>}

        {visible && (
          <div className="space-y-1.5 rounded-md border p-2 text-xs" role="status" data-testid="estado-render">
            <p className="flex items-center gap-2">
              <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-medium", TONO[visible.tono])}>{visible.etiqueta}</span>
              {visible.detalle && <span className="min-w-0 flex-1 text-muted-foreground">{visible.detalle}</span>}
            </p>
            {visible.progreso !== null && visible.activo && <Progress value={visible.progreso} aria-label="Progreso del vídeo" className="h-1.5" />}
            {trabajo?.estado === "pendiente" && (
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={cancelar} disabled={cancelando}>
                Cancelar
              </Button>
            )}
            {trabajo?.estado === "listo" && !!trabajo.avisos?.length && (
              <ul className="list-disc pl-4 text-amber-700">
                {trabajo.avisos.slice(0, 6).map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {urlVideo && (
          <div className="space-y-1">
            <video
              key={urlVideo}
              src={urlVideo}
              poster={urlPortada ?? undefined}
              controls
              playsInline
              preload="metadata"
              className={cn("mx-auto aspect-[9/16] max-h-80 rounded-md border bg-black", !reelAlDia && "opacity-50")}
              data-testid="video-reel"
            >
              <track kind="captions" />
            </video>
            <p className="text-center text-xs text-muted-foreground">
              {resumenVideo(pieza!)}
              {!reelAlDia && <span className="block text-amber-700">Has cambiado el reel: vuelve a generar el vídeo.</span>}
            </p>
          </div>
        )}
      </section>

      {pieza && (pieza.video_ruta || pieza.estado === "publicada") && (
        <AccionesReel pieza={pieza} reelAlDia={reelAlDia} trabajoActivo={trabajoActivo} caption={caption} onCaption={setCaption} onCambio={refrescar} />
      )}
    </div>
  );
}
