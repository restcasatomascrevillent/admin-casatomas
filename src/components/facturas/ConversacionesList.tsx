import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversacion } from "@/hooks/useChatFacturas";

interface ConversacionesListProps {
  conversaciones: Conversacion[];
  conversacionActiva: Conversacion | null;
  onSeleccionar: (conv: Conversacion) => void;
  onNueva: () => void;
  onEliminar: (convId: string, sessionId: string) => void;
}

export function ConversacionesList({
  conversaciones,
  conversacionActiva,
  onSeleccionar,
  onNueva,
  onEliminar,
}: ConversacionesListProps) {
  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-3 border-b">
        <Button onClick={onNueva} className="w-full gap-2" size="sm">
          <Plus className="h-4 w-4" />
          Nueva conversación
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {conversaciones.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              Sin conversaciones
            </p>
          )}
          {conversaciones.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm cursor-pointer group hover:bg-accent transition-colors",
                conversacionActiva?.id === conv.id && "bg-accent"
              )}
              onClick={() => onSeleccionar(conv)}
            >
              <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1">
                {conv.titulo || "Sin título"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onEliminar(conv.id, conv.session_id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
