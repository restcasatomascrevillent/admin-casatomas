import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, Loader2, MoreHorizontal, RotateCcw, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ESTADO_NO_SHOW,
  esperandoLlegada,
  formatearHoraLlegada,
  haLlegado,
  type ReservaServicio,
} from "@/lib/reservas/servicioSala";
import type { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";

type Acciones = ReturnType<typeof useAccionesServicioReserva>;

interface ControlLlegadaProps {
  reserva: ReservaServicio;
  acciones: Acciones;
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
 * Registrar la llegada del cliente ("Ha llegado"), marcar "No se presentó"
 * y deshacer cualquiera de las dos. No envía correos (ver
 * useAccionesServicioReserva.ts).
 *
 * Los eventos de puntero/teclado no se propagan: dentro de una tarjeta
 * arrastrable del Kanban, pulsar Enter o hacer clic aquí no debe iniciar
 * un arrastre.
 */
export function ControlLlegada({ reserva, acciones, compacto, soloIcono, disabled, className }: ControlLlegadaProps) {
  const ocupado = disabled || acciones.estaEnCurso(reserva.id);
  const nombre = reserva.nombre || "el cliente";
  const detener = {
    onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
    onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  };

  if (haLlegado(reserva.estado)) {
    const hora = formatearHoraLlegada(reserva.llegada_at);
    const etiquetaLlegada = hora ? `Llegó ${hora}` : "Llegó";
    return (
      <div className={cn("flex items-center gap-1", soloIcono && "flex-wrap gap-y-1", className)} {...detener}>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium",
            compacto ? "text-[11px] px-1.5 py-0.5" : "text-xs px-2 py-1",
          )}
          // En modo icono la etiqueta se reduce a la hora ("14:23"), que es el
          // dato que cambia; el "Llegó" lo dice ya la palomita verde, y el
          // texto entero sigue en el `title` y en el `aria-label`.
          title={etiquetaLlegada}
          aria-label={etiquetaLlegada}
        >
          <Check className="h-3 w-3" aria-hidden="true" />
          {soloIcono ? hora && <span aria-hidden="true">{hora}</span> : <span aria-hidden="true">{etiquetaLlegada}</span>}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={ocupado}
          onClick={() => acciones.deshacerLlegadaONoShow(reserva)}
          aria-label={`Deshacer llegada de ${nombre}`}
          title="Deshacer llegada"
        >
          {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
        </Button>
      </div>
    );
  }

  if (reserva.estado === ESTADO_NO_SHOW) {
    return (
      <div className={cn("flex items-center gap-1", soloIcono && "flex-wrap gap-y-1", className)} {...detener}>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md bg-muted text-muted-foreground font-medium",
            compacto ? "text-[11px] px-1.5 py-0.5" : "text-xs px-2 py-1",
          )}
          title="No vino"
          aria-label="No vino"
        >
          <UserX className="h-3 w-3" aria-hidden="true" />
          {!soloIcono && <span aria-hidden="true">No vino</span>}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={ocupado}
          onClick={() => acciones.deshacerLlegadaONoShow(reserva)}
          aria-label={`Quitar «no se presentó» de ${nombre}`}
          title="Deshacer «no se presentó»"
        >
          {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
        </Button>
      </div>
    );
  }

  if (!esperandoLlegada(reserva.estado)) return null;

  return (
    <div className={cn("flex items-center gap-1", soloIcono && "flex-wrap gap-y-1", className)} {...detener}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn(
          "gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40",
          compacto ? "h-6 text-[11px]" : "h-7 text-xs",
          // Sin texto queda cuadrado (24px de lado en compacto): es la mitad
          // de ancho que con «Ha llegado», y eso es justo lo que permite
          // estrechar la columna del kanban sin esconder ninguna.
          soloIcono ? (compacto ? "w-6 p-0" : "w-7 p-0") : compacto ? "px-2" : "px-2.5",
        )}
        disabled={ocupado}
        onClick={() => acciones.marcarLlegada(reserva)}
        aria-label={`Marcar que ${nombre} ha llegado`}
        title="Ha llegado"
      >
        {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        {!soloIcono && "Ha llegado"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={compacto ? "h-6 w-6" : "h-7 w-7"}
            disabled={ocupado}
            aria-label={`Más opciones de llegada para ${nombre}`}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => acciones.marcarNoShow(reserva)}>
            <UserX className="h-4 w-4 mr-2" />
            No se presentó
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
