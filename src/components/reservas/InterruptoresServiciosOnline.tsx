import { useState } from "react";
import { textoInsigniaMenu } from "@/lib/reservas/menuCerrado";
import { servicioComidaDeReserva } from "@/lib/reservas/menuDelDia";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Info, Lock, LockOpen } from "lucide-react";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCanAccessSection } from "@/hooks/useUserRole";
import {
  useServiciosBloqueados,
  type TurnoBloqueable,
} from "@/hooks/useServiciosBloqueados";

const AYUDA =
  "La web y el teléfono automático dejarán de aceptar reservas para ese servicio. Desde el panel se puede seguir apuntando.";

const TURNOS: Array<{
  turno: TurnoBloqueable;
  abrir: string;
  cerrado: string;
  servicio: string;
}> = [
  {
    turno: "comida",
    abrir: "Cerrar comida",
    cerrado: "Comida cerrada",
    servicio: "comida",
  },
  {
    turno: "cena",
    abrir: "Cerrar noche",
    cerrado: "Noche cerrada",
    servicio: "noche",
  },
];

function fechaLegible(fecha: string): string {
  try {
    return format(parseISO(fecha), "EEEE dd/MM", { locale: es });
  } catch {
    return fecha;
  }
}

/**
 * Dos botones para el día que se está viendo en «Hoy»: «Cerrar comida» / «Cerrar noche». Al pulsar
 * pregunta antes de cerrar (o de volver a abrir). Cerrado = botón rojo relleno «Comida cerrada».
 * Solo afecta a la web y al teléfono automático. Sin «Editar» en Reservas se ven pero no se tocan.
 */
export function InterruptoresServiciosOnline({
  fecha,
  className,
}: {
  fecha: string;
  className?: string;
}) {
  const { estaBloqueado, cambiar, disponible, guardando } =
    useServiciosBloqueados(fecha);
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const [preguntando, setPreguntando] = useState<TurnoBloqueable | null>(null);
  const activo = TURNOS.find((t) => t.turno === preguntando) ?? null;
  const cerrando = activo ? !estaBloqueado(activo.turno) : false;
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      data-testid="interruptores-servicios-online"
    >
      {TURNOS.map(({ turno, abrir, cerrado }) => {
        const bloqueado = estaBloqueado(turno);
        return (
          <Button
            key={turno}
            type="button"
            size="sm"
            variant={bloqueado ? "destructive" : "outline"}
            className="touch-hit min-h-11 gap-2"
            data-testid={`boton-servicio-online-${turno}`}
            aria-pressed={bloqueado}
            disabled={!disponible || !puedeEditar || guardando}
            onClick={() => setPreguntando(turno)}
          >
            {bloqueado ? (
              <Lock className="h-4 w-4" aria-hidden />
            ) : (
              <LockOpen className="h-4 w-4" aria-hidden />
            )}
            {bloqueado ? cerrado : abrir}
          </Button>
        );
      })}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Qué hace cerrar un servicio"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground"
            >
              <Info className="h-4 w-4" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{AYUDA}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <AlertDialog
        open={!!activo}
        onOpenChange={(abierto) => !abierto && setPreguntando(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cerrando
                ? `¿Cerrar las reservas online de la ${activo?.servicio} de hoy (${fechaLegible(fecha)})?`
                : `¿Volver a abrir las reservas online de la ${activo?.servicio} de hoy (${fechaLegible(fecha)})?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cerrando
                ? AYUDA
                : "La web y el teléfono automático volverán a aceptar reservas para ese servicio."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                "min-h-11",
                cerrando &&
                  "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
              onClick={() => activo && cambiar(activo.turno, cerrando)}
            >
              {cerrando ? "Sí, cerrar" : "Sí, abrir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Insignia pequeña «Menú del día» de una reserva (Hoy, ficha y lista). De martes a jueves en la
 * comida, si la reserva trae `fecha` y `hora` y NO es de menú, sale «Carta» (discreta) para ver el
 * reparto del servicio. Nada en el resto de casos.
 */
export function InsigniaMenuDelDia({
  reserva,
  className,
}: {
  reserva: { menu_del_dia?: boolean | null; fecha?: string | null; hora?: string | null };
  className?: string;
}) {
  if (!reserva.menu_del_dia) {
    if (servicioComidaDeReserva({ fecha: reserva.fecha, hora: reserva.hora, menu_del_dia: false }) !== "carta") return null;
    return (
      <span
        data-testid="insignia-carta"
        className={cn(
          "inline-flex shrink-0 items-center rounded-full border border-sky-300 px-2 py-0.5 text-xs font-medium text-sky-800 dark:border-sky-800 dark:text-sky-300",
          className,
        )}
      >
        Carta
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900 dark:bg-violet-950/60 dark:text-violet-200",
        className,
      )}
    >
      Menú del día
    </span>
  );
}

/**
 * Insignia del «Menú cerrado» (de grupo) de una reserva: «Menú 55 €», o «Menú cerrado» sin
 * precio. Nada si no lleva. Aparte (y de otro color) que la del «Menú del día».
 */
export function InsigniaMenuCerrado({
  reserva,
  className,
}: {
  reserva: { menu_cerrado?: boolean | null; menu_precio?: number | string | null };
  className?: string;
}) {
  if (!reserva.menu_cerrado) return null;
  return (
    <span
      data-testid="insignia-menu-cerrado"
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-900 dark:bg-teal-950/60 dark:text-teal-200",
        className,
      )}
    >
      {textoInsigniaMenu(reserva.menu_precio)}
    </span>
  );
}
