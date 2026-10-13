// ============================================================================
// CIERRE DEL DÍA — encima del panel del día en la pestaña Calendario
// ----------------------------------------------------------------------------
// Encargo del dueño (2026-10-13): cerrar a mano un día (o un servicio) para
// que la web y el teléfono no cojan reservas, volver a abrirlo y abrir un día
// que cierra por defecto (lunes, jueves, domingo noche). Las reservas manuales
// del panel siguen siendo posibles (solo avisan). Ver `useCierresReserva`.
// ============================================================================
import { Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCambiarCierre } from "@/hooks/useCierresReserva";
import {
  TURNOS_SERVICIO,
  type ServicioCerrado,
  type TurnoServicio,
} from "../../../supabase/functions/_shared/cierres";

const NOMBRE_TURNO: Record<TurnoServicio, string> = { comida: "Comida", cena: "Cena" };

export interface CierreDiaControlProps {
  /** YYYY-MM-DD */
  fecha: string;
  /** Servicios cerrados de ese día (de `useCierresReserva`). */
  cierres: readonly ServicioCerrado[];
  esPasado: boolean;
  /** Migración sin aplicar: se enseña la regla por defecto y no se guarda. */
  esquemaPendiente?: boolean;
}

export function CierreDiaControl({ fecha, cierres, esPasado, esquemaPendiente }: CierreDiaControlProps) {
  // Sin permiso de escritura en «reservas», la RLS de `cierres_reserva` lo
  // rechaza y se avisa con el error (no se consulta el rol aquí).
  const cambiar = useCambiarCierre();
  const cerrado = (t: TurnoServicio) => cierres.find((c) => c.turno === t);
  const todoCerrado = TURNOS_SERVICIO.every((t) => cerrado(t));
  const bloqueado = esPasado || cambiar.isPending || !!esquemaPendiente;

  const aplicar = (turnos: readonly TurnoServicio[], cerrar: boolean) => {
    cambiar.mutate(
      { fecha, turnos, cerrar },
      {
        onSuccess: () =>
          toast.success(
            cerrar
              ? "Cerrado para reservas por web y teléfono"
              : "Abierto: la web y el teléfono ya admiten reservas",
          ),
        onError: (e) => toast.error((e as Error)?.message || "No se pudo guardar el cierre"),
      },
    );
  };

  return (
    <div
      data-testid="cierre-dia"
      className={cn(
        "mb-3 shrink-0 rounded-lg border p-2.5",
        todoCerrado ? "border-destructive/40 bg-destructive/5" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {todoCerrado ? (
            <Lock className="h-4 w-4 text-destructive" aria-hidden="true" />
          ) : (
            <LockOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
          {todoCerrado ? "Cerrado para reservas" : "Reservas web y teléfono"}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8"
          disabled={bloqueado}
          onClick={() => aplicar(TURNOS_SERVICIO, !todoCerrado)}
        >
          {todoCerrado ? "Abrir el día" : "Cerrar el día"}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
        {TURNOS_SERVICIO.map((t) => {
          const c = cerrado(t);
          const id = `cierre-${fecha}-${t}`;
          return (
            <div key={t} className="flex items-center gap-2">
              <Switch
                id={id}
                checked={!c}
                disabled={bloqueado}
                onCheckedChange={(abierto) => aplicar([t], !abierto)}
                aria-label={`${NOMBRE_TURNO[t]}: ${c ? "cerrada" : "abierta"} para reservas`}
              />
              <label htmlFor={id} className="text-sm">
                {NOMBRE_TURNO[t]}{" "}
                <span className={cn("text-xs", c ? "text-destructive" : "text-muted-foreground")}>
                  {c ? (c.origen === "semanal" ? "cerrada (cierre semanal)" : "cerrada a mano") : "abierta"}
                </span>
              </label>
            </div>
          );
        })}
      </div>
      {esquemaPendiente && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Se ven los cierres por defecto. Para cambiarlos falta aplicar la migración de cierres.
        </p>
      )}
      {!esquemaPendiente && cierres.length > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Desde el panel se puede reservar igualmente (solo avisa).
        </p>
      )}
    </div>
  );
}
