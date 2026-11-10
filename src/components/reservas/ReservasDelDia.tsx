import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useReservasServicioDia } from "@/hooks/useReservasServicioDia";
import { useOcupacionSalasDia } from "@/hooks/useOcupacionSalasDia";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { turnoDeHora } from "../../../supabase/functions/_shared/disponibilidad";
import { ETIQUETA_TURNO, horaCorta, TURNOS, type Turno } from "@/lib/reservas/ocupacionSalas";
import { capacidadDeAforo } from "@/lib/reservas/salaPrivada";
import { ESTADO_CANCELADA, ESTADO_NO_SHOW, infoEstadoReserva } from "@/lib/reservas/estadosReserva";
import type { ReservaServicio } from "@/lib/reservas/servicioSala";
import { fechaLegible } from "@/lib/reservas/solicitudPropuesta";

// ============================================================================
// «Reservas del día» del formulario «Nueva reserva» (pedido del dueño:
// «en lugar de la disponibilidad, que ponga las reservas que hay para ese
// día»). Sustituye ahí a la tabla «Disponibilidad por cuartos de hora» (que
// sigue en Hoy, Calendario, verificación y solicitudes).
//
// Lista compacta, por hora, separada en Comida y Cena con «N reservas · X pax /
// aforo». Sin canceladas. Los «No vino» salen atenuados y no suman personas.
// Los datos son los de `useReservasServicioDia` (reservas del día, con realtime
// y refresco) y el aforo el de `useOcupacionSalasDia`. Pulsar una hora la elige
// en el formulario (`onSeleccionarHora`). Al editar, la reserva propia sale
// marcada («esta reserva»).
// ============================================================================

export interface ReservasDelDiaProps {
  /** "yyyy-MM-dd" */
  fecha: string | null | undefined;
  /** Hora elegida ahora mismo en el formulario (se resalta). */
  hora?: string | null;
  /** Al editar: la reserva que se está editando, marcada en la lista. */
  excluirReservaId?: string | null;
  onSeleccionarHora?: (hora: string) => void;
  className?: string;
}

export interface GrupoReservasDia {
  turno: Turno;
  reservas: ReservaServicio[];
  /** Personas que cuentan (sin «No vino»). */
  pax: number;
}

/** Reservas del día sin canceladas, ordenadas por hora y repartidas en Comida y Cena (sin turno vacío). */
// eslint-disable-next-line react-refresh/only-export-components
export function agruparReservasDelDia(reservas: readonly ReservaServicio[] | null | undefined): GrupoReservasDia[] {
  const vivas = (reservas ?? [])
    .filter((r) => r.estado !== ESTADO_CANCELADA)
    .sort(
      (a, b) =>
        (horaCorta(a.hora) ?? "").localeCompare(horaCorta(b.hora) ?? "") ||
        (a.nombre ?? "").localeCompare(b.nombre ?? "", "es"),
    );
  return TURNOS.map((turno) => {
    const delTurno = vivas.filter((r) => turnoDeHora(String(r.hora)) === turno);
    const pax = delTurno
      .filter((r) => r.estado !== ESTADO_NO_SHOW)
      .reduce((s, r) => s + Math.max(0, Number(r.numero_comensales) || 0), 0);
    return { turno, reservas: delTurno, pax };
  }).filter((g) => g.reservas.length > 0);
}

export function ReservasDelDia({ fecha, hora, excluirReservaId, onSeleccionarHora, className }: ReservasDelDiaProps) {
  const { data: reservas, isLoading, isError, refetch } = useReservasServicioDia(fecha);
  const { data: dia } = useOcupacionSalasDia(fecha);
  const { data: espacios } = useEspaciosReserva();
  const aforo = useMemo(() => (dia ? capacidadDeAforo(dia.espacios) : null), [dia]);
  const nombreSala = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of (espacios ?? []) as Array<{ id: string; nombre: string }>) m.set(e.id, e.nombre);
    return m;
  }, [espacios]);
  const grupos = useMemo(() => agruparReservasDelDia(reservas), [reservas]);
  const horaSel = horaCorta(hora);

  return (
    <section aria-label="Reservas del día" className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-semibold">Reservas del día</h3>
        {fecha && <span className="text-xs text-muted-foreground">{fechaLegible(fecha)}</span>}
      </div>

      {!fecha ? (
        <p className="text-xs text-muted-foreground">Elige una fecha para ver sus reservas.</p>
      ) : isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : isError ? (
        <p role="alert" className="text-xs text-destructive">
          No se pudieron cargar las reservas del día.{" "}
          <button type="button" className="underline" onClick={() => void refetch()}>
            Reintentar
          </button>
        </p>
      ) : grupos.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay reservas ese día.</p>
      ) : (
        grupos.map((g) => (
          <div key={g.turno} className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {ETIQUETA_TURNO[g.turno]} · {g.reservas.length} {g.reservas.length === 1 ? "reserva" : "reservas"} ·{" "}
              {g.pax} pax{aforo ? ` / ${aforo}` : ""}
            </p>
            <ul className="max-h-40 divide-y overflow-y-auto rounded-md border text-xs">
              {g.reservas.map((r) => {
                const h = horaCorta(r.hora) ?? String(r.hora);
                const info = infoEstadoReserva(r.estado);
                const propia = !!excluirReservaId && r.id === excluirReservaId;
                const sala = r.espacio_id ? nombreSala.get(r.espacio_id) : null;
                return (
                  <li
                    key={r.id}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1",
                      r.estado === ESTADO_NO_SHOW && "opacity-60",
                      propia && "bg-primary/5",
                    )}
                  >
                    {onSeleccionarHora ? (
                      <button
                        type="button"
                        onClick={() => onSeleccionarHora(h)}
                        aria-pressed={horaSel === h}
                        aria-label={`Elegir las ${h}`}
                        className={cn(
                          "shrink-0 rounded px-1 font-mono font-semibold tabular-nums hover:bg-accent",
                          horaSel === h && "bg-primary text-primary-foreground hover:bg-primary",
                        )}
                      >
                        {h}
                      </button>
                    ) : (
                      <span className="shrink-0 font-mono font-semibold tabular-nums">{h}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{r.nombre || "Sin nombre"}</span>
                      {propia && <span className="ml-1 text-muted-foreground">(esta reserva)</span>}
                      {r.notas_cliente ? (
                        <span className="ml-1 text-muted-foreground" title={r.notas_cliente}>
                          · {r.notas_cliente}
                        </span>
                      ) : null}
                    </span>
                    {sala && <span className="hidden shrink-0 text-muted-foreground sm:inline">{sala}</span>}
                    <span className="shrink-0 tabular-nums">{r.numero_comensales} pax</span>
                    {info && (
                      <Badge className={cn("shrink-0 px-1.5 py-0 text-[10px]", info.insignia)} variant={info.varianteInsignia}>
                        {info.etiqueta}
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
