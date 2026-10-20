// ============================================================================
// POP-UP DEL DÍA — cerrar / abrir reservas (pestaña Calendario)
// ----------------------------------------------------------------------------
// Encargo del dueño (2026-10-15): el calendario va a todo el ancho, sin panel
// lateral («para no duplicar cosas»); al pulsar CUALQUIER día sale este pop-up
// para cerrar las reservas de ese día: Comida, Cena o Las dos, y abrirlo si
// estaba cerrado (también un día que cierra por defecto: un jueves especial).
// Sustituye a `CierreDiaControl` (13/10), que iba encima del panel del día.
// Misma lógica: `useCambiarCierre` (tabla `cierres_reserva`) y los cierres de
// la RPC `servicios_cerrados_reserva`. Las reservas manuales del panel siguen
// siendo posibles (solo avisan).
// ============================================================================
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useCambiarCierre } from "@/hooks/useCierresReserva";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import {
  TURNOS_SERVICIO,
  cierraPorSemana,
  cierreSemanalDesde,
  type ServicioCerrado,
  type TurnoServicio,
} from "../../../supabase/functions/_shared/cierres";

const NOMBRE_TURNO: Record<TurnoServicio, string> = { comida: "Comida", cena: "Cena" };

export interface DialogoCierreDiaProps {
  /** YYYY-MM-DD del día pulsado; `null` = cerrado. */
  fecha: string | null;
  onClose: () => void;
  /** Servicios cerrados de ese día (de `useCierresReserva`). */
  cierres: readonly ServicioCerrado[];
  esPasado: boolean;
  /** Migración sin aplicar: se enseña la regla por defecto y no se guarda. */
  esquemaPendiente?: boolean;
}

function tituloDia(fecha: string): string {
  const texto = format(parseISO(fecha), "EEEE, d 'de' MMMM", { locale: es });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function DialogoCierreDia({ fecha, onClose, cierres, esPasado, esquemaPendiente }: DialogoCierreDiaProps) {
  // Sin permiso de escritura en «reservas», la RLS de `cierres_reserva` lo
  // rechaza y se avisa con el error (no se consulta el rol aquí).
  const cambiar = useCambiarCierre();
  const { data: configuracion } = useConfiguracionReservas();
  const semanal = cierreSemanalDesde(configuracion);

  const cerrado = (t: TurnoServicio) => cierres.find((c) => c.turno === t);
  const todoCerrado = TURNOS_SERVICIO.every((t) => cerrado(t));
  const bloqueado = esPasado || cambiar.isPending || !!esquemaPendiente;

  const aplicar = (turnos: readonly TurnoServicio[], cerrar: boolean) => {
    if (!fecha) return;
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

  const estado = (t: TurnoServicio) => {
    const c = cerrado(t);
    if (c) return c.origen === "semanal" ? "Cerrada (cierre semanal)" : "Cerrada a mano";
    if (fecha && cierraPorSemana(fecha, t, semanal)) return "Abierta (excepción: normalmente cierra)";
    return "Abierta";
  };

  return (
    <Dialog open={!!fecha} onOpenChange={(abierto) => !abierto && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialogo-cierre-dia">
        {fecha && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">{tituloDia(fecha)}</DialogTitle>
              <DialogDescription>Reservas por la web y por teléfono.</DialogDescription>
            </DialogHeader>

            {/* Estado actual de cada servicio */}
            <ul className="space-y-2" aria-label="Estado del día">
              {TURNOS_SERVICIO.map((t) => {
                const c = cerrado(t);
                return (
                  <li
                    key={t}
                    data-testid={`estado-${t}`}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-base",
                      c ? "border-destructive/40 bg-destructive/5" : "border-border",
                    )}
                  >
                    {c ? (
                      <Lock className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                    ) : (
                      <LockOpen className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className="font-semibold">{NOMBRE_TURNO[t]}:</span>
                    <span className={cn(c ? "text-destructive" : "text-muted-foreground")}>{estado(t)}</span>
                  </li>
                );
              })}
            </ul>

            {/* Acciones: botones grandes (tablet) */}
            <div className="grid grid-cols-2 gap-3">
              {TURNOS_SERVICIO.map((t) => {
                const c = cerrado(t);
                return (
                  <Button
                    key={t}
                    type="button"
                    variant={c ? "default" : "outline"}
                    className="h-14 text-base"
                    disabled={bloqueado}
                    onClick={() => aplicar([t], !c)}
                  >
                    {c ? `Abrir ${NOMBRE_TURNO[t].toLowerCase()}` : `Cerrar ${NOMBRE_TURNO[t].toLowerCase()}`}
                  </Button>
                );
              })}
              <Button
                type="button"
                variant={todoCerrado ? "default" : "destructive"}
                className="col-span-2 h-14 text-base"
                disabled={bloqueado}
                onClick={() => aplicar(TURNOS_SERVICIO, !todoCerrado)}
              >
                {todoCerrado ? "Abrir las dos (todo el día)" : "Cerrar las dos (todo el día)"}
              </Button>
            </div>

            {esPasado && <p className="text-sm text-muted-foreground">Es un día pasado: ya no se puede cambiar.</p>}
            {esquemaPendiente && (
              <p className="text-sm text-muted-foreground">
                Se ven los cierres por defecto. Para cambiarlos falta aplicar la migración de cierres.
              </p>
            )}
            {!esquemaPendiente && cierres.length > 0 && (
              <p className="text-sm text-muted-foreground">Desde el panel se puede reservar igualmente (solo avisa).</p>
            )}

            <Button type="button" variant="ghost" className="h-12 text-base" onClick={onClose}>
              Listo
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
