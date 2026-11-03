import { Fragment, useRef, useEffect, useState, type ReactNode } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, Bot, Zap, FileText, BarChart3, Package, Copy, Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { COMPONENTES_MARKDOWN_SEGUROS, urlMarkdownSegura } from "@/lib/markdown-seguro";
import type { MensajeChat } from "@/hooks/useChatFacturas";
import type { ResultadoRapido } from "@/hooks/usePreguntasRapidas";
import { GraficoSeriePrecio } from "./GraficoSeriePrecio";
import { esSerieSinDatos } from "@/lib/facturas/seriePrecio";

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
  /**
   * Respuestas de las preguntas rápidas (sin IA). Se pintan en el hilo como
   * «mensaje del sistema», pero NO son mensajes: no están en `mensajes`, no se
   * guardan en la BD y no le llegan nunca al modelo.
   */
  resultadosRapidos?: ResultadoRapido[];
  renderResultadoRapido?: (r: ResultadoRapido) => ReactNode;
  /** Botón «Al instante» de preguntas rápidas, encima de la caja de texto. */
  barraRapida?: ReactNode;
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-2" role="status" aria-label="Escribiendo…">
      <span
        className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
        style={{ animationDelay: "0ms", animationDuration: "1s" }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
        style={{ animationDelay: "180ms", animationDuration: "1s" }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
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
      type="button"
      onClick={handleCopy}
      title={copied ? "¡Copiado!" : "Copiar respuesta"}
      className={cn(
        "flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors duration-150 pointer-coarse:min-h-11 pointer-coarse:px-3",
        copied
          ? "text-emerald-600 bg-emerald-500/10"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
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
  resultadosRapidos = [],
  renderResultadoRapido,
  barraRapida,
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
  }, [mensajes, isSending, resultadosRapidos]);

  // Cada respuesta rápida va justo después del mensaje que había al pedirla.
  const rapidosEn = (posicion: number) =>
    renderResultadoRapido
      ? resultadosRapidos
          .filter((r) => Math.min(r.despuesDe, mensajes.length) === posicion)
          .map((r) => <Fragment key={r.id}>{renderResultadoRapido(r)}</Fragment>)
      : null;

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
  if (mensajes.length === 0 && !isSending && resultadosRapidos.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-[hsl(38,59%,45%)]">
              <Bot className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">¿En qué puedo ayudarte?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pregunta sobre tus facturas, albaranes o proveedores
              </p>
            </div>
          </div>

          {/* Sugerencias (dinámicas o por defecto): lista ligera, sin tarjetas */}
          <ul className="w-full max-w-md space-y-0.5" data-tour="facturas-ia-sugerencias">
            {listaSugerencias.map(({ icon: Icon, texto }) => (
              <li key={texto}>
                <button
                  type="button"
                  onClick={() => handleSugerencia(texto)}
                  disabled={isSending}
                  className="group flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38,59%,45%)] disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
                >
                  <Icon className="h-4 w-4 shrink-0 transition-colors group-hover:text-[hsl(38,59%,45%)]" aria-hidden />
                  <span className="leading-snug">{texto}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {barraRapida}
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-3 sm:px-4">
          {isLoading && mensajes.length === 0 ? (
            <div className="flex justify-center py-12">
              <TypingDots />
            </div>
          ) : (
            mensajes.map((msg, index) => {
              const isUser = msg.rol === "user";
              const isLastAssistant = !isUser && index === lastAssistantIndex;
              // Gráficas de la respuesta; las «sin datos» ya las explica el texto.
              const graficas = (msg.adjuntos ?? []).filter(
                (a) => a.tipo === "serie_precio" && !esSerieSinDatos(a.datos),
              );
              const hora = new Date(msg.created_at).toLocaleTimeString("es-ES", {
                hour: "2-digit",
                minute: "2-digit",
              });
              // `persistido === false` = se pintó pero no se guardó en BD.
              // Se avisa aquí para que no parezca que el hilo quedó grabado.
              const sinGuardar = msg.persistido === false && (
                <span className="mr-1.5 font-medium text-destructive">
                  sin guardar (no se pudo guardar en el historial: se perderá al recargar) ·
                </span>
              );

              return (
                <Fragment key={msg.id}>
                  {rapidosEn(index)}
                  {isUser ? (
                    <div className="flex animate-in fade-in slide-in-from-bottom-2 flex-col items-end gap-0.5 duration-300">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[hsl(38,59%,45%)] px-3.5 py-2 text-white sm:max-w-[75%]">
                        <div className="prose prose-sm prose-invert max-w-none prose-p:my-0">
                          <ReactMarkdown components={COMPONENTES_MARKDOWN_SEGUROS} urlTransform={urlMarkdownSegura}>{msg.contenido}</ReactMarkdown>
                        </div>
                      </div>
                      <p className="px-1 text-[11px] pointer-coarse:text-xs text-muted-foreground/70">
                        {sinGuardar}
                        {hora}
                      </p>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "flex animate-in fade-in slide-in-from-bottom-2 flex-col gap-1 duration-300",
                        graficas.length === 0 && "max-w-[44rem]",
                      )}
                    >
                      <div className="prose prose-sm max-w-none text-foreground dark:prose-invert">
                        <ReactMarkdown components={COMPONENTES_MARKDOWN_SEGUROS} urlTransform={urlMarkdownSegura}>{msg.contenido}</ReactMarkdown>
                      </div>

                      {/* Gráficas adjuntas (evolución de precio) */}
                      {graficas.map((a, i) => (
                        <div key={`${msg.id}-grafica-${i}`} className="w-full pt-1">
                          <GraficoSeriePrecio datos={a.datos} />
                        </div>
                      ))}

                      {/* Acciones y hora bajo la respuesta */}
                      <div className="-ml-2 flex flex-wrap items-center gap-x-1 text-[11px] pointer-coarse:text-xs text-muted-foreground/70">
                        <CopyButton text={msg.contenido} />

                        {/* Botón regenerar solo en el último mensaje del asistente */}
                        {isLastAssistant && onRegenerar && !isSending && (
                          <button
                            type="button"
                            onClick={onRegenerar}
                            title="Regenerar respuesta"
                            className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:px-3"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Regenerar
                          </button>
                        )}
                        <span className="px-1">
                          {sinGuardar}
                          {hora}
                        </span>
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })
          )}

          {rapidosEn(mensajes.length)}

          {/* Indicador de «escribiendo» */}
          {isSending && <TypingDots />}

          <div ref={scrollRef} />
        </div>
      </div>

      {barraRapida}
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
  const hayTexto = input.trim().length > 0;
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3 pt-1 sm:px-4">
      {/* Una sola caja redondeada; el botón de enviar va dentro, a la derecha. */}
      <div className="relative rounded-2xl border border-border/70 bg-background transition-colors focus-within:border-[hsl(38,59%,45%)]" data-tour="facturas-ia-pregunta">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribe tu pregunta…"
          enterKeyHint="send"
          aria-label="Pregunta para el asistente"
          disabled={isSending}
          className="max-h-40 min-h-[52px] resize-none rounded-2xl border-0 bg-transparent py-3.5 pl-4 pr-14 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 md:text-base"
          rows={1}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={isSending || !hayTexto}
          aria-label="Enviar pregunta"
          className={cn(
            "absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full transition-colors pointer-coarse:bottom-1 pointer-coarse:right-1 pointer-coarse:h-11 pointer-coarse:w-11",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38,59%,45%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed",
            hayTexto && !isSending
              ? "bg-[hsl(38,59%,45%)] text-white hover:bg-[hsl(38,59%,38%)]"
              : "bg-muted text-muted-foreground",
          )}
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
