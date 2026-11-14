import { ExternalLink } from "lucide-react";
import { ImagenZoom } from "./ImagenZoom";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export const ENLACE_ORIGINAL =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/40 dark:hover:text-blue-300";

/**
 * Visor a pantalla completa: la imagen (foto del original o una hoja de un PDF)
 * con zoom (rueda, pellizco, arrastre, giro) a todo el alto del diálogo.
 */
export function VisorPantallaCompleta({
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
            <a href={url} target="_blank" rel="noopener noreferrer" className={ENLACE_ORIGINAL}>
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
