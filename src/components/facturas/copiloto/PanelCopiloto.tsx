// Copiloto del tablero de gráficas: columna estrecha a un lado (en horizontal)
// o franja plegable abajo (tablet en vertical). Caja para preguntar,
// sugerencias iniciales y las respuestas cortas de la IA. Las gráficas de esas
// respuestas van al tablero; aquí solo queda un «Ver gráfica».
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowUp,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Crosshair,
  FileText,
  LineChart,
  Package,
  RefreshCw,
  X,
  Zap,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { COMPONENTES_MARKDOWN_SEGUROS, urlMarkdownSegura } from "@/lib/markdown-seguro";
import type { MensajeChat } from "@/hooks/useChatFacturas";
import { asuntoDeContexto, separarContexto } from "@/lib/facturas/tableroGraficas";
import type { DocumentoCitado } from "@/lib/facturas/seriePrecio";
import { formatFechaEs } from "@/lib/facturas/preguntasRapidas";
import { BotonOriginal } from "../shared/BotonOriginal";

export interface Sugerencia {
  icon: React.ElementType;
  texto: string;
  /** Solo rellena la caja (falta un dato, p. ej. el producto) en vez de preguntar ya. */
  rellenar?: boolean;
}

const SUGERENCIAS_DEFAULT: Sugerencia[] = [
  { icon: FileText, texto: "¿Cuáles son las últimas facturas recibidas?" },
  { icon: BarChart3, texto: "¿Cuánto hemos gastado este mes?" },
  { icon: Package, texto: "¿Qué facturas hay pendientes de pago?" },
  { icon: Zap, texto: "Resume los albaranes de esta semana" },
];

/** Sugerencia de gráfica que va siempre primero: la IA solo dibuja precios de un producto. */
const SUGERENCIA_GRAFICA: Sugerencia = {
  icon: LineChart,
  texto: "Enséñame la gráfica del precio de ",
  rellenar: true,
};

const DORADO_FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38,59%,45%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

interface Props {
  mensajes: MensajeChat[];
  isLoading: boolean;
  isSending: boolean;
  sugerencias?: Sugerencia[];
  onEnviar: (texto: string) => void;
  onRegenerar?: () => void;
  /** Título de la tarjeta seleccionada (la pregunta irá sobre ella). */
  seleccion: string | null;
  onQuitarSeleccion: () => void;
  /** Ids de tarjeta de las gráficas de un mensaje que siguen en el tablero. */
  graficasDe: (mensaje: MensajeChat) => string[];
  onVerGrafica: (tarjetaId: string) => void;
}

/** Tablas y textos largos de la respuesta: que no ensanchen la columna (estrecha) ni la página en móvil. */
const CLASES_PROSA =
  "break-words [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_pre]:overflow-x-auto [&_ul]:my-1 [&_ol]:my-1";

/** Referencias de la respuesta: proveedor · nº · fecha y enlace a la foto del original. */
function DocumentosCitados({ documentos }: { documentos: DocumentoCitado[] }) {
  return (
    <details className="group rounded-lg border border-border/60 text-sm" open={documentos.length <= 4}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
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
              <span className="block truncate text-muted-foreground" title={d.proveedor ?? undefined}>
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

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-2" role="status" aria-label="Escribiendo…">
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
      className={cn(
        "flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
        DORADO_FOCO,
        copiado ? "bg-emerald-500/10 text-emerald-600" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
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
  seleccion,
  onQuitarSeleccion,
  graficasDe,
  onVerGrafica,
}: Props) {
  const [input, setInput] = useState("");
  // Plegado: solo tiene efecto por debajo de `lg` (tablet en vertical); en
  // horizontal la columna está siempre abierta.
  const [plegado, setPlegado] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);
  const cajaRef = useRef<HTMLTextAreaElement>(null);
  const lista = [SUGERENCIA_GRAFICA, ...(sugerencias && sugerencias.length > 0 ? sugerencias : SUGERENCIAS_DEFAULT)];
  const ultimoAsistente = mensajes.reduce((u, m, i) => (m.rol === "assistant" ? i : u), -1);

  useEffect(() => {
    finRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [mensajes, isSending]);

  // Al preguntar con el copiloto plegado se despliega: la respuesta se ve.
  useEffect(() => {
    if (isSending) setPlegado(false);
  }, [isSending]);

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

  const vacio = mensajes.length === 0 && !isSending;
  const hayTexto = input.trim().length > 0;

  return (
    <aside
      aria-labelledby="copiloto-titulo"
      className={cn(
        "flex min-h-0 shrink-0 flex-col border-t border-border/60 pt-1",
        // Tablet en vertical: franja de abajo, como mucho la mitad del alto.
        "max-h-[50%]",
        // Horizontal: columna estrecha a la derecha, todo el alto.
        "lg:max-h-none lg:w-80 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0 xl:w-96",
      )}
    >
      <div className="flex shrink-0 items-center gap-2">
        <h2 id="copiloto-titulo" className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Bot className="h-4 w-4 text-[hsl(38,59%,45%)]" aria-hidden />
          Copiloto
        </h2>
        <button
          type="button"
          onClick={() => setPlegado((v) => !v)}
          aria-expanded={!plegado}
          aria-controls="copiloto-hilo"
          className={cn(
            "ml-auto inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground lg:hidden",
            DORADO_FOCO,
          )}
        >
          {plegado ? `Ver respuestas${mensajes.length > 0 ? ` (${mensajes.length})` : ""}` : "Plegar"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", !plegado && "rotate-180")} aria-hidden />
        </button>
      </div>

      <div
        id="copiloto-hilo"
        className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", plegado ? "hidden lg:block" : "block")}
      >
        {vacio ? (
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground">
              Pregunta por tus compras con tus palabras. Las gráficas se quedan en el tablero; toca una para preguntar
              sobre ella.
            </p>
            <ul className="space-y-0.5" data-tour="facturas-ia-sugerencias" aria-label="Sugerencias para empezar">
              {lista.map((s) => {
                const Icono = s.icon;
                return (
                  <li key={s.texto}>
                    <button
                      type="button"
                      onClick={() => usarSugerencia(s)}
                      disabled={isSending}
                      className={cn(
                        "group flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                        DORADO_FOCO,
                      )}
                    >
                      <Icono className="h-4 w-4 shrink-0 group-hover:text-[hsl(38,59%,45%)]" aria-hidden />
                      <span className="leading-snug">{s.rellenar ? `${s.texto.trim()}…` : s.texto}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <ol className="space-y-3 py-2" aria-label="Conversación con el copiloto">
            {isLoading && mensajes.length === 0 && (
              <li>
                <TypingDots />
              </li>
            )}
            {mensajes.map((m, i) => (
              <li key={m.id}>
                {m.rol === "user" ? (
                  <MensajeUsuario mensaje={m} />
                ) : (
                  <MensajeAsistente
                    mensaje={m}
                    graficas={graficasDe(m)}
                    onVerGrafica={onVerGrafica}
                    onRegenerar={i === ultimoAsistente && !isSending ? onRegenerar : undefined}
                  />
                )}
              </li>
            ))}
            {isSending && (
              <li>
                <TypingDots />
              </li>
            )}
          </ol>
        )}
        <div ref={finRef} />
      </div>

      {/* Caja de pregunta: con una tarjeta seleccionada, la pregunta va sobre ella. */}
      <div className="shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1">
        {seleccion && (
          <div className="mb-1 flex items-center gap-1 rounded-lg bg-[hsl(38,59%,45%)]/10 pl-2.5 text-xs text-foreground">
            <Crosshair className="h-3.5 w-3.5 shrink-0 text-[hsl(38,59%,40%)]" aria-hidden />
            <span className="min-w-0 flex-1 truncate" id="copiloto-seleccion">
              Sobre: <span className="font-semibold">{seleccion}</span>
            </span>
            <button
              type="button"
              onClick={onQuitarSeleccion}
              aria-label="Dejar de preguntar sobre esta gráfica"
              title="Preguntar en general"
              className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted", DORADO_FOCO)}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
        <div
          className="relative rounded-2xl border border-border/70 bg-background transition-colors focus-within:border-[hsl(38,59%,45%)]"
          data-tour="facturas-ia-pregunta"
        >
          <Textarea
            ref={cajaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={alPulsar}
            placeholder={seleccion ? "Pregunta sobre la gráfica seleccionada…" : "Escribe tu pregunta…"}
            enterKeyHint="send"
            onFocus={(e) => {
              // Móvil: al salir el teclado, que la caja siga a la vista.
              const el = e.currentTarget;
              setTimeout(() => el.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 300);
            }}
            aria-label="Pregunta para el asistente"
            aria-describedby={seleccion ? "copiloto-seleccion" : undefined}
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
              DORADO_FOCO,
              hayTexto && !isSending
                ? "bg-[hsl(38,59%,45%)] text-white hover:bg-[hsl(38,59%,38%)]"
                : "bg-muted text-muted-foreground",
            )}
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </aside>
  );
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

/** `persistido === false`: se ve pero no se guardó (se perderá al recargar). */
function SinGuardar({ mensaje }: { mensaje: MensajeChat }) {
  if (mensaje.persistido !== false) return null;
  return <span className="mr-1 font-medium text-destructive">sin guardar (se perderá al recargar) ·</span>;
}

function MensajeUsuario({ mensaje }: { mensaje: MensajeChat }) {
  const { pregunta, contexto } = separarContexto(mensaje.contenido);
  return (
    <div className="flex flex-col items-end gap-0.5">
      {contexto && (
        <span className="inline-flex max-w-full items-center gap-1 truncate text-[11px] text-muted-foreground pointer-coarse:text-xs">
          <Crosshair className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">sobre {asuntoDeContexto(contexto)}</span>
        </span>
      )}
      <div className="max-w-[90%] rounded-2xl rounded-br-md bg-[hsl(38,59%,45%)] px-3 py-1.5 text-sm text-white">
        <div className="prose prose-sm prose-invert max-w-none break-words prose-p:my-0">
          <ReactMarkdown components={COMPONENTES_MARKDOWN_SEGUROS} urlTransform={urlMarkdownSegura}>
            {pregunta}
          </ReactMarkdown>
        </div>
      </div>
      <p className="px-1 text-[11px] text-muted-foreground/80 pointer-coarse:text-xs">
        <SinGuardar mensaje={mensaje} />
        {hora(mensaje.created_at)}
      </p>
    </div>
  );
}

function MensajeAsistente({
  mensaje,
  graficas,
  onVerGrafica,
  onRegenerar,
}: {
  mensaje: MensajeChat;
  graficas: string[];
  onVerGrafica: (id: string) => void;
  onRegenerar?: () => void;
}) {
  const documentos = (mensaje.adjuntos ?? []).flatMap((a) => (a.tipo === "documentos" ? a.datos : []));
  return (
    <div className="flex flex-col gap-1">
      <div className={cn(CLASES_PROSA, "prose prose-sm max-w-none text-foreground dark:prose-invert prose-p:my-1")}>
        <ReactMarkdown components={COMPONENTES_MARKDOWN_SEGUROS} urlTransform={urlMarkdownSegura}>
          {mensaje.contenido}
        </ReactMarkdown>
      </div>
      {documentos.length > 0 && <DocumentosCitados documentos={documentos} />}
      <div className="-ml-2 flex flex-wrap items-center gap-x-0.5 text-[11px] text-muted-foreground/80 pointer-coarse:text-xs">
        {graficas.map((id, i) => (
          <button
            key={id}
            type="button"
            onClick={() => onVerGrafica(id)}
            className={cn(
              "flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[hsl(38,59%,35%)] hover:bg-muted/60 dark:text-[hsl(38,59%,62%)]",
              DORADO_FOCO,
            )}
          >
            <LineChart className="h-3.5 w-3.5" aria-hidden />
            {graficas.length > 1 ? `Ver gráfica ${i + 1}` : "Ver gráfica"}
          </button>
        ))}
        <BotonCopiar texto={mensaje.contenido} />
        {onRegenerar && (
          <button
            type="button"
            onClick={onRegenerar}
            title="Regenerar respuesta"
            className={cn(
              "flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              DORADO_FOCO,
            )}
          >
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
