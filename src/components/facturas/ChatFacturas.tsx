// Pestaña «Análisis» de Facturas: COPILOTO CENTRADO EN GRÁFICAS (05/11/2026).
//
// Antes era un chat; ahora las gráficas son lo principal:
//   · Tablero (centro, grande): las gráficas de la IA y las respuestas «al
//     instante» como tarjetas que se quedan fijadas, con chips «pregúntale más».
//   · Copiloto (a un lado, estrecho; abajo y plegable en tablet vertical):
//     la caja para preguntar, sugerencias y las respuestas cortas.
//   · Tocar una tarjeta la selecciona: la siguiente pregunta lleva su contexto.
//   · El historial de conversaciones va plegado en un panel lateral (Sheet).
// Sin scroll de página: solo hacen scroll el tablero y el hilo del copiloto.
//
// Se sigue llamando ChatFacturas (y expone `enviarConsulta`) para no tocar
// la página: el «Preguntar a la IA» de Compras sigue funcionando igual.
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { Eraser, History, Plus } from "lucide-react";
import { useChatFacturas, type Conversacion, type MensajeChat } from "@/hooks/useChatFacturas";
import { usePreguntasRapidas } from "@/hooks/usePreguntasRapidas";
import { useTableroGraficas } from "@/hooks/useTableroGraficas";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  contextoTarjeta,
  idDomTarjeta,
  tarjetasTablero,
  tituloTarjeta,
  type ChipSeguimiento,
  type Tarjeta,
} from "@/lib/facturas/tableroGraficas";
import { ConversacionesList } from "./ConversacionesList";
import { PREGUNTAS_RAPIDAS } from "./preguntas-rapidas/catalogo";
import { BarraPreguntasRapidas } from "./preguntas-rapidas/PreguntasRapidas";
import { TableroGraficas } from "./copiloto/TableroGraficas";
import { PanelCopiloto, type Sugerencia } from "./copiloto/PanelCopiloto";

export type { Sugerencia } from "./copiloto/PanelCopiloto";

export interface ChatFacturasRef {
  enviarConsulta: (texto: string) => void;
}

interface ChatFacturasProps {
  sugerencias?: Sugerencia[];
}

const BOTON_BARRA =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38,59%,45%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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

  // Preguntas rápidas (sin IA): resultados solo en memoria, fuera de
  // `mensajes`; ver usePreguntasRapidas.ts. Se vacían al cambiar a mano de
  // conversación (no cuando la primera pregunta libre crea una nueva).
  const rapidas = usePreguntasRapidas({ catalogo: PREGUNTAS_RAPIDAS });
  const tablero = useTableroGraficas(conversacionActiva?.id ?? null);
  const [historialAbierto, setHistorialAbierto] = useState(false);

  const tarjetas = useMemo(
    () => tarjetasTablero(mensajes, rapidas.resultados, tablero.ocultas),
    [mensajes, rapidas.resultados, tablero.ocultas],
  );
  const seleccionada = tarjetas.find((t) => t.id === tablero.seleccionadaId) ?? null;
  const preguntaDe = (t: Tarjeta) =>
    t.origen === "rapida" ? PREGUNTAS_RAPIDAS.find((p) => p.id === t.resultado.preguntaId) : undefined;
  const titulo = (t: Tarjeta) => tituloTarjeta(t, preguntaDe(t)?.etiqueta);

  const empezarDeCero = () => {
    rapidas.limpiar();
    tablero.seleccionar(null);
  };
  const abrirConversacion = (conv: Conversacion) => {
    empezarDeCero();
    setHistorialAbierto(false);
    return seleccionarConversacion(conv);
  };
  const nueva = () => {
    empezarDeCero();
    setHistorialAbierto(false);
    return nuevaConversacion();
  };

  /** Pregunta a la IA; con una tarjeta seleccionada, sobre ella. */
  const preguntar = (texto: string, sobre: Tarjeta | null = seleccionada) =>
    enviarMensaje(texto, { contexto: sobre ? contextoTarjeta(sobre, preguntaDe(sobre)) : null });

  const seguimiento = (t: Tarjeta, chip: ChipSeguimiento) => {
    tablero.seleccionar(t.id);
    void preguntar(chip.pregunta, t);
  };

  const quitar = (t: Tarjeta) => {
    if (t.origen === "ia") tablero.ocultar([t.id]);
    else rapidas.descartar(t.id);
    if (tablero.seleccionadaId === t.id) tablero.seleccionar(null);
  };

  const limpiarTablero = () => {
    tablero.ocultar(tarjetas.filter((t) => t.origen === "ia").map((t) => t.id));
    rapidas.limpiar();
    tablero.seleccionar(null);
  };

  const graficasDe = (m: MensajeChat) =>
    tarjetas.filter((t) => t.origen === "ia" && t.mensajeId === m.id).map((t) => t.id);

  const verGrafica = (id: string) => {
    const el = document.getElementById(idDomTarjeta(id));
    if (!el) return;
    el.scrollIntoView?.({ behavior: "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };

  useImperativeHandle(ref, () => ({
    // «Preguntar a la IA» desde Compras: pregunta general, sin gráfica.
    enviarConsulta: (texto: string) => {
      tablero.seleccionar(null);
      void enviarMensaje(texto);
    },
  }));

  const barra = (
    <div className="flex shrink-0 flex-wrap items-start gap-x-1 pb-1">
      <Sheet open={historialAbierto} onOpenChange={setHistorialAbierto}>
        <SheetTrigger asChild>
          <button type="button" className={BOTON_BARRA} data-tour="facturas-ia-historial">
            <History className="h-4 w-4" aria-hidden />
            Historial
            {conversaciones.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold leading-none text-muted-foreground">
                {conversaciones.length}
              </span>
            )}
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b border-border/50 px-4 py-3">
            <SheetTitle className="text-sm">Historial de análisis</SheetTitle>
          </SheetHeader>
          <ConversacionesList
            conversaciones={conversaciones}
            conversacionActiva={conversacionActiva}
            onSeleccionar={abrirConversacion}
            onNueva={nueva}
            onEliminar={eliminarConversacion}
          />
        </SheetContent>
      </Sheet>
      <button type="button" onClick={nueva} className={BOTON_BARRA} disabled={isSending} title="Empezar un análisis nuevo (el actual queda en el historial)">
        <Plus className="h-4 w-4 text-[hsl(38,59%,45%)]" aria-hidden />
        Nuevo
      </button>
      <BarraPreguntasRapidas
        className="min-w-0 flex-1 pt-[0.375rem] pointer-coarse:pt-0"
        catalogo={PREGUNTAS_RAPIDAS}
        cargando={rapidas.cargando}
        noDisponible={rapidas.noDisponible}
        onPreguntar={(id, parametros) => rapidas.lanzar(id, mensajes.length, parametros)}
      />
      <button
        type="button"
        onClick={limpiarTablero}
        disabled={tarjetas.length === 0}
        className={cn(BOTON_BARRA, "ml-auto")}
        aria-label="Quitar todas las gráficas del tablero"
        title="Quitar todas las gráficas del tablero (las conversaciones siguen en el historial)"
      >
        <Eraser className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Limpiar</span>
      </button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden lg:flex-row lg:gap-3">
      <TableroGraficas
        tarjetas={tarjetas}
        catalogo={PREGUNTAS_RAPIDAS}
        seleccionadaId={seleccionada?.id ?? null}
        onAlternarSeleccion={tablero.alternarSeleccion}
        onQuitar={quitar}
        onSeguimiento={seguimiento}
        onAtajo={(id, parametros) => rapidas.lanzar(id, mensajes.length, parametros)}
        cargandoAtajo={rapidas.cargando}
        atajoNoDisponible={rapidas.noDisponible}
        cargando={isLoading}
        pensando={isSending}
        barra={barra}
      />
      <PanelCopiloto
        mensajes={mensajes}
        isLoading={isLoading}
        isSending={isSending}
        sugerencias={sugerencias}
        onEnviar={(texto) => void preguntar(texto)}
        onRegenerar={regenerarRespuesta}
        seleccion={seleccionada ? titulo(seleccionada) : null}
        onQuitarSeleccion={() => tablero.seleccionar(null)}
        graficasDe={graficasDe}
        onVerGrafica={verGrafica}
      />
    </div>
  );
});

ChatFacturas.displayName = "ChatFacturas";
