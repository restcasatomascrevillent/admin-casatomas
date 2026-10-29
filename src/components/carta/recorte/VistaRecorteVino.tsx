import type { ReactNode } from "react";
import { Image as ImageIcon, Loader2, RotateCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ESTILO_DAMERO, textoProgreso, type RecorteVino } from "./useRecorteVino";

interface Props {
  recorte: RecorteVino;
  /** Botones superpuestos (cambiar / quitar foto). */
  superpuesto?: ReactNode;
  alt?: string;
}

/**
 * Vista de la foto tras hacerla: primero el sticker (botella recortada sobre
 * damero, etiqueta «Recorte») y luego, solo, «Con fondo de carta». Selector
 * «Sticker | Con fondo de carta» y botones «Usar fondo de carta» (por defecto),
 * «Usar foto original» y «Repetir recorte».
 */
export function VistaRecorteVino({ recorte, superpuesto, alt = "Foto de la botella" }: Props) {
  const { estado, eleccion, vista, urls } = recorte;
  const listo = estado.fase === "listo";
  const verSticker = listo && eleccion === "carta" && vista === "sticker";
  const src = listo && eleccion === "carta" ? (vista === "sticker" ? urls.sticker : urls.carta) : urls.original;

  return (
    <div className="space-y-2">
      <div
        className="relative mx-auto h-64 w-full max-w-xs overflow-hidden rounded-lg border bg-muted"
        style={verSticker ? ESTILO_DAMERO : undefined}
      >
        {src && <img src={src} alt={alt} className={cn("h-full w-full object-contain", estado.fase === "trabajando" && "opacity-60")} />}
        {verSticker && (
          <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-medium text-white">Recorte</span>
        )}
        {estado.fase === "trabajando" && (
          <div className="absolute inset-x-2 bottom-2 rounded-md bg-background/90 p-2 text-xs shadow" role="status" aria-live="polite">
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              {textoProgreso(estado.progreso)}
            </span>
            {estado.progreso?.fase === "descargando" && (
              <span className="mt-1 block h-1.5 overflow-hidden rounded bg-muted">
                <span className="block h-full bg-primary transition-[width]" style={{ width: `${estado.progreso.pct}%` }} />
              </span>
            )}
          </div>
        )}
        {superpuesto}
      </div>

      {listo && eleccion === "carta" && (
        <div role="radiogroup" aria-label="Vista de la foto" className="mx-auto grid max-w-xs grid-cols-2 rounded-md border p-0.5 text-sm">
          {(
            [
              ["sticker", "Sticker"],
              ["fondo", "Con fondo de carta"],
            ] as const
          ).map(([v, texto]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={vista === v}
              onClick={() => recorte.setVista(v)}
              className={cn(
                "h-9 rounded px-2 transition-colors",
                vista === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {texto}
            </button>
          ))}
        </div>
      )}

      {estado.fase === "fallo" && <p className="text-center text-xs text-muted-foreground">{estado.aviso}</p>}

      {(listo || estado.fase === "fallo") && (
        <div className="flex flex-wrap justify-center gap-2">
          {listo && (
            <Button
              type="button"
              size="sm"
              className="h-10"
              variant={eleccion === "carta" ? "default" : "outline"}
              aria-pressed={eleccion === "carta"}
              onClick={() => recorte.setEleccion("carta")}
            >
              <Sparkles className="mr-1.5 h-4 w-4" />
              Usar fondo de carta
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-10"
            variant={eleccion === "original" && listo ? "default" : "outline"}
            aria-pressed={eleccion === "original"}
            onClick={() => recorte.setEleccion("original")}
            disabled={!listo}
          >
            <ImageIcon className="mr-1.5 h-4 w-4" />
            Usar foto original
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-10" onClick={recorte.repetir}>
            <RotateCw className="mr-1.5 h-4 w-4" />
            Repetir recorte
          </Button>
        </div>
      )}
    </div>
  );
}
