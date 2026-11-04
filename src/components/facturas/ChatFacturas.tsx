import { forwardRef, useImperativeHandle, useState } from "react";
import { useChatFacturas } from "@/hooks/useChatFacturas";
import { ConversacionesList } from "./ConversacionesList";
import { ChatArea, Sugerencia } from "./ChatArea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { usePreguntasRapidas } from "@/hooks/usePreguntasRapidas";
import { PREGUNTAS_RAPIDAS } from "./preguntas-rapidas/catalogo";
import { BarraPreguntasRapidas, TarjetaResultadoRapido } from "./preguntas-rapidas/PreguntasRapidas";

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

  // Preguntas rápidas (sin IA): resultados solo en memoria, fuera de
  // `mensajes`; ver usePreguntasRapidas.ts. Se vacían al cambiar a mano de
  // conversación (no cuando la primera pregunta libre crea una nueva).
  const rapidas = usePreguntasRapidas({ catalogo: PREGUNTAS_RAPIDAS });
  const seleccionar = (conv: Parameters<typeof seleccionarConversacion>[0]) => {
    rapidas.limpiar();
    return seleccionarConversacion(conv);
  };
  const nueva = () => {
    rapidas.limpiar();
    return nuevaConversacion();
  };

  useImperativeHandle(ref, () => ({
    enviarConsulta: (texto: string) => {
      enviarMensaje(texto);
    },
  }));

  return (
    // Plano, sin tarjeta: ni borde ni sombra alrededor del chat (estilo ChatGPT).
    <div className="flex h-full w-full overflow-hidden">
      {/* Columna lateral de conversaciones — solo desde 1280 px. Entre 768 y 1279 px el menú de la
          app ya se lleva 16rem y una segunda columna dejaba muy poco al chat. */}
      <div className="hidden w-60 shrink-0 border-r border-border/60 xl:block">
        <ConversacionesList
          conversaciones={conversaciones}
          conversacionActiva={conversacionActiva}
          onSeleccionar={seleccionar}
          onNueva={nueva}
          onEliminar={eliminarConversacion}
        />
      </div>

      {/* Área del chat. `min-w-0`: que nada ensanche la columna en tablet. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Barra superior (< 1280 px) con botón de historial (Sheet drawer) */}
        <div className="flex shrink-0 items-center gap-2 px-1 xl:hidden">
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-sm text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
                  data-tour="facturas-ia-historial"
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
              <SheetContent side="left" className="w-[85vw] max-w-72 p-0">
                <SheetHeader className="px-4 py-3 border-b border-border/50">
                  <SheetTitle className="text-sm">Historial</SheetTitle>
                </SheetHeader>
                <ConversacionesList
                  conversaciones={conversaciones}
                  conversacionActiva={conversacionActiva}
                  onSeleccionar={(conv) => {
                    seleccionar(conv);
                    setSheetOpen(false);
                  }}
                  onNueva={() => {
                    nueva();
                    setSheetOpen(false);
                  }}
                  onEliminar={eliminarConversacion}
                />
              </SheetContent>
            </Sheet>
          </div>

          {/* Chat principal — ocupa el espacio restante */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-full w-full min-w-0 flex-col">
              <ChatArea
                mensajes={mensajes}
                isLoading={isLoading}
                isSending={isSending}
                sugerencias={sugerencias}
                onEnviar={enviarMensaje}
                onRegenerar={regenerarRespuesta}
                tieneConversacion={!!conversacionActiva}
                resultadosRapidos={rapidas.resultados}
                renderResultadoRapido={(r) => (
                  <TarjetaResultadoRapido
                    resultado={r}
                    pregunta={PREGUNTAS_RAPIDAS.find((p) => p.id === r.preguntaId)}
                    onDescartar={rapidas.descartar}
                  />
                )}
                barraRapida={
                  <BarraPreguntasRapidas
                    catalogo={PREGUNTAS_RAPIDAS}
                    cargando={rapidas.cargando}
                    noDisponible={rapidas.noDisponible}
                    onPreguntar={(id, parametros) => rapidas.lanzar(id, mensajes.length, parametros)}
                  />
                }
              />
            </div>
          </div>
      </div>
    </div>
  );
});

ChatFacturas.displayName = "ChatFacturas";
