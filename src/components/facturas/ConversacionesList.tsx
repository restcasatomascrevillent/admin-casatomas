import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversacion } from "@/hooks/useChatFacturas";

interface ConversacionesListProps {
  conversaciones: Conversacion[];
  conversacionActiva: Conversacion | null;
  onSeleccionar: (conv: Conversacion) => void;
  onNueva: () => void;
  onEliminar: (convId: string) => void;
}

/**
 * Lista plana de conversaciones (estilo ChatGPT): una línea por conversación,
 * fecha pequeña a la derecha y un menú «…» con «Eliminar» que con ratón solo
 * aparece al pasar por encima y en táctil (sin hover) está siempre, a 44 px.
 */
export function ConversacionesList({
  conversaciones,
  conversacionActiva,
  onSeleccionar,
  onNueva,
  onEliminar,
}: ConversacionesListProps) {
  const [aEliminar, setAEliminar] = useState<Conversacion | null>(null);

  return (
    <div className="flex h-full flex-col" data-tour="facturas-ia-historial">
      <div className="px-2 pb-1 pt-2">
        <Button
          onClick={onNueva}
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-sm font-medium text-foreground hover:bg-muted/60 pointer-coarse:min-h-11"
        >
          <Plus className="h-4 w-4 text-gold" aria-hidden />
          Nueva
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="space-y-0.5 px-2 pb-2">
          {conversaciones.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground/70">Sin conversaciones</p>
          )}

          {conversaciones.map((conv) => {
            const isActive = conversacionActiva?.id === conv.id;
            const fecha = new Date(conv.updated_at).toLocaleDateString("es-ES", {
              day: "2-digit",
              month: "short",
            });
            const titulo = conv.titulo || "Sin título";

            return (
              <div
                key={conv.id}
                className={cn(
                  "group relative flex h-9 cursor-pointer items-center gap-2 rounded-md pl-3 pr-2 text-sm transition-colors pointer-coarse:h-11",
                  isActive
                    ? "bg-muted/70 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                onClick={() => onSeleccionar(conv)}
                aria-current={isActive || undefined}
              >
                <span className="min-w-0 flex-1 truncate" title={titulo}>
                  {titulo}
                </span>
                <span className="shrink-0 text-[11px] pointer-coarse:text-xs tabular-nums text-muted-foreground group-hover:invisible group-focus-within:invisible pointer-coarse:visible pointer-coarse:group-hover:visible pointer-coarse:group-focus-within:visible">
                  {fecha}
                </span>

                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Opciones de la conversación ${titulo}`}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity",
                        "hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
                        "group-hover:opacity-100 data-[state=open]:opacity-100",
                        "pointer-coarse:static pointer-coarse:-mr-2 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:translate-y-0 pointer-coarse:opacity-100",
                      )}
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem
                      onSelect={() => setAEliminar(conv)}
                      className="min-h-9 gap-2 text-destructive focus:text-destructive pointer-coarse:min-h-11"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      </div>

      <AlertDialog open={aEliminar !== null} onOpenChange={(abierto) => !abierto && setAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar conversación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra con todos sus mensajes. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (aEliminar) onEliminar(aEliminar.id);
                setAEliminar(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
