import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, Loader2, MoreHorizontal, RotateCcw, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { accionesDisponibles } from "@/lib/reservas/accionesReserva";
import { ESTADO_LLEGADA, ESTADO_NO_SHOW, etiquetaEstadoReserva } from "@/lib/reservas/estadosReserva";
import { formatearHoraLlegada, type ReservaServicio } from "@/lib/reservas/servicioSala";
import type { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";

type Acciones = ReturnType<typeof useAccionesServicioReserva>;

interface ControlLlegadaProps {
  reserva: ReservaServicio;
  acciones: Acciones;
  /**
   * Permiso de edición sobre «reservas». Obligatorio a propósito: sin él no sale ningún
   * botón (06/11/2026, decisión del dueño: se ocultan, no se desactivan); solo el chip del
   * estado («Llegó 14:23» / «No vino»). Qué botones hay y cuáles se pueden pulsar lo decide
   * `accionesDisponibles(…, { vista: "hoy" })`.
   */
  canEdit: boolean;
  /** Versión reducida para las tarjetas del Kanban. */
  compacto?: boolean;
  /**
   * Sin textos: solo el icono (2026-09-26, petición del dueño). La fila de
   * acciones es lo más ancho de la tarjeta —«Ha llegado» son 92px— y marcaba
   * el suelo del ancho de columna del kanban. Quitándole el texto, el kanban
   * puede estrechar las columnas lo bastante para que a 1024px se sigan viendo
   * las cinco de Casa Tomás, en vez de esconder dos tras un desplazamiento.
   * El texto no se pierde: va en `aria-label` y en `title` (globo al pasar el
   * ratón), así que ni el lector de pantalla ni el ratón se quedan sin él.
   */
  soloIcono?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Registrar la llegada del cliente ("Ha llegado"), marcar "No vino" y deshacer
 * cualquiera de las dos. No envía correos (ver useAccionesServicioReserva.ts).
 *
 * Los eventos de puntero/teclado no se propagan: dentro de una tarjeta
 * arrastrable del Kanban, pulsar Enter o hacer clic aquí no debe iniciar
 * un arrastre.
 *
 * Sin permiso de edición no hay botones (ni «Ha llegado» ni «Deshacer»): queda el
 * chip con el estado si ya llegó o no vino, que es información, no una acción.
 */
export function ControlLlegada({ reserva, acciones, canEdit, compacto, soloIcono, disabled, className }: ControlLlegadaProps) {
  const ocupado = disabled || acciones.estaEnCurso(reserva.id);
  const nombre = reserva.nombre || "el cliente";
  const detener = {
    // La fila entera es de la llegada: un toque en ella no abre el menú de la tarjeta (`ReservaCard`).
    "data-sin-menu-tarjeta": "",
    onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
    // El kanban arrastra con `TouchSensor`, que escucha `touchstart` en la
    // tarjeta: sin esto, un toque de >=200 ms sobre un botón de aquí arrancaba
    // un arrastre y dnd-kit se tragaba el clic.
    onTouchStart: (e: React.SyntheticEvent) => e.stopPropagation(),
    onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  };

  // Qué hay y qué se puede pulsar. Sin permiso, nada (todo `visible: false`).
  const { haLlegado: llegada, noVino, deshacer } = accionesDisponibles(reserva, { vista: "hoy", canEdit });

  if (reserva.estado === ESTADO_LLEGADA) {
    const hora = formatearHoraLlegada(reserva.llegada_at);
    const etiqueta = etiquetaEstadoReserva(reserva.estado);
    const etiquetaLlegada = hora ? `${etiqueta} ${hora}` : etiqueta;
    return (
      <div className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-1", soloIcono && "gap-y-1", className)} {...detener}>
        <span
          className={cn(
            "inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium",
            compacto ? "text-[11px] pointer-coarse:text-xs px-1.5 py-0.5" : "text-xs px-2 py-1",
          )}
          // En modo icono la etiqueta se reduce a la hora ("14:23"), que es el
          // dato que cambia; el "Llegó" lo dice ya la palomita verde, y el
          // texto entero sigue en el `title` y en el `aria-label`.
          title={etiquetaLlegada}
          aria-label={etiquetaLlegada}
        >
          <Check className="h-3 w-3" aria-hidden="true" />
          {soloIcono ? hora && <span aria-hidden="true">{hora}</span> : <span aria-hidden="true" className="truncate">{etiquetaLlegada}</span>}
        </span>
        {deshacer.visible && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={ocupado || !deshacer.habilitada}
            onClick={() => acciones.deshacerLlegadaONoShow(reserva)}
            aria-label={`${deshacer.titulo} de ${nombre}`}
            title={deshacer.titulo}
          >
            {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          </Button>
        )}
      </div>
    );
  }

  if (reserva.estado === ESTADO_NO_SHOW) {
    // `No vino`: la única otra reserva con «Deshacer» (ver `accionesDisponibles`).
    const etiqueta = etiquetaEstadoReserva(reserva.estado);
    return (
      <div className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-1", soloIcono && "gap-y-1", className)} {...detener}>
        <span
          className={cn(
            "inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-md bg-muted text-muted-foreground font-medium",
            compacto ? "text-[11px] pointer-coarse:text-xs px-1.5 py-0.5" : "text-xs px-2 py-1",
          )}
          title={etiqueta}
          aria-label={etiqueta}
        >
          <UserX className="h-3 w-3" aria-hidden="true" />
          {!soloIcono && <span aria-hidden="true" className="truncate">{etiqueta}</span>}
        </span>
        {deshacer.visible && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={ocupado || !deshacer.habilitada}
            onClick={() => acciones.deshacerLlegadaONoShow(reserva)}
            aria-label={`${deshacer.titulo} de ${nombre}`}
            title={deshacer.titulo}
          >
            {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          </Button>
        )}
      </div>
    );
  }

  if (!llegada.visible) return null;

  return (
    <div className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-1", soloIcono && "gap-y-1", className)} {...detener}>
      <Button
        type="button"
        // Sin texto es un botón de icono: así en táctil sube a 44x44 (el
        // `size="sm"` con `w-6 p-0` chocaba con el `px-4` táctil de ui/button).
        size={soloIcono ? "icon" : "sm"}
        variant="outline"
        className={cn(
          "min-w-0 max-w-full gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40",
          compacto ? "h-6 text-[11px] pointer-coarse:text-xs" : "h-7 text-xs",
          "pointer-coarse:text-sm",
          // Sin texto queda cuadrado (24px de lado en compacto): es la mitad
          // de ancho que con «Ha llegado», y eso es justo lo que permite
          // estrechar la columna del kanban sin esconder ninguna.
          soloIcono ? (compacto ? "w-6 p-0" : "w-7 p-0") : compacto ? "px-2" : "px-2.5",
        )}
        disabled={ocupado || !llegada.habilitada}
        onClick={() => acciones.marcarLlegada(reserva)}
        aria-label={`Marcar que ${nombre} ha llegado`}
        title={llegada.titulo}
      >
        {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        {!soloIcono && "Ha llegado"}
      </Button>
      {noVino.visible && (
        <DropdownMenu>
          {/* `disabled` también en el disparador de Radix: es él quien decide si abre el menú. */}
          <DropdownMenuTrigger asChild disabled={ocupado || !noVino.habilitada}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={compacto ? "h-6 w-6" : "h-7 w-7"}
              disabled={ocupado || !noVino.habilitada}
              aria-label={`Más opciones de llegada para ${nombre}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => acciones.marcarNoShow(reserva)}>
              <UserX className="h-4 w-4 mr-2" />
              {noVino.titulo}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
