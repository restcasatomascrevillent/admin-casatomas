import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Zap, FileText, BarChart3, Package, Copy, Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import type { MensajeChat } from "@/hooks/useChatFacturas";

export interface Sugerencia {
  icon: React.ElementType;
  texto: string;
}

const SUGERENCIAS_DEFAULT: Sugerencia[] = [
  { icon: FileText, texto: "¿Cuáles son las últimas facturas recibidas?" },
  { icon: BarChart3, texto: "¿Cuánto hemos gastado este mes?" },
  { icon: Package, texto: "¿Qué facturas hay pendientes de pago?" },
  { icon: Zap, texto: "Resume los albaranes de esta semana" },
];

interface ChatAreaProps {
  mensajes: MensajeChat[];
  isLoading: boolean;
  isSending: boolean;
  sugerencias?: Sugerencia[];
  onEnviar: (texto: string) => void;
  onRegenerar?: () => void;
  tieneConversacion: boolean;
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-1">
      <span
        className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce"
        style={{ animationDelay: "0ms", animationDuration: "1s" }}
      />
      <span
        className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce"
        style={{ animationDelay: "180ms", animationDuration: "1s" }}
      />
      <span
        className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce"
        style={{ animationDelay: "360ms", animationDuration: "1s" }}
      />
    </div>
  );
}

// ─── Botón de copiar con feedback visual ──────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback si el clipboard no está disponible
    }
  };

  return (
    <button
      onClick={handleCopy}
      title={copied ? "¡Copiado!" : "Copiar respuesta"}
      className={cn(
        "flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium transition-all duration-150",
        copied
          ? "text-emerald-500 bg-emerald-500/10"
          : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/60"
      )}
    >
      {copied ? (
        <Check className="h-3 w-3" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

export function ChatArea({
  mensajes,
  isLoading,
  isSending,
  sugerencias,
  onEnviar,
  onRegenerar,
  tieneConversacion,
}: ChatAreaProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const listaSugerencias = sugerencias && sugerencias.length > 0 ? sugerencias : SUGERENCIAS_DEFAULT;

  // Índice del último mensaje del asistente (para mostrar el botón de regenerar)
  const lastAssistantIndex = mensajes.reduce<number>(
    (last, msg, i) => (msg.rol === "assistant" ? i : last),
    -1
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensajes, isSending]);

  const handleSend = () => {
    if (!input.trim() || isSending) return;
    onEnviar(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSugerencia = (texto: string) => {
    if (isSending) return;
    onEnviar(texto);
  };

  // ─── Estado vacío (sin mensajes) ──────────────────────────────────────────
  if (mensajes.length === 0 && !isSending) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6 overflow-y-auto">
          {/* Icono central */}
          <div className="flex flex-col items-center gap-3 text-center">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{
                background: "linear-gradient(135deg, hsl(206 11% 22%), hsl(206 11% 30%))",
                boxShadow: "0 8px 24px hsl(206 11% 15% / 0.25)",
              }}
            >
              <Bot className="h-8 w-8 text-white" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">¿En qué puedo ayudarte?</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pregunta sobre tus facturas, albaranes o proveedores
              </p>
            </div>
          </div>

          {/* Sugerencias (dinámicas o por defecto) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-sm">
            {listaSugerencias.map(({ icon: Icon, texto }) => (
              <button
                key={texto}
                onClick={() => handleSugerencia(texto)}
                disabled={isSending}
                className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-card p-3 text-left text-xs text-muted-foreground hover:border-[hsl(38,59%,45%)] hover:text-foreground hover:shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5 group-hover:text-[hsl(38,59%,45%)] transition-colors" />
                <span className="leading-snug">{texto}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Input inferior */}
        <InputBar
          input={input}
          setInput={setInput}
          isSending={isSending}
          onSend={handleSend}
          onKeyDown={handleKeyDown}
        />
      </div>
    );
  }

  // ─── Chat con mensajes ──────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="space-y-5">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <TypingDots />
            </div>
          ) : (
            mensajes.map((msg, index) => {
              const isUser = msg.rol === "user";
              const isLastAssistant = !isUser && index === lastAssistantIndex;

              return (
                <div
                  key={msg.id}
                  className={cn(
                    "flex gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300",
                    isUser ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2",
                      isUser
                        ? "ring-[hsl(38,59%,45%)/0.3]"
                        : "ring-border/60"
                    )}
                    style={
                      isUser
                        ? { background: "linear-gradient(135deg, hsl(38 59% 45%), hsl(38 59% 38%))" }
                        : { background: "linear-gradient(135deg, hsl(206 11% 28%), hsl(206 11% 22%))" }
                    }
                  >
                    {isUser ? (
                      <User className="h-3.5 w-3.5 text-white" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 text-white" />
                    )}
                  </div>

                  {/* Burbuja + acciones */}
                  <div className={cn("flex flex-col gap-1 max-w-[78%]", isUser ? "items-end" : "items-start")}>
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-2.5 shadow-sm",
                        isUser
                          ? "rounded-tr-sm text-white"
                          : "rounded-tl-sm bg-muted/60 text-foreground border border-border/40"
                      )}
                      style={
                        isUser
                          ? { background: "linear-gradient(135deg, hsl(38 59% 45%), hsl(38 59% 38%))" }
                          : undefined
                      }
                    >
                      <div
                        className={cn(
                          "prose prose-sm max-w-none",
                          isUser ? "prose-invert" : "dark:prose-invert"
                        )}
                      >
                        <ReactMarkdown>{msg.contenido}</ReactMarkdown>
                      </div>
                      <p
                        className={cn(
                          "text-[10px] mt-1.5 text-right",
                          isUser ? "text-white/60" : "text-muted-foreground/60"
                        )}
                      >
                        {new Date(msg.created_at).toLocaleTimeString("es-ES", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>

                    {/* Acciones bajo el mensaje del asistente */}
                    {!isUser && (
                      <div className="flex items-center gap-1 pl-1">
                        <CopyButton text={msg.contenido} />

                        {/* Botón regenerar solo en el último mensaje del asistente */}
                        {isLastAssistant && onRegenerar && !isSending && (
                          <button
                            onClick={onRegenerar}
                            title="Regenerar respuesta"
                            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/60 transition-all duration-150"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Regenerar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Typing indicator */}
          {isSending && (
            <div className="flex gap-2.5 flex-row">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{ background: "linear-gradient(135deg, hsl(206 11% 28%), hsl(206 11% 22%))" }}
              >
                <Bot className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 bg-muted/60 border border-border/40 shadow-sm">
                <TypingDots />
              </div>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <InputBar
        input={input}
        setInput={setInput}
        isSending={isSending}
        onSend={handleSend}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

// ─── Input compartido ─────────────────────────────────────────────────────────
interface InputBarProps {
  input: string;
  setInput: (v: string) => void;
  isSending: boolean;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

function InputBar({ input, setInput, isSending, onSend, onKeyDown }: InputBarProps) {
  return (
    <div className="flex gap-2 p-4 border-t border-border/60 bg-background/80 backdrop-blur-sm">
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Escribe tu pregunta… (Enter para enviar)"
        disabled={isSending}
        className="min-h-[52px] max-h-32 resize-none text-sm rounded-xl border-border/60 focus-visible:ring-[hsl(38,59%,45%)] focus-visible:ring-1 focus-visible:border-[hsl(38,59%,45%)]"
        rows={2}
      />
      <Button
        onClick={onSend}
        disabled={isSending || !input.trim()}
        size="icon"
        className="h-auto w-11 shrink-0 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
        style={{
          background: "linear-gradient(135deg, hsl(38 59% 45%), hsl(38 59% 36%))",
          border: "none",
          color: "white",
        }}
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
