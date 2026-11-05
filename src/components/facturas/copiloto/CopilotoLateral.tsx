// «Pregúntale a la IA»: el copiloto PLEGADO en un panel lateral que sale por la
// derecha (~360 px; en móvil, a pantalla completa). Cabecera con Historial y
// Cerrar; dentro, las sugerencias, las respuestas y la caja para preguntar.
//
// No es modal: el tablero sigue a la vista y se puede tocar con el panel
// abierto (tocar fuera no lo cierra; se cierra con «Cerrar» o Escape).
import { ArrowLeft, History, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { Conversacion, MensajeChat } from "@/hooks/useChatFacturas";
import type { GraficaIa } from "@/lib/facturas/graficasCopiloto";
import { ConversacionesList } from "../ConversacionesList";
import { PanelCopiloto } from "./PanelCopiloto";

const BOTON = cn(
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);

interface Props {
  abierto: boolean;
  onAbiertoCambia: (abierto: boolean) => void;
  verHistorial: boolean;
  onVerHistorial: (v: boolean) => void;
  conversaciones: Conversacion[];
  conversacionActiva: Conversacion | null;
  onSeleccionarConversacion: (c: Conversacion) => void;
  onNuevaConversacion: () => void;
  onEliminarConversacion: (id: string) => void;
  mensajes: MensajeChat[];
  isLoading: boolean;
  isSending: boolean;
  sugerencias: string[];
  onEnviar: (texto: string) => void;
  onRegenerar?: () => void;
  fijadas: ReadonlySet<string>;
  onFijar: (g: GraficaIa) => void;
  onQuitarFijada: (id: string) => void;
}

export function CopilotoLateral({
  abierto,
  onAbiertoCambia,
  verHistorial,
  onVerHistorial,
  conversaciones,
  conversacionActiva,
  onSeleccionarConversacion,
  onNuevaConversacion,
  onEliminarConversacion,
  ...panel
}: Props) {
  return (
    <Sheet open={abierto} onOpenChange={onAbiertoCambia} modal={false}>
      <SheetContent
        side="right"
        // Sin la X de serie (la cabecera ya trae «Cerrar» a 44 px) y sin padding: el hilo va a sangre.
        className="flex w-full max-w-none flex-col gap-0 p-0 sm:w-[360px] sm:max-w-[360px] [&>button.absolute]:hidden"
        id="copiloto-lateral"
        onInteractOutside={(e) => e.preventDefault()}
        data-tour="facturas-ia-panel"
      >
        <SheetHeader className="flex shrink-0 flex-row items-center gap-1 space-y-0 border-b border-border/60 py-1 pl-4 pr-1 text-left pointer-coarse:pr-1">
          {verHistorial && (
            <button type="button" className={BOTON} onClick={() => onVerHistorial(false)} aria-label="Volver a la conversación">
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          <SheetTitle className="min-w-0 flex-1 truncate text-base font-medium">
            {verHistorial ? "Historial" : "Pregúntale a la IA"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Preguntas sobre tus compras a la IA. El tablero sigue a la vista.
          </SheetDescription>
          {!verHistorial && (
            <button type="button" className={BOTON} onClick={() => onVerHistorial(true)} data-tour="facturas-ia-historial">
              <History className="h-4 w-4" aria-hidden />
              Historial
              {conversaciones.length > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-xs font-semibold leading-5 text-muted-foreground">{conversaciones.length}</span>
              )}
            </button>
          )}
          <SheetClose asChild>
            <button type="button" className={BOTON} aria-label="Cerrar">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </SheetClose>
        </SheetHeader>
        {verHistorial ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ConversacionesList
              conversaciones={conversaciones}
              conversacionActiva={conversacionActiva}
              onSeleccionar={onSeleccionarConversacion}
              onNueva={onNuevaConversacion}
              onEliminar={onEliminarConversacion}
            />
          </div>
        ) : (
          <PanelCopiloto {...panel} />
        )}
      </SheetContent>
    </Sheet>
  );
}
