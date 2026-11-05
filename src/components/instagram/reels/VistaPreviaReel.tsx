import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  ALTO_REEL,
  ANCHO_REEL,
  FPS_REEL,
  ReelEnInstante,
  calcularTiempos,
  formatearSegundos,
  type ReelPieza,
  type ResolverFoto,
} from "@/lib/instagram/reels";

export interface ControlVistaPreviaReel {
  /** Lleva la vista previa al instante t (en segundos) y la deja en pausa. */
  irA(t: number): void;
  reproducir(): void;
  pausar(): void;
}

export interface VistaPreviaReelProps {
  reel: ReelPieza;
  /** id de foto → URL. Por defecto solo resuelve las fotos de muestra. */
  urlFoto?: ResolverFoto;
  /** Base de fuentes, logos y muestras (por defecto "/instagram"). */
  baseRecursos?: string;
  /** Empieza a reproducir al montar (por defecto, no). */
  reproducirAlMontar?: boolean;
  /** Vuelve al principio al acabar (por defecto, sí). */
  bucle?: boolean;
  /** Recuadro de la zona segura encendido al empezar (por defecto, sí). */
  zonaSeguraInicial?: boolean;
  /** Instante al montar (por defecto 1,5 s: el reel empieza fundido en negro). */
  instanteInicial?: number;
  /** Se llama cuando cambia el instante (al reproducir, ~60 veces por segundo). */
  onInstante?: (t: number) => void;
  className?: string;
}

/**
 * Reproductor del reel en un marco 9:16: play/pausa, barra de tiempo (paso de
 * un fotograma, 1/30 s) y zona segura conmutable. Lo único que hace es mover
 * t: lo que se ve es ReelEnInstante(reel, t), el mismo componente puro que
 * capturará el render. Ocupa el alto que le dé el padre (h-full) y escala el
 * lienzo de 1080×1920 para que quepa: sin scroll.
 */
export const VistaPreviaReel = forwardRef<ControlVistaPreviaReel, VistaPreviaReelProps>(function VistaPreviaReel(
  { reel, urlFoto, baseRecursos = "/instagram", reproducirAlMontar = false, bucle = true, zonaSeguraInicial = true, instanteInicial = 1.5, onInstante, className },
  ref,
) {
  const total = calcularTiempos(reel).total;
  const [t, setT] = useState(() => Math.min(Math.max(instanteInicial, 0), total));
  const [reproduciendo, setReproduciendo] = useState(reproducirAlMontar);
  const [zonaSegura, setZonaSegura] = useState(zonaSeguraInicial);
  const [escala, setEscala] = useState(0.2);
  const hueco = useRef<HTMLDivElement>(null);
  const idZona = useId();
  const tRef = useRef(t);
  const totalRef = useRef(total);
  totalRef.current = total;

  const fijar = useCallback(
    (nuevo: number) => {
      const v = Math.min(Math.max(nuevo, 0), totalRef.current);
      tRef.current = v;
      setT(v);
      onInstante?.(v);
    },
    [onInstante],
  );

  useImperativeHandle(
    ref,
    () => ({
      irA: (v: number) => {
        setReproduciendo(false);
        fijar(v);
      },
      reproducir: () => setReproduciendo(true),
      pausar: () => setReproduciendo(false),
    }),
    [fijar],
  );

  // Si el reel se acorta, el instante no puede quedar fuera.
  useEffect(() => {
    if (tRef.current > total) fijar(total);
  }, [total, fijar]);

  // Bucle de reproducción: solo avanza t (el reloj vive aquí, no en el kit).
  useEffect(() => {
    if (!reproduciendo || typeof requestAnimationFrame === "undefined") return;
    let id = 0;
    let anterior: number | null = null;
    const paso = (ahora: number) => {
      if (anterior !== null) {
        let siguiente = tRef.current + (ahora - anterior) / 1000;
        if (siguiente >= totalRef.current) {
          if (bucle) siguiente = 0;
          else {
            fijar(totalRef.current);
            setReproduciendo(false);
            return;
          }
        }
        fijar(siguiente);
      }
      anterior = ahora;
      id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [reproduciendo, bucle, fijar]);

  // Escala del lienzo para que quepa entero en el hueco disponible.
  useLayoutEffect(() => {
    const el = hueco.current;
    if (!el) return;
    const medir = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setEscala(Math.min(width / ANCHO_REEL, height / ALTO_REEL));
    };
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const alternar = () => {
    if (!reproduciendo && tRef.current >= total) fijar(0);
    setReproduciendo((r) => !r);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2", className)}>
      <div ref={hueco} className="relative flex min-h-0 flex-1 items-center justify-center">
        <div
          className="relative overflow-hidden rounded-xl bg-black shadow-md"
          style={{ width: ANCHO_REEL * escala, height: ALTO_REEL * escala }}
          role="img"
          aria-label={`Vista previa del reel en el segundo ${formatearSegundos(t)}`}
        >
          <div style={{ width: ANCHO_REEL, height: ALTO_REEL, transform: `scale(${escala})`, transformOrigin: "0 0" }}>
            <ReelEnInstante reel={reel} t={t} urlFoto={urlFoto} baseRecursos={baseRecursos} zonaSegura={zonaSegura} />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Button type="button" size="icon" variant="outline" onClick={alternar} aria-label={reproduciendo ? "Pausar" : "Reproducir"}>
            {reproduciendo ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => {
              setReproduciendo(false);
              fijar(0);
            }}
            aria-label="Volver al principio"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <input
            type="range"
            min={0}
            max={total}
            step={1 / FPS_REEL}
            value={t}
            onChange={(e) => {
              setReproduciendo(false);
              fijar(Number(e.target.value));
            }}
            aria-label="Instante del reel"
            className="h-9 min-w-0 flex-1 cursor-pointer accent-primary"
          />
          <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground" aria-live="off">
            {formatearSegundos(t).replace(" s", "")} / {formatearSegundos(total)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>9:16 · {FPS_REEL} fps</span>
          <div className="flex items-center gap-2">
            <Switch id={idZona} checked={zonaSegura} onCheckedChange={setZonaSegura} />
            <Label htmlFor={idZona} className="text-xs font-normal">
              Zona segura
            </Label>
          </div>
        </div>
      </div>
    </div>
  );
});
