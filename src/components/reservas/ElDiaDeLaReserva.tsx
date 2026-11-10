import { useMemo } from "react";
import { AlertTriangle, Ban, CalendarX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOcupacionSalasDia } from "@/hooks/useOcupacionSalasDia";
import { useCierresReserva } from "@/hooks/useCierresReserva";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useServiciosBloqueados } from "@/hooks/useServiciosBloqueados";
import { diasAbiertosSinReservaOnlineDesde, separarCierres, turnosCerradosEn } from "../../../supabase/functions/_shared/cierres";
import { resumenAforoDia, type ReservaDelAforo, type ServicioDia } from "@/lib/reservas/aforoDia";
import { ReservasDeLaHoja } from "./libro/ReservasDeLaHoja";

// ============================================================================
// «EL DÍA» de una reserva, en el diálogo de aceptar / confirmar / verificar
// (10/11/2026, petición del dueño: «se abre el pop-up para ver el día, lo que
// hay ese día y ver si se puede»). Arriba, por servicio, las personas frente al
// aforo y un aviso claro si con esta reserva se pasa o si el servicio está
// cerrado (calendario de cierres) o bloqueado («No coger más»). Debajo, las
// reservas del día por Comida y Cena (`ReservasDeLaHoja`, la misma hoja del
// libro) con esta reserva resaltada. Solo avisa: decidir es cosa del personal.
// ============================================================================

const NOMBRE: Record<ServicioDia, string> = { comida: "Comida", cena: "Cena" };

export function ElDiaDeLaReserva({ fecha, reserva }: { fecha: string; reserva: ReservaDelAforo & { id: string } }) {
  const { data: dia } = useOcupacionSalasDia(fecha);
  const { data: cierres } = useCierresReserva(fecha, fecha);
  const { data: config } = useConfiguracionReservas();
  const bloqueos = useServiciosBloqueados(fecha);

  const resumen = useMemo(() => {
    const { cerrados } = separarCierres(cierres?.cierres ?? [], diasAbiertosSinReservaOnlineDesde(config));
    return resumenAforoDia({
      espacios: dia?.espacios ?? [],
      reservas: dia?.reservas ?? [],
      propia: reserva,
      cerrados: turnosCerradosEn(cerrados, fecha),
      bloqueados: (["comida", "cena"] as const).filter((t) => bloqueos.estaBloqueado(t)),
    });
  }, [dia, cierres, config, bloqueos, reserva, fecha]);

  const propio = resumen.servicios.find((s) => s.servicio === resumen.servicioPropio)!;
  const avisos: { icono: typeof AlertTriangle; texto: string }[] = [];
  if (propio.cerrado) avisos.push({ icono: CalendarX, texto: `La ${NOMBRE[propio.servicio].toLowerCase()} de ese día está CERRADA.` });
  if (propio.bloqueado) avisos.push({ icono: Ban, texto: `La ${NOMBRE[propio.servicio].toLowerCase()} de ese día está BLOQUEADA: no se cogen más reservas.` });
  if (resumen.pasaAforo) {
    avisos.push({
      icono: AlertTriangle,
      texto: `Con esta reserva se pasa del aforo de la ${NOMBRE[propio.servicio].toLowerCase()}: ${propio.pax} personas para ${propio.aforo}.`,
    });
  }

  return (
    <section aria-label="El día de la reserva" className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {resumen.servicios.map((s) => {
          const pasa = s.aforo > 0 && s.pax > s.aforo;
          return (
            <div
              key={s.servicio}
              data-testid={`aforo-${s.servicio}`}
              className={cn(
                "rounded-lg border px-5 py-4",
                s.servicio === resumen.servicioPropio && "ring-2 ring-primary/40",
                (pasa || s.cerrado || s.bloqueado) && "border-red-300 bg-red-50 dark:bg-red-950/30",
              )}
            >
              <p className="text-base font-semibold uppercase tracking-wide text-muted-foreground">{NOMBRE[s.servicio]}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {s.pax} {s.aforo > 0 ? <span className="text-lg font-normal text-muted-foreground">/ {s.aforo} personas</span> : "personas"}
              </p>
              {(s.cerrado || s.bloqueado) && (
                <p className="mt-1 text-base font-medium text-red-700 dark:text-red-300">{s.cerrado ? "Cerrado" : "Bloqueado"}</p>
              )}
            </div>
          );
        })}
      </div>

      {avisos.length > 0 ? (
        <div role="alert" className="space-y-2 rounded-lg border-2 border-red-400 bg-red-50 px-5 py-4 text-red-800 dark:bg-red-950/40 dark:text-red-200">
          {avisos.map(({ icono: Icono, texto }) => (
            <p key={texto} className="flex items-start gap-3 text-lg font-semibold">
              <Icono className="mt-1 h-5 w-5 shrink-0" aria-hidden />
              {texto}
            </p>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-5 py-4 text-lg font-medium text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          Cabe: el servicio está abierto y no se pasa del aforo.
        </p>
      )}

      <div className="rounded-lg border-l-4 border-rose-300/70 bg-[#fbf6e9] px-5 py-4 text-stone-800">
        <ReservasDeLaHoja fecha={fecha} resaltada={reserva.id} />
      </div>
    </section>
  );
}
