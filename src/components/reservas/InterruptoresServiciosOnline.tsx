import { textoInsigniaMenu } from "@/lib/reservas/menuCerrado";
import { textoZona } from "@/lib/reservas/zonaPreferida";
import { servicioComidaDeReserva } from "@/lib/reservas/menuDelDia";
import { useState } from "react";
import { Lock, LockOpen } from "lucide-react";
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
import { etiquetaDiaReservas } from "@/lib/reservas/vistaHoy";
import { Button } from "@/components/ui/button";
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
    abrir: "Cerrar cena",
    cerrado: "Cena cerrada",
    servicio: "cena",
  },
];

/**
 * Dos botones para el día que se está viendo en Reservas: «Cerrar comida» / «Cerrar cena» (el día elegido con las
 * flechas, 11/11/2026). CERRAR pide confirmación (12/11/2026, petición del dueño: «añade modal de confirmación al
 * cerrar comida o cena»; del 11/11 al 12/11 cerraba sin preguntar); volver a abrir es un toque. Cerrado = botón rojo
 * relleno «Comida cerrada».
 * Solo afecta a la web y al teléfono automático. Sin «Editar» en Reservas se ven pero no se tocan.
 */
export function InterruptoresServiciosOnline({
  fecha,
  className,
  compacta = false,
}: {
  fecha: string;
  className?: string;
  /** Móvil (10/11/2026): los dos botones en UNA fila, sin saltar de línea. Si no cabe, el texto se corta con «…».
   * Sin la ayuda (i) desde el 11/11/2026 (petición del dueño): la explicación va en el `title` de cada botón. */
  compacta?: boolean;
}) {
  const { estaBloqueado, cambiar, disponible, guardando } =
    useServiciosBloqueados(fecha);
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  // El turno que se va a cerrar, a la espera del «Sí, cerrar».
  const [porCerrar, setPorCerrar] = useState<(typeof TURNOS)[number] | null>(null);
  return (
    <>
    <div
      className={cn("flex items-center", compacta ? "flex-nowrap gap-1.5" : "flex-wrap gap-2", className)}
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
            className={cn("touch-hit min-h-11", compacta ? "h-auto min-w-0 flex-1 flex-col gap-0 px-1.5 py-1 leading-tight" : "gap-2")}
            // Compacta: el nombre accesible entero («Cerrar comida»), aunque se pinte en dos líneas.
            aria-label={compacta ? (bloqueado ? cerrado : abrir) : undefined}
            data-testid={`boton-servicio-online-${turno}`}
            aria-pressed={bloqueado}
            disabled={!disponible || !puedeEditar || guardando}
            // Cerrar pregunta antes; abrir, directo.
            onClick={() => (bloqueado ? cambiar(turno, false) : setPorCerrar(TURNOS.find((t) => t.turno === turno) ?? null))}
            title={AYUDA}
          >
            {/* En el móvil (compacta) sin candado: así «Comida cerrada» cabe entero. */}
            {compacta ? null : bloqueado ? (
              <Lock className="h-4 w-4" aria-hidden />
            ) : (
              <LockOpen className="h-4 w-4" aria-hidden />
            )}
            {/* Móvil (12/11/2026, captura del dueño: «Cerrar co…» cortado a 390 px): en dos líneas, como «Sentar / Elegir
                mesa» de las filas; arriba lo que hace el botón y abajo el turno, que siempre cabe. */}
            {compacta ? (
              <>
                <span className="text-xs font-normal">{bloqueado ? "Cerrada" : "Cerrar"}</span>
                <span className="text-sm font-semibold">{turno === "comida" ? "Comida" : "Cena"}</span>
              </>
            ) : (
              <span>{bloqueado ? cerrado : abrir}</span>
            )}
          </Button>
        );
      })}
    </div>
    <AlertDialog open={!!porCerrar} onOpenChange={(abierto) => !abierto && setPorCerrar(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿{porCerrar?.abrir}?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong className="text-foreground">{etiquetaDiaReservas(fecha, fechaHoy())}</strong>: la web y el teléfono automático dejarán de
            aceptar reservas para la {porCerrar?.servicio}. Las reservas que ya hay no cambian y desde el panel se puede seguir apuntando. Se
            vuelve a abrir con un toque.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>No, dejarla abierta</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 text-white hover:bg-red-700"
            onClick={() => {
              if (porCerrar) cambiar(porCerrar.turno, true);
              setPorCerrar(null);
            }}
          >
            Sí, {porCerrar?.abrir.toLowerCase()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

/** Hoy en `yyyy-MM-dd` (hora local), para decir «hoy» o el día en la pregunta. */
function fechaHoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

/**
 * Insignia pequeña «Dentro» / «Fuera» (`reservas.zona_preferida`, 20261122200000): lo que pidió el cliente al
 * reservar. Nada si no se dijo. NO es «Sentar fuera» (Touza), que tiene su propia etiqueta.
 */
export function InsigniaZona({
  reserva,
  className,
}: {
  reserva: { zona_preferida?: string | null };
  className?: string;
}) {
  const texto = textoZona(reserva.zona_preferida);
  if (!texto) return null;
  const fuera = reserva.zona_preferida === "fuera";
  return (
    <span
      data-testid="insignia-zona"
      title={fuera ? "Quiere fuera (Terraza)" : "Quiere dentro"}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        fuera
          ? "border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-300"
          : "border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300",
        className,
      )}
    >
      {texto}
    </span>
  );
}
