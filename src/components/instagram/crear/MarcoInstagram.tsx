import type { ReactNode } from "react";
import { Bookmark, ChevronLeft, ChevronRight, Heart, MessageCircle, MoreHorizontal, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { baseRecursosPanel, urlRecurso, type MarcaId } from "@/lib/instagram";
import type { FormatoMontado } from "@/lib/instagram/montar";
import { NOMBRE_MARCA_CORTO } from "@/components/marketing/instagram/HistorialPiezas";

const LOGO: Record<MarcaId, string> = {
  "casa-tomas": "logos/casa-tomas-medallon-negro.png",
  touza: "logos/touza-cruz-tau-negro.png",
};

interface Props {
  marca: MarcaId;
  formato: FormatoMontado;
  /** Cuántas imágenes hay (carrusel: 2–10). */
  total: number;
  actual: number;
  onActual: (i: number) => void;
  /** La imagen que se ve (vista previa de la pieza o la foto tal cual). */
  children: ReactNode;
  /** Primeras líneas del texto, como las enseña Instagram bajo la foto. */
  caption?: string;
  /** Ancho del marco en px (la altura sale de la proporción). */
  ancho: number;
}

/**
 * Marco de móvil con la interfaz de Instagram alrededor de la publicación:
 * cabecera con la cuenta, la imagen (con flechas y puntos si es un
 * carrusel), las acciones y el principio del texto. Las stories van a
 * pantalla completa, sin texto.
 */
export function MarcoInstagram({ marca, formato, total, actual, onActual, children, caption, ancho }: Props) {
  const story = formato === "story";
  const carrusel = total > 1;
  const nombre = NOMBRE_MARCA_CORTO[marca];
  const logo = urlRecurso(baseRecursosPanel(), LOGO[marca]);
  const anterior = () => onActual(Math.max(0, actual - 1));
  const siguiente = () => onActual(Math.min(total - 1, actual + 1));

  return (
    <figure
      className="mx-auto overflow-hidden rounded-[1.6rem] border-[6px] border-neutral-900 bg-white text-neutral-900 shadow-md"
      style={{ width: ancho }}
      aria-label={`Vista previa en Instagram${carrusel ? `: imagen ${actual + 1} de ${total}` : ""}`}
      data-testid="marco-instagram"
    >
      {!story && (
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <img src={logo} alt="" className="h-7 w-7 rounded-full bg-white object-contain ring-1 ring-neutral-200" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{nombre}</span>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </div>
      )}

      <div
        className={cn("relative bg-neutral-100", story ? "aspect-[9/16]" : "aspect-[4/5]")}
        onKeyDown={(e) => {
          if (!carrusel) return;
          if (e.key === "ArrowLeft") anterior();
          if (e.key === "ArrowRight") siguiente();
        }}
      >
        {children}
        {story && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/40 to-transparent p-2 text-xs font-semibold text-white" aria-hidden="true">
            <img src={logo} alt="" className="h-6 w-6 rounded-full bg-white object-contain" />
            {nombre}
          </div>
        )}
        {carrusel && (
          <>
            <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-neutral-900/75 px-2 py-0.5 text-xs font-medium text-white" aria-hidden="true">
              {actual + 1}/{total}
            </span>
            {actual > 0 && (
              <BotonFlecha lado="izquierda" onClick={anterior} etiqueta="Imagen anterior">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </BotonFlecha>
            )}
            {actual < total - 1 && (
              <BotonFlecha lado="derecha" onClick={siguiente} etiqueta="Imagen siguiente">
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </BotonFlecha>
            )}
          </>
        )}
      </div>

      {!story && (
        <div className="space-y-1 px-2.5 pb-2.5 pt-1.5">
          <div className="relative flex items-center gap-3">
            <Heart className="h-5 w-5" aria-hidden="true" />
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
            <Send className="h-5 w-5" aria-hidden="true" />
            {carrusel && (
              <span className="absolute left-1/2 flex -translate-x-1/2 gap-1" aria-hidden="true" data-testid="puntos-carrusel">
                {Array.from({ length: total }, (_, i) => (
                  <i key={i} className={cn("block h-1.5 w-1.5 rounded-full", i === actual ? "bg-sky-500" : "bg-neutral-300")} />
                ))}
              </span>
            )}
            <Bookmark className="ml-auto h-5 w-5" aria-hidden="true" />
          </div>
          <p className="line-clamp-2 text-xs leading-snug">
            <b className="mr-1">{nombre}</b>
            {caption?.trim() || <span className="text-neutral-600">Aquí irá el texto de la publicación.</span>}
          </p>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {carrusel ? `Imagen ${actual + 1} de ${total}` : ""}
      </p>
    </figure>
  );
}

function BotonFlecha({ lado, onClick, etiqueta, children }: { lado: "izquierda" | "derecha"; onClick: () => void; etiqueta: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      className={cn(
        "group absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center focus-visible:outline-none",
        lado === "izquierda" ? "left-0" : "right-0",
      )}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow group-hover:bg-white group-focus-visible:ring-2 group-focus-visible:ring-sky-500">
        {children}
      </span>
    </button>
  );
}
