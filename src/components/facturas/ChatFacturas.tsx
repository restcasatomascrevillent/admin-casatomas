import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2, MessageCircle, Bot, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

interface Mensaje {
  id: string;
  rol: "user" | "assistant";
  contenido: string;
  timestamp: Date;
}

const MENSAJE_BIENVENIDA: Mensaje = {
  id: "welcome",
  rol: "assistant",
  contenido: "¡Hola! 👋 Soy tu asistente de facturas. Puedo ayudarte a consultar información sobre tus facturas y albaranes.\n\nPuedes preguntarme cosas como:\n- \"¿Cuánto debo a [proveedor]?\"\n- \"Muéstrame las facturas de enero\"\n- \"¿Cuál fue el último pedido de [producto]?\"",
  timestamp: new Date(),
};

export function ChatFacturas() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([MENSAJE_BIENVENIDA]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Auto-scroll al último mensaje
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensajes]);

  const enviarMensaje = async () => {
    const textoMensaje = input.trim();
    if (!textoMensaje || isLoading) return;

    // Añadir mensaje del usuario
    const mensajeUsuario: Mensaje = {
      id: crypto.randomUUID(),
      rol: "user",
      contenido: textoMensaje,
      timestamp: new Date(),
    };

    setMensajes((prev) => [...prev, mensajeUsuario]);
    setInput("");
    setIsLoading(true);

    try {
      // Preparar historial para el webhook
      const historial = mensajes
        .filter((m) => m.id !== "welcome")
        .map((m) => ({
          rol: m.rol,
          contenido: m.contenido,
        }));

      const { data, error } = await supabase.functions.invoke("chat-facturas", {
        body: {
          mensaje: textoMensaje,
          historial,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      // Añadir respuesta del asistente
      const mensajeAsistente: Mensaje = {
        id: crypto.randomUUID(),
        rol: "assistant",
        contenido: data?.respuesta || "Lo siento, no pude procesar tu consulta. Intenta de nuevo.",
        timestamp: new Date(),
      };

      setMensajes((prev) => [...prev, mensajeAsistente]);
    } catch (error) {
      console.error("Error en chat:", error);
      toast({
        title: "Error",
        description: "No se pudo enviar el mensaje. Intenta de nuevo.",
        variant: "destructive",
      });

      // Añadir mensaje de error
      const mensajeError: Mensaje = {
        id: crypto.randomUUID(),
        rol: "assistant",
        contenido: "⚠️ Hubo un problema al procesar tu consulta. Por favor, intenta de nuevo más tarde.",
        timestamp: new Date(),
      };
      setMensajes((prev) => [...prev, mensajeError]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarMensaje();
    }
  };

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
      <CardContent className="flex-1 flex flex-col min-h-0">
        {/* Área de mensajes */}
        <ScrollArea className="flex-1 pr-4 mb-4">
          <div className="space-y-4">
            {mensajes.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-3",
                  msg.rol === "user" ? "flex-row-reverse" : "flex-row"
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    msg.rol === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                >
                  {msg.rol === "user" ? (
                    <User className="h-4 w-4" />
                  ) : (
                    <Bot className="h-4 w-4" />
                  )}
                </div>
                <div
                  className={cn(
                    "rounded-lg px-4 py-3 max-w-[80%]",
                    msg.rol === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                >
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{msg.contenido}</ReactMarkdown>
                  </div>
                  <p
                    className={cn(
                      "text-xs mt-2",
                      msg.rol === "user"
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground"
                    )}
                  >
                    {msg.timestamp.toLocaleTimeString("es-ES", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-lg px-4 py-3 bg-muted">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">
                      Pensando...
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        {/* Input de mensaje */}
        <div className="flex gap-2 pt-2 border-t">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu pregunta..."
            disabled={isLoading}
            className="min-h-[60px] resize-none"
            rows={2}
          />
          <Button
            onClick={enviarMensaje}
            disabled={isLoading || !input.trim()}
            size="icon"
            className="h-auto"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
