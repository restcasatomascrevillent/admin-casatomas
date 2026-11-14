import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { reservaDeAviso, rutaDeAviso, TIPO_ICON } from "@/lib/avisos";
import { useAbrirAviso } from "@/hooks/useAbrirAviso";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, CalendarClock, Check, CheckCheck, Info, Trash2 } from "lucide-react";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useReservasPorGestionar } from "@/hooks/useReservasPorGestionar";
import { contarAvisosSinLeer } from "@/lib/reservas/porGestionar";
import { useNotificacionesDashboard } from "@/hooks/useNotificacionesDashboard";
import { cn } from "@/lib/utils";
import { AjustesAvisosEnVivo } from "@/components/notificaciones/AvisosEnVivo";
import { useEstadoAvisosEnVivo } from "@/hooks/useAvisosEnVivo";
import { avisosEnVivo } from "@/lib/avisosEnVivo/preferencias";
import { AccionesAvisoStoryTapas, datosAvisoStoryTapas } from "@/components/instagram/tapas/AvisoStoryTapas";

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

interface CentroNotificacionesProps {
  /** Clases para el botón-campana. Existe porque desde el 2026-09-25 la
   * campana vive dentro del menú lateral (AppSidebar), que tiene su propia
   * paleta (`sidebar-*`) distinta de la del resto del panel. */
  className?: string;
}

export function CentroNotificaciones({ className }: CentroNotificacionesProps = {}) {
  const { notificaciones, countNoLeidas, marcarLeida, marcarTodasLeidas, eliminarNotificacion } =
    useNotificacionesDashboard();
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(false);
  // «Por gestionar»: reservas sin confirmar y solicitudes del bot. Solo con permiso de Reservas.
  const { canAccess: veReservas } = useCanAccessSection("reservas");
  const { items: porGestionar, count: countPorGestionar } = useReservasPorGestionar(veReservas);
  // Los avisos de solicitud ya salen en «Por gestionar»: no se cuentan dos veces.
  const total = countPorGestionar + contarAvisosSinLeer(notificaciones, veReservas);
  // Algo nuevo que nadie ha mirado (AvisosEnVivo): la campana late hasta que se abre.
  const { sinVer } = useEstadoAvisosEnVivo();
  const late = sinVer > 0 && total > 0;
  const cambiarAbierto = (valor: boolean) => {
    setAbierto(valor);
    if (valor) avisosEnVivo.marcarVistos();
  };

  // «Ver» en una reserva abre su ficha en un modal (11/11/2026); lo demás, su origen. La campana se cierra antes.
  const { abrirAviso, dialogoAviso } = useAbrirAviso();
  const handleClick = (notif: (typeof notificaciones)[0]) => {
    marcarLeida(notif.id);
    if (rutaDeAviso(notif) || reservaDeAviso(notif)) setAbierto(false);
    abrirAviso(notif);
  };

  return (
    <>
    <Popover open={abierto} onOpenChange={cambiarAbierto}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative h-9 w-9 transition-transform duration-150 hover:scale-105 active:scale-95",
            className
          )}
          aria-label={
            total > 0
              ? `${total} pendientes de gestionar o sin leer`
              : "Notificaciones"
          }
        >
          <Bell className={cn("h-4 w-4", total > 0 && "text-red-600 dark:text-red-400", late && "motion-safe:animate-pulse")} />
          {late && (
            <span aria-hidden="true" className="pointer-events-none absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-red-500/60 motion-safe:animate-ping" />
          )}
          {total > 0 && (
            <Badge
              data-testid="campana-cifra"
              className="absolute -top-1.5 -right-1.5 h-6 min-w-6 animate-in justify-center rounded-full border-2 border-background bg-red-600 px-1 text-xs font-bold leading-none tabular-nums text-white zoom-in-50 hover:bg-red-600"
            >
              {total > 99 ? "99+" : total}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      {/* `align="start"` (2026-09-25): la campana se mudó de la esquina
          derecha de la cabecera al menú lateral (izquierda), así que el panel
          debe crecer hacia la derecha. Con el "end" de antes quedaba anclado
          al borde de la ventana por la corrección de colisiones, no al botón.
          `collisionPadding` evita que se pegue al borde en móvil. */}
      <PopoverContent className="w-[min(20rem,calc(100vw-1rem))] p-0" align="start" sideOffset={8} collisionPadding={8}>
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b">
          <span className="text-sm font-medium">Notificaciones</span>
          {countNoLeidas > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 transition-colors pointer-coarse:text-sm"
              onClick={marcarTodasLeidas}
            >
              <CheckCheck className="h-3 w-3" />
              Marcar todas
            </Button>
          )}
        </div>

        {veReservas && porGestionar.length > 0 && (
          <div className="border-b" data-testid="campana-por-gestionar">
            <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">Por gestionar ({porGestionar.length})</p>
            <div className="max-h-[min(200px,25vh)] divide-y overflow-y-auto overscroll-contain">
              {porGestionar.map((it) => (
                <button
                  key={it.clave}
                  type="button"
                  className="flex w-full min-w-0 items-start gap-3 p-3 text-left transition-colors hover:bg-muted/50"
                  onClick={() => {
                    setAbierto(false);
                    navigate(it.ruta);
                  }}
                >
                  <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {it.nombre}
                      {it.personas ? ` · ${it.personas} pers.` : ""}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {it.fecha ? it.fecha.split("-").reverse().slice(0, 2).join("/") : "Sin fecha"}
                      {it.hora ? ` · ${it.hora}` : ""} · {it.tipo === "solicitud" ? "Solicitud: " : ""}
                      {it.detalle}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="max-h-[min(320px,50vh)] overflow-y-auto overscroll-contain custom-scrollbar">
          {notificaciones.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Sin notificaciones
            </div>
          ) : (
            <div className="divide-y">
              {notificaciones.map((notif) => {
                const Icon = TIPO_ICON[notif.tipo] || Info;
                // Story del jueves de tapas: «Ver», «Publicar ahora», «Cambiar hora» y «Cancelar» debajo.
                const storyTapas = datosAvisoStoryTapas(notif);
                return (
                  <div key={notif.id}>
                  <div
                    className={cn(
                      "group flex items-stretch gap-1 transition-colors hover:bg-muted/50",
                      !notif.leida && "bg-primary/5"
                    )}
                  >
                    <button
                      type="button"
                      className="flex flex-1 min-w-0 gap-3 p-3 text-left"
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
                        <div className="flex items-center gap-1.5">
                          <p
                            className={cn(
                              "text-sm truncate",
                              !notif.leida && "font-medium"
                            )}
                          >
                            {notif.titulo}
                          </p>
                          {!notif.leida && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          )}
                        </div>
                        {notif.mensaje && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {notif.mensaje}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {timeAgo(notif.created_at)}
                        </p>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5 pr-2">
                      {!notif.leida && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-90"
                          title="Marcar como leída"
                          aria-label="Marcar como leída"
                          onClick={(e) => {
                            e.stopPropagation();
                            marcarLeida(notif.id);
                          }}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive active:scale-90"
                        title="Eliminar notificación"
                        aria-label="Eliminar notificación"
                        onClick={(e) => {
                          e.stopPropagation();
                          eliminarNotificacion(notif.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {storyTapas && <AccionesAvisoStoryTapas datos={storyTapas} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {veReservas && <AjustesAvisosEnVivo className="border-t px-3 py-2" />}

        <div className="border-t p-2">
          <Button
            variant="ghost"
            className="h-10 w-full text-sm"
            onClick={() => {
              setAbierto(false);
              navigate("/avisos");
            }}
          >
            Ver todos los avisos
          </Button>
        </div>
      </PopoverContent>
    </Popover>
    {dialogoAviso}
    </>
  );
}
