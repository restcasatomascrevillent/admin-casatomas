// «Pregúntale a la IA» a PANTALLA COMPLETA (`/facturas/ia?c=<conversación>`,
// 06/11/2026, petición del dueño). Lo monta ChatFacturas en lugar del tablero,
// con el MISMO estado del chat: al venir del panel lateral la conversación en
// curso sigue tal cual (también una respuesta que aún no ha llegado y lo escrito
// en la caja). Abierto en otra pestaña, la conversación se carga con `?c=`.
//
//   · Cabecera: «Volver a Análisis» (al panel lateral), el título de la
//     conversación, «Nueva» y, en tablet y móvil, «Historial» desplegable.
//   · Escritorio (≥ lg): el historial en una columna a la izquierda.
//   · La conversación, centrada (máx. 900 px de lectura), con la caja de la
//     pregunta fija abajo y las gráficas a buen tamaño («Fijar en el tablero»
//     igual que en el panel).
import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { History, Minimize2, Plus, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Conversacion, MensajeChat } from "@/hooks/useChatFacturas";
import type { GraficaIa } from "@/lib/facturas/graficasCopiloto";
import { PARAM_CONVERSACION } from "@/lib/facturas/copilotoCompleto";
import { ConversacionesList } from "../ConversacionesList";
import { PanelCopiloto } from "./PanelCopiloto";
import { esTactil } from "../analisis/desplazar";

const FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const BOTON = cn(
  "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  FOCO,
);

interface Props {
  conversaciones: Conversacion[];
  conversacionActiva: Conversacion | null;
  onSeleccionarConversacion: (c: Conversacion) => void;
  onNuevaConversacion: () => void;
  onEliminarConversacion: (id: string) => void;
  /** Carga la conversación de `?c=` (false si no existe). */
  abrirConversacionPorId: (id: string) => Promise<boolean>;
  /** «Volver a Análisis»: al panel lateral, con la misma conversación. */
  onVolver: () => void;
  mensajes: MensajeChat[];
  isLoading: boolean;
  isSending: boolean;
  sugerencias: string[];
  onEnviar: (texto: string) => void;
  onRegenerar?: () => void;
  fijadas: ReadonlySet<string>;
  onFijar: (g: GraficaIa) => void;
  onQuitarFijada: (id: string) => void;
  onExplorar?: (g: GraficaIa) => void;
  borrador?: string;
  onBorrador?: (texto: string) => void;
}

/**
 * `?c=` ↔ conversación activa: al abrir, la de la URL; al cambiar de
 * conversación (historial, «Nueva», la primera pregunta), la URL la sigue sin
 * apilar historial y sin perder el `state` (a dónde se vuelve).
 */
function useConversacionEnUrl(activa: Conversacion | null, abrirPorId: (id: string) => Promise<boolean>) {
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const idUrl = params.get(PARAM_CONVERSACION);
  const pedida = useRef<string | null>(null);
  const [noEncontrada, setNoEncontrada] = useState(false);
  const ultimo = useRef({ params, state, setParams });
  ultimo.current = { params, state, setParams };
  const escribir = (id: string | null) => {
    const { params: prev, state: st, setParams: set } = ultimo.current;
    if ((prev.get(PARAM_CONVERSACION) ?? null) === id) return;
    const sig = new URLSearchParams(prev);
    if (id) sig.set(PARAM_CONVERSACION, id);
    else sig.delete(PARAM_CONVERSACION);
    set(sig, { replace: true, state: st });
  };

  const activaId = activa?.id ?? null;
  const activaRef = useRef(activaId);
  activaRef.current = activaId;

  // URL → conversación (al abrir, o si alguien cambia `?c=` a mano). Solo cuando
  // cambia la URL: al elegir otra conversación, la URL la sigue (efecto de abajo).
  useEffect(() => {
    if (!idUrl || idUrl === activaRef.current || pedida.current === idUrl) return;
    pedida.current = idUrl;
    setNoEncontrada(false);
    void abrirPorId(idUrl).then((ok) => {
      pedida.current = null;
      if (!ok) {
        setNoEncontrada(true);
        escribir(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia la URL
  }, [idUrl]);

  // Conversación → URL.
  useEffect(() => {
    if (pedida.current) return; // cargando la de la URL
    if (activaId) setNoEncontrada(false);
    escribir(activaId);
  }, [activaId]);

  return noEncontrada;
}

export function ChatPantallaCompleta({
  conversaciones,
  conversacionActiva,
  onSeleccionarConversacion,
  onNuevaConversacion,
  onEliminarConversacion,
  abrirConversacionPorId,
  onVolver,
  ...panel
}: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const noEncontrada = useConversacionEnUrl(conversacionActiva, abrirConversacionPorId);

  // Al entrar, a escribir (con el dedo no: abriría el teclado encima de todo).
  useEffect(() => {
    if (esTactil()) return;
    raiz.current?.querySelector<HTMLTextAreaElement>("textarea:not([disabled])")?.focus({ preventScroll: true });
  }, []);

  const seleccionar = (c: Conversacion) => {
    setHistorialAbierto(false);
    onSeleccionarConversacion(c);
  };
  const nueva = () => {
    setHistorialAbierto(false);
    onNuevaConversacion();
  };
  const titulo = conversacionActiva?.titulo && conversacionActiva.titulo !== "Nueva conversación" ? conversacionActiva.titulo : null;
  const lista = (
    <ConversacionesList
      conversaciones={conversaciones}
      conversacionActiva={conversacionActiva}
      onSeleccionar={seleccionar}
      onNueva={nueva}
      onEliminar={onEliminarConversacion}
    />
  );

  return (
    <div
      ref={raiz}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card"
      role="region"
      aria-labelledby="ia-pantalla-completa-titulo"
      data-testid="copiloto-pantalla-completa-vista"
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border/60 px-1.5 py-1 sm:px-2">
        <button type="button" className={BOTON} onClick={onVolver} aria-label="Volver a Análisis" title="Volver a Análisis (al panel lateral)" data-testid="copiloto-volver-panel">
          <Minimize2 className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Volver a Análisis</span>
        </button>
        <div className="min-w-0 flex-1 px-1">
          <h1 id="ia-pantalla-completa-titulo" className="flex min-w-0 items-center gap-1.5 text-base font-semibold leading-tight text-foreground">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="truncate">Pregúntale a la IA</span>
          </h1>
          {titulo && (
            <p className="truncate text-xs text-muted-foreground" title={titulo}>
              {titulo}
            </p>
          )}
        </div>
        <button type="button" className={cn(BOTON, "hidden sm:inline-flex lg:hidden")} onClick={nueva}>
          <Plus className="h-4 w-4" aria-hidden /> Nueva
        </button>
        {/* Tablet y móvil: el historial, desplegable. En escritorio va en la columna de la izquierda. */}
        <Popover open={historialAbierto} onOpenChange={setHistorialAbierto}>
          <PopoverTrigger asChild>
            <button type="button" className={cn(BOTON, "lg:hidden")} aria-label={`Historial (${conversaciones.length} conversaciones)`}>
              <History className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Historial</span>
              {conversaciones.length > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-xs font-semibold leading-5 text-muted-foreground">{conversaciones.length}</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" collisionPadding={12} className="flex max-h-[min(70vh,32rem)] w-[min(22rem,calc(100vw-1.5rem))] flex-col p-0" aria-label="Historial de conversaciones">
            {lista}
          </PopoverContent>
        </Popover>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-border/60 lg:flex xl:w-72" aria-label="Historial de conversaciones">
          <p className="px-4 pb-0 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Historial</p>
          <div className="min-h-0 flex-1">{lista}</div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {noEncontrada && (
            <p className="mx-auto mt-3 w-[calc(100%-2rem)] max-w-[868px] rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200" role="status">
              No se encuentra esa conversación (puede que se haya borrado). Pregunta para empezar una nueva o elige otra del historial.
            </p>
          )}
          <PanelCopiloto {...panel} variante="completa" />
        </div>
      </div>
    </div>
  );
}
