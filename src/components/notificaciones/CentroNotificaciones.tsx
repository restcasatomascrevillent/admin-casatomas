import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell, CheckCheck, Clock, AlertTriangle, Info } from "lucide-react";
import { useNotificacionesDashboard } from "@/hooks/useNotificacionesDashboard";
import { cn } from "@/lib/utils";

const TIPO_ICON: Record<string, typeof AlertTriangle> = {
  solicitud_pendiente: AlertTriangle,
  reserva_nueva: Clock,
  sistema: Info,
};

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `hace ${diffD}d`;
}

export function CentroNotificaciones() {
  const { notificaciones, countNoLeidas, marcarLeida, marcarTodasLeidas } =
    useNotificacionesDashboard();
  const navigate = useNavigate();

  const handleClick = (notif: (typeof notificaciones)[0]) => {
    marcarLeida(notif.id);
    // Navegar a la pestaña de solicitudes si es una solicitud pendiente
    if (notif.referencia_tipo === "solicitud") {
      navigate("/reservas?tab=solicitudes");
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-4 w-4" />
          {countNoLeidas > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 text-[10px] bg-destructive text-destructive-foreground">
              {countNoLeidas > 99 ? "99+" : countNoLeidas}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" sideOffset={8}>
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b">
          <span className="text-sm font-medium">Notificaciones</span>
          {countNoLeidas > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={marcarTodasLeidas}
            >
              <CheckCheck className="h-3 w-3" />
              Marcar todas
            </Button>
          )}
        </div>

        {/* Lista */}
        <ScrollArea className="max-h-[360px]">
          {notificaciones.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Sin notificaciones
            </div>
          ) : (
            <div className="divide-y">
              {notificaciones.map((notif) => {
                const Icon = TIPO_ICON[notif.tipo] || Info;
                return (
                  <button
                    key={notif.id}
                    className={cn(
                      "w-full text-left p-3 hover:bg-muted/50 transition-colors flex gap-3",
                      !notif.leida && "bg-primary/5"
                    )}
                    onClick={() => handleClick(notif)}
                  >
                    <div className="shrink-0 mt-0.5">
                      <Icon
                        className={cn(
                          "h-4 w-4",
                          !notif.leida ? "text-amber-500" : "text-muted-foreground"
                        )}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "text-sm truncate",
                          !notif.leida && "font-medium"
                        )}
                      >
                        {notif.titulo}
                      </p>
                      {notif.mensaje && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {notif.mensaje}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {timeAgo(notif.created_at)}
                      </p>
                    </div>
                    {!notif.leida && (
                      <div className="shrink-0 mt-1">
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
