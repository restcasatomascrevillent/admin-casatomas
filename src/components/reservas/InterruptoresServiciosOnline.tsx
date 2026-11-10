import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useServiciosBloqueados, type TurnoBloqueable } from "@/hooks/useServiciosBloqueados";

const AYUDA = "Solo afecta a la web y al teléfono automático; desde el panel se puede seguir apuntando";

const TURNOS: Array<{ turno: TurnoBloqueable; etiqueta: string }> = [
  { turno: "comida", etiqueta: "Reservas online comida" },
  { turno: "cena", etiqueta: "Reservas online cena" },
];

/**
 * Dos interruptores para el día que se está viendo en «Hoy»: activado = ese servicio admite reservas
 * de la web y del teléfono automático; desactivado = bloqueado. Compacto (una fila, sin ocupar alto);
 * la ayuda va en una línea pequeña debajo. Sin «Editar» en Reservas se ven pero no se tocan.
 */
export function InterruptoresServiciosOnline({ fecha, className }: { fecha: string; className?: string }) {
  const { estaBloqueado, cambiar, disponible, guardando } = useServiciosBloqueados(fecha);
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}
      data-testid="interruptores-servicios-online"
    >
      {TURNOS.map(({ turno, etiqueta }) => {
        const id = `servicio-online-${turno}`;
        return (
          <div key={turno} className="flex items-center gap-2">
            <Switch
              id={id}
              checked={!estaBloqueado(turno)}
              disabled={!disponible || !puedeEditar || guardando}
              onCheckedChange={(admite) => cambiar(turno, !admite)}
            />
            <Label htmlFor={id} className="whitespace-nowrap text-sm font-medium">
              {etiqueta}
            </Label>
          </div>
        );
      })}
      <p className="w-full text-[11px] leading-tight text-muted-foreground">{AYUDA}.</p>
    </div>
  );
}

/** Insignia pequeña «Menú del día» de una reserva (Hoy, ficha y lista). Nada si no lo es. */
export function InsigniaMenuDelDia({ reserva, className }: { reserva: { menu_del_dia?: boolean | null }; className?: string }) {
  if (!reserva.menu_del_dia) return null;
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
