import type { ReactNode } from "react";
import { Check, Image as ImageIcon, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { temasDisponibles } from "../composicionCarta";
import { ESTILO_DAMERO, textoProgreso, type FotoCarta } from "./useRecorteVino";

interface Props {
  recorte: FotoCarta;
  /** Botones superpuestos (cambiar / quitar foto). */
  superpuesto?: ReactNode;
  alt?: string;
}

const TEMAS_LISTA = temasDisponibles();

/**
 * Foto de producto de la carta tras elegirla: se recorta sola, se enseña el
 * sticker sobre damero y debajo las muestras de FONDO (los temas de la carta);
 * al tocar una se ve al momento la foto con ese fondo. Selector «Sticker |
 * Con fondo», «Usar foto original» y «Repetir recorte».
 */
export function SelectorFotoCarta({ recorte, superpuesto, alt = "Foto del producto" }: Props) {
  const { estado, eleccion, vista, urls, tema, tipo } = recorte;
  const listo = estado.fase === "listo";
  const usaCarta = listo && eleccion === "carta";
  const verSticker = usaCarta && (vista === "sticker" || !urls.carta);
  const src = usaCarta ? (verSticker ? urls.sticker : urls.carta) : urls.original;

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "relative mx-auto w-full max-w-xs overflow-hidden rounded-lg border bg-muted",
          tipo === "plato" ? "aspect-[4/3]" : "h-64",
        )}
        style={verSticker ? ESTILO_DAMERO : undefined}
      >
        {src && (
          <img
            src={src}
            alt={alt}
            className={cn("h-full w-full object-contain", (estado.fase === "trabajando" || recorte.trabajando) && "opacity-60")}
          />
        )}
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

      {usaCarta && (
        <div role="radiogroup" aria-label="Vista de la foto" className="mx-auto grid max-w-xs grid-cols-2 rounded-md border p-0.5 text-sm">
          {(
            [
              ["sticker", "Sticker"],
              ["fondo", "Con fondo"],
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

      {listo && (
        <div>
          <p className="mb-1 text-center text-xs font-medium text-muted-foreground">Fondo</p>
          <div role="radiogroup" aria-label="Fondo de la foto" className="flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:justify-center">
            {TEMAS_LISTA.map((t) => {
              const activo = usaCarta && tema === t.clave;
              return (
                <button
                  key={t.clave}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  onClick={() => recorte.setTema(t.clave)}
                  className="flex w-16 shrink-0 flex-col items-center gap-1 rounded-md p-1 text-[11px] pointer-coarse:text-xs leading-tight hover:bg-muted"
                >
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-full border shadow-sm",
                      activo && "ring-2 ring-primary ring-offset-2",
                    )}
                    style={{ backgroundColor: t.color }}
                  >
                    {activo && <Check className="h-4 w-4 text-black/60" />}
                  </span>
                  <span className={cn("text-center", activo ? "font-medium text-foreground" : "text-muted-foreground")}>{t.nombre}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {estado.fase === "fallo" && <p className="text-center text-xs text-muted-foreground">{estado.aviso}</p>}

      {(listo || estado.fase === "fallo") && (
        <div className="flex flex-wrap justify-center gap-2">
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

/** Nombre antiguo (formularios de vino). */
export const VistaRecorteVino = SelectorFotoCarta;
