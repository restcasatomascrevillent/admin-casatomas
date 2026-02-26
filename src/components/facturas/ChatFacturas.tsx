import { forwardRef, useImperativeHandle } from "react";
import { useChatFacturas } from "@/hooks/useChatFacturas";
import { ConversacionesList } from "./ConversacionesList";
import { ChatArea } from "./ChatArea";

export interface ChatFacturasRef {
  enviarConsulta: (texto: string) => void;
}

export const ChatFacturas = forwardRef<ChatFacturasRef>((props, ref) => {
  const {
    conversaciones,
    conversacionActiva,
    mensajes,
    isLoading,
    isSending,
    seleccionarConversacion,
    nuevaConversacion,
    enviarMensaje,
    eliminarConversacion,
  } = useChatFacturas();

  useImperativeHandle(ref, () => ({
    enviarConsulta: (texto: string) => {
      enviarMensaje(texto);
    }
  }));

  return (
    // Altura del 100% real sin max-h limitante si está en una pestaña, ya que el contenedor padre controla el alto.
    // Se ha eliminado el div con el "Header Premium" a petición del usuario para ganar espacio útil de pantalla.
    <div className="flex flex-col h-full w-full bg-card overflow-hidden">
      {/* Body: área a pantalla completa con las dos sub-columnas (Historial / Chat) */}
      <div className="flex-1 flex min-h-0 bg-background border border-border/50 rounded-lg overflow-hidden shadow-sm">

        {/* Panel lateral conversaciones - En full screen se hace un poco más ancho por comodidad */}
        <div className="w-64 shrink-0 hidden md:block border-r border-border/60 bg-muted/10">
          <ConversacionesList
            conversaciones={conversaciones}
            conversacionActiva={conversacionActiva}
            onSeleccionar={seleccionarConversacion}
            onNueva={nuevaConversacion}
            onEliminar={eliminarConversacion}
          />
        </div>

        {/* Área interactiva del chat envuelta para centrar el contenido (maxWidth de lectura) si es muy ancho */}
        <div className="flex-1 flex justify-center bg-background">
          <div className="w-full max-w-4xl flex flex-col h-full bg-card/50">
            <ChatArea
              mensajes={mensajes}
              isLoading={isLoading}
              isSending={isSending}
              onEnviar={enviarMensaje}
              tieneConversacion={!!conversacionActiva}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

ChatFacturas.displayName = "ChatFacturas";
