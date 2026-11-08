// Copiloto de IA de Facturas › Análisis: el contenido del panel lateral
// «Pregúntale a la IA» (CopilotoLateral). Sugerencias sacadas del tablero, el
// hilo de la conversación y la caja para preguntar abajo.
//
// Las gráficas que manda la IA (adjuntos `serie_precio`) se ven AQUÍ, bajo su
// respuesta, con «Fijar en el tablero» para dejarlas al final del tablero.
//
// `variante="completa"` (06/11/2026): el mismo hilo a pantalla completa
// (ChatPantallaCompleta, `/facturas/ia`): columna de lectura centrada (máx.
// 900 px), gráficas más altas y la caja de la pregunta fija abajo. Lo escrito
// en la caja puede vivir fuera (`borrador`) para no perderlo al cambiar de vista.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
// GFM: la IA contesta con TABLAS markdown (`| a | b |`) y sin esto salían en crudo (QA 05/11/2026).
import remarkGfm from "remark-gfm";
import { ArrowUp, Check, Copy, Crosshair, FileText, LineChart, Pin, PinOff, RefreshCw, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { COMPONENTES_MARKDOWN_SEGUROS, urlMarkdownSegura } from "@/lib/markdown-seguro";
import type { MensajeChat } from "@/hooks/useChatFacturas";
import { asuntoDeContexto, graficasDeMensaje, separarContexto, type GraficaIa } from "@/lib/facturas/graficasCopiloto";
import type { DocumentoCitado } from "@/lib/facturas/seriePrecio";
import { formatFechaEs } from "@/lib/facturas/preguntasRapidas";
import { BotonOriginal } from "../shared/BotonOriginal";
import { GraficoSeriePrecio } from "../GraficoSeriePrecio";
import { desplazarA } from "../analisis/desplazar";

const PLUGINS_MARKDOWN = [remarkGfm];

export interface Sugerencia {
  texto: string;
  /** Solo rellena la caja (falta un dato, p. ej. el producto) en vez de preguntar ya. */
  rellenar?: boolean;
}

/** Siempre la última: la IA dibuja el precio de un producto. */
const SUGERENCIA_GRAFICA: Sugerencia = { texto: "Enséñame la gráfica del precio de ", rellenar: true };

const FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const BOTON_PIE = cn("flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground", FOCO);

interface Props {
  mensajes: MensajeChat[];
  isLoading: boolean;
  isSending: boolean;
  /** Preguntas para empezar (sacadas del tablero). */
  sugerencias: string[];
  onEnviar: (texto: string) => void;
  onRegenerar?: () => void;
  /** Ids de las gráficas ya fijadas en el tablero. */
  fijadas: ReadonlySet<string>;
  onFijar: (g: GraficaIa) => void;
  onQuitarFijada: (id: string) => void;
  /** Panel lateral (estrecho) o pantalla completa. */
  variante?: "lateral" | "completa";
  /** Lo escrito en la caja, guardado fuera (sigue al pasar del panel a pantalla completa). */
  borrador?: string;
  onBorrador?: (texto: string) => void;
}

/** Tablas y textos largos de la respuesta: que no ensanchen el panel (estrecho). */
// El panel no tiene el plugin de tipografía: las tablas (GFM) llevan aquí sus
// líneas, relleno y cifras alineadas para que se lean como tabla.
const CLASES_PROSA = cn(
  "break-words [&_table]:my-2 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-sm [&_table]:tabular-nums",
  "[&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_td]:border-b [&_td]:border-border/50 [&_td]:px-2 [&_td]:py-1",
  "[&_pre]:overflow-x-auto [&_ul]:my-1 [&_ol]:my-1",
);

/** Referencias de la respuesta: proveedor · nº · fecha y enlace a la foto del original. */
function DocumentosCitados({ documentos }: { documentos: DocumentoCitado[] }) {
  return (
    <details className="group rounded-lg border border-border/60 text-sm" open={documentos.length <= 4}>
      <summary className={cn("flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden", FOCO)}>
        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Documentos citados ({documentos.length})
      </summary>
      <ul className="divide-y divide-border/40 px-3 pb-1">
        {documentos.map((d) => (
          <li key={d.id} className="flex items-center gap-2">
            <p className="min-w-0 flex-1 py-1.5 text-xs leading-snug">
              <span className="font-medium">
                {d.tipo === "albaran" ? "Albarán" : "Factura"} {d.numero ?? "sin número"}
              </span>
              <span className="line-clamp-2 break-words text-muted-foreground">
                {[d.proveedor, d.fecha ? formatFechaEs(d.fecha) : null].filter(Boolean).join(" · ")}
              </span>
            </p>
            <BotonOriginal driveUrl={d.drive_url} archivoPath={d.archivo_path} variant="desktop" />
          </li>
        ))}
      </ul>
    </details>
  );
}

function Escribiendo() {
  return (
    <div className="flex items-center gap-1 py-2" role="status" aria-label="La IA está escribiendo…">
      {[0, 180, 360].map((ms) => (
        <span
          key={ms}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50"
          style={{ animationDelay: `${ms}ms`, animationDuration: "1s" }}
        />
      ))}
    </div>
  );
}

function BotonCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          // Sin portapapeles (http, permisos): no pasa nada.
        }
      }}
      title={copiado ? "¡Copiado!" : "Copiar respuesta"}
      className={cn(BOTON_PIE, copiado && "bg-emerald-500/10 text-emerald-600")}
    >
      {copiado ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copiado ? "Copiado" : "Copiar"}
    </button>
  );
}

export function PanelCopiloto({
  mensajes,
  isLoading,
  isSending,
  sugerencias,
  onEnviar,
  onRegenerar,
  fijadas,
  onFijar,
  onQuitarFijada,
  variante = "lateral",
  borrador,
  onBorrador,
}: Props) {
  const [inputPropio, setInputPropio] = useState("");
  const input = borrador ?? inputPropio;
  const setInput = onBorrador ?? setInputPropio;
  const completa = variante === "completa";
  // A pantalla completa la lectura va centrada y con un ancho cómodo.
  const columna = completa ? "mx-auto w-full max-w-[900px] px-4 sm:px-6" : "";
  const hiloRef = useRef<HTMLDivElement>(null);
  const cajaRef = useRef<HTMLTextAreaElement>(null);
  const lista: Sugerencia[] = [...sugerencias.map((texto) => ({ texto })), SUGERENCIA_GRAFICA];
  const ultimoAsistente = mensajes.reduce((u, m, i) => (m.rol === "assistant" ? i : u), -1);

  // Al final del hilo moviendo SOLO el hilo (scrollIntoView movía también la página).
  useEffect(() => {
    const hilo = hiloRef.current;
    if (hilo) desplazarA(hilo, hilo.scrollHeight);
  }, [mensajes, isSending]);

  const enviar = () => {
    const texto = input.trim();
    if (!texto || isSending) return;
    onEnviar(texto);
    setInput("");
  };
  const alPulsar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  };
  const usarSugerencia = (s: Sugerencia) => {
    if (isSending) return;
    if (s.rellenar) {
      setInput(s.texto);
      requestAnimationFrame(() => {
        const caja = cajaRef.current;
        if (!caja) return;
        caja.focus();
        caja.setSelectionRange(s.texto.length, s.texto.length);
      });
      return;
    }
    onEnviar(s.texto);
  };

  // Mientras se carga una conversación del historial no se enseñan las sugerencias.
  const vacio = mensajes.length === 0 && !isSending && !isLoading;
  const hayTexto = input.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={hiloRef} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", !completa && "px-4")}>
        {vacio ? (
          <div className={cn("space-y-2 py-3", columna, completa && "py-6 sm:py-10")}>
            {completa && <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">¿Qué quieres saber de tus compras?</h2>}
            <p className="text-sm text-muted-foreground">
              Pregunta por tus compras con tus palabras. Si la respuesta trae una gráfica, puedes fijarla en el tablero.
            </p>
            <ul className={cn("space-y-1", completa && "grid gap-2 space-y-0 pt-2 sm:grid-cols-2")} data-tour="facturas-ia-sugerencias" aria-label="Sugerencias para empezar">
              {lista.map((s) => (
                <li key={s.texto}>
                  <button
                    type="button"
                    onClick={() => usarSugerencia(s)}
                    disabled={isSending}
                    className={cn(
                      "group flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-border/60 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50",
                      FOCO,
                    )}
                  >
                    {s.rellenar ? (
                      <LineChart className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="leading-snug">{s.rellenar ? `${s.texto.trim()}…` : s.texto}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className={cn("space-y-3 py-3", columna, completa && "space-y-5 py-6")} aria-label="Conversación con la IA">
            {isLoading && mensajes.length === 0 && (
              <li>
                <Escribiendo />
              </li>
            )}
            {mensajes.map((m, i) => (
              <li key={m.id}>
                {m.rol === "user" ? (
                  <MensajeUsuario mensaje={m} completa={completa} />
                ) : (
                  <MensajeAsistente
                    mensaje={m}
                    completa={completa}
                    fijadas={fijadas}
                    onFijar={onFijar}
                    onQuitarFijada={onQuitarFijada}
                    onRegenerar={i === ultimoAsistente && !isSending ? onRegenerar : undefined}
                  />
                )}
              </li>
            ))}
            {isSending && (
              <li>
                <Escribiendo />
              </li>
            )}
          </ol>
        )}
      </div>

      <div className={cn("shrink-0 border-t border-border/60 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2", completa ? "bg-background" : "px-4")}>
        <div className={cn("relative rounded-2xl border border-border/70 bg-background transition-colors focus-within:border-ring", completa && "mx-auto w-[calc(100%-2rem)] max-w-[868px] shadow-sm sm:w-[calc(100%-3rem)]")} data-tour="facturas-ia-pregunta">
          <Textarea
            ref={cajaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={alPulsar}
            placeholder="Escribe tu pregunta…"
            enterKeyHint="send"
            aria-label="Pregunta para el asistente"
            disabled={isSending}
            rows={1}
            className="max-h-32 min-h-[52px] resize-none rounded-2xl border-0 bg-transparent py-3.5 pl-4 pr-14 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 md:text-base"
          />
          <button
            type="button"
            onClick={enviar}
            disabled={isSending || !hayTexto}
            aria-label="Enviar pregunta"
            className={cn(
              "absolute bottom-1 right-1 flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed",
              FOCO,
              hayTexto && !isSending ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground",
            )}
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

/** `persistido === false`: se ve pero no se guardó (se perderá al recargar). */
function SinGuardar({ mensaje }: { mensaje: MensajeChat }) {
  if (mensaje.persistido !== false) return null;
  return <span className="mr-1 font-medium text-destructive">sin guardar (se perderá al recargar) ·</span>;
}

function MensajeUsuario({ mensaje, completa }: { mensaje: MensajeChat; completa?: boolean }) {
  const { pregunta, contexto } = separarContexto(mensaje.contenido);
  return (
    <div className="flex flex-col items-end gap-0.5">
      {contexto && (
        <span className="inline-flex max-w-full items-start gap-1 text-xs text-muted-foreground">
          <Crosshair className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span className="line-clamp-2 break-words">sobre {asuntoDeContexto(contexto)}</span>
        </span>
      )}
      <div className={cn("rounded-2xl rounded-br-md bg-primary px-3 py-1.5 text-sm text-primary-foreground", completa ? "max-w-[80%] sm:text-base" : "max-w-[90%]")}>
        <div className="prose prose-sm prose-invert max-w-none break-words prose-p:my-0">
          <ReactMarkdown remarkPlugins={PLUGINS_MARKDOWN} components={COMPONENTES_MARKDOWN_SEGUROS} urlTransform={urlMarkdownSegura}>
            {pregunta}
          </ReactMarkdown>
        </div>
      </div>
      <p className="px-1 text-xs text-muted-foreground/80">
        <SinGuardar mensaje={mensaje} />
        {hora(mensaje.created_at)}
      </p>
    </div>
  );
}

function MensajeAsistente({
  mensaje,
  completa,
  fijadas,
  onFijar,
  onQuitarFijada,
  onRegenerar,
}: {
  mensaje: MensajeChat;
  completa?: boolean;
  fijadas: ReadonlySet<string>;
  onFijar: (g: GraficaIa) => void;
  onQuitarFijada: (id: string) => void;
  onRegenerar?: () => void;
}) {
  const documentos = (mensaje.adjuntos ?? []).flatMap((a) => (a.tipo === "documentos" ? a.datos : []));
  const graficas = graficasDeMensaje(mensaje);
  return (
    <div className="flex flex-col gap-1">
      <div className={cn(CLASES_PROSA, "prose prose-sm max-w-none text-foreground dark:prose-invert prose-p:my-1", completa && "sm:prose-base sm:prose-p:my-1.5")}>
        <ReactMarkdown remarkPlugins={PLUGINS_MARKDOWN} components={COMPONENTES_MARKDOWN_SEGUROS} urlTransform={urlMarkdownSegura}>
          {mensaje.contenido}
        </ReactMarkdown>
      </div>
      {graficas.map((g) => {
        const fijada = fijadas.has(g.id);
        return (
          <div key={g.id} className={cn("rounded-xl border border-border/70 p-2", completa && "p-3")}>
            <GraficoSeriePrecio datos={g.serie} alto={completa ? 320 : 180} />
            <div className="mt-1 flex flex-wrap items-center gap-x-1">
              <button
                type="button"
                onClick={() => (fijada ? onQuitarFijada(g.id) : onFijar(g))}
                aria-pressed={fijada}
                className={cn(BOTON_PIE, fijada && "text-primary")}
              >
                {fijada ? <PinOff className="h-3.5 w-3.5" aria-hidden /> : <Pin className="h-3.5 w-3.5" aria-hidden />}
                {fijada ? "Fijada en el tablero · quitar" : "Fijar en el tablero"}
              </button>
            </div>
          </div>
        );
      })}
      {documentos.length > 0 && <DocumentosCitados documentos={documentos} />}
      <div className="-ml-2 flex flex-wrap items-center gap-x-0.5 text-xs text-muted-foreground/80">
        <BotonCopiar texto={mensaje.contenido} />
        {onRegenerar && (
          <button type="button" onClick={onRegenerar} title="Regenerar respuesta" className={BOTON_PIE}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Regenerar
          </button>
        )}
        <span className="px-1">
          <SinGuardar mensaje={mensaje} />
          {hora(mensaje.created_at)}
        </span>
      </div>
    </div>
  );
}
