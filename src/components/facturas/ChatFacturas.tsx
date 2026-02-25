import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageCircle } from "lucide-react";
import { useChatFacturas } from "@/hooks/useChatFacturas";
import { ConversacionesList } from "./ConversacionesList";
import { ChatArea } from "./ChatArea";

export function ChatFacturas() {
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

  return (
    <Card className="flex flex-col h-[600px]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          Asistente de Facturas
        </CardTitle>
        <CardDescription>
          Pregunta sobre tus facturas, proveedores o importes
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex min-h-0 p-0">
        {/* Lista de conversaciones */}
        <div className="w-64 shrink-0 hidden md:block">
          <ConversacionesList
            conversaciones={conversaciones}
            conversacionActiva={conversacionActiva}
            onSeleccionar={seleccionarConversacion}
            onNueva={nuevaConversacion}
            onEliminar={eliminarConversacion}
          />
        </div>

        {/* Área de chat */}
        <ChatArea
          mensajes={mensajes}
          isLoading={isLoading}
          isSending={isSending}
          onEnviar={enviarMensaje}
          tieneConversacion={!!conversacionActiva}
        />
      </CardContent>
    </Card>
  );
}
