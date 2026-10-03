import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, MessageSquare, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversacion } from "@/hooks/useChatFacturas";

interface ConversacionesListProps {
  conversaciones: Conversacion[];
  conversacionActiva: Conversacion | null;
  onSeleccionar: (conv: Conversacion) => void;
  onNueva: () => void;
  onEliminar: (convId: string) => void;
}

export function ConversacionesList({
  conversaciones,
  conversacionActiva,
  onSeleccionar,
  onNueva,
  onEliminar,
}: ConversacionesListProps) {
  return (
    <div className="flex flex-col h-full bg-muted/20">
      {/* Botón nueva conversación */}
      <div className="p-3 border-b border-border/60">
        <Button
          onClick={onNueva}
          className="h-11 w-full gap-2 text-sm font-semibold"
          size="sm"
          style={{
            background: "linear-gradient(135deg, hsl(38 59% 45%), hsl(38 59% 38%))",
            color: "white",
            border: "none",
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva conversación
        </Button>
      </div>

      {/* Lista */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {conversaciones.length === 0 && (
            <div className="py-8 text-center">
              <MessageSquare className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground/60">Sin conversaciones</p>
            </div>
          )}

          {conversaciones.map((conv) => {
            const isActive = conversacionActiva?.id === conv.id;
            const fecha = new Date(conv.updated_at).toLocaleDateString("es-ES", {
              day: "2-digit",
              month: "short",
            });

            return (
              <div
                key={conv.id}
                className={cn(
                  "group relative flex min-h-11 items-start gap-2 rounded-lg px-3 py-2.5 text-sm cursor-pointer transition-all duration-150",
                  isActive
                    ? "bg-accent/10 text-foreground"
                    : "hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                )}
                onClick={() => onSeleccionar(conv)}
              >
                {/* Borde izquierdo activo */}
                {isActive && (
                  <span
                    className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
                    style={{ background: "hsl(38 59% 45%)" }}
                  />
                )}

                <MessageSquare
                  className={cn(
                    "h-4 w-4 shrink-0 mt-0.5",
                    isActive ? "text-[hsl(38,59%,45%)]" : "text-muted-foreground/50"
                  )}
                />

                <div className="flex-1 min-w-0 pr-11"> {/* pr-11 deja hueco para el botón de borrar (siempre visible: con el dedo no hay hover) */}
                  {/* Quitado 'truncate' para permitir multilínea, y añadido break-words/whitespace-normal */}
                  <p className="text-sm font-medium leading-tight whitespace-normal break-words">
                    {conv.titulo || "Sin título"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{fecha}</p>
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-11 w-11 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      aria-label={`Eliminar conversación ${conv.titulo || "sin título"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar conversación?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se borrarán todos los mensajes de esta conversación. Esta acción no se puede deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => onEliminar(conv.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Eliminar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
