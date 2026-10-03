import { forwardRef, useImperativeHandle, useState } from "react";
import { useChatFacturas } from "@/hooks/useChatFacturas";
import { ConversacionesList } from "./ConversacionesList";
import { ChatArea, Sugerencia } from "./ChatArea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";

export interface ChatFacturasRef {
  enviarConsulta: (texto: string) => void;
}

interface ChatFacturasProps {
  sugerencias?: Sugerencia[];
}

export const ChatFacturas = forwardRef<ChatFacturasRef, ChatFacturasProps>(({ sugerencias }, ref) => {
  const {
    conversaciones,
    conversacionActiva,
    mensajes,
    isLoading,
    isSending,
    seleccionarConversacion,
    nuevaConversacion,
    enviarMensaje,
    regenerarRespuesta,
    eliminarConversacion,
  } = useChatFacturas();

  const [sheetOpen, setSheetOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    enviarConsulta: (texto: string) => {
      enviarMensaje(texto);
    },
  }));

  return (
    // Altura del 100% real sin max-h limitante si está en una pestaña.
    <div className="flex flex-col h-full w-full bg-card overflow-hidden">
      {/* Body: área a pantalla completa con las dos sub-columnas (Historial / Chat) */}
      <div className="flex-1 flex min-h-0 bg-background border border-border/50 rounded-lg overflow-hidden shadow-sm">

        {/* Panel lateral conversaciones — solo desde 1280 px. Entre 768 y 1279 px el menú de la
            app ya se lleva 16rem y un segundo panel de 16rem dejaba ~200 px al chat. */}
        <div className="w-64 shrink-0 hidden xl:block border-r border-border/60 bg-muted/10">
          <ConversacionesList
            conversaciones={conversaciones}
            conversacionActiva={conversacionActiva}
            onSeleccionar={seleccionarConversacion}
            onNueva={nuevaConversacion}
            onEliminar={eliminarConversacion}
          />
        </div>

        {/* Área interactiva del chat */}
        <div className="flex-1 flex flex-col min-h-0">

          {/* Barra superior móvil con botón de historial (Sheet drawer) */}
          <div className="flex xl:hidden items-center gap-2 px-3 py-1 shrink-0 border-b border-border/40">
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-sm text-muted-foreground hover:text-foreground h-11"
                >
                  <History className="h-4 w-4" />
                  Historial
                  {conversaciones.length > 0 && (
                    <span className="rounded-full bg-muted text-muted-foreground text-xs font-semibold px-2 py-0.5 leading-none">
                      {conversaciones.length}
                    </span>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <SheetHeader className="px-4 py-3 border-b border-border/50">
                  <SheetTitle className="text-sm">Historial de conversaciones</SheetTitle>
                </SheetHeader>
                <ConversacionesList
                  conversaciones={conversaciones}
                  conversacionActiva={conversacionActiva}
                  onSeleccionar={(conv) => {
                    seleccionarConversacion(conv);
                    setSheetOpen(false);
                  }}
                  onNueva={() => {
                    nuevaConversacion();
                    setSheetOpen(false);
                  }}
                  onEliminar={eliminarConversacion}
                />
              </SheetContent>
            </Sheet>
          </div>

          {/* Chat principal — ocupa el espacio restante */}
          <div className="flex-1 flex justify-center bg-background min-h-0">
            <div className="w-full max-w-4xl flex flex-col h-full bg-card/50">
              <ChatArea
                mensajes={mensajes}
                isLoading={isLoading}
                isSending={isSending}
                sugerencias={sugerencias}
                onEnviar={enviarMensaje}
                onRegenerar={regenerarRespuesta}
                tieneConversacion={!!conversacionActiva}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

ChatFacturas.displayName = "ChatFacturas";
