import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { agruparReservasDelDia } from "@/components/reservas/ReservasDelDia";
import { useReservasServicioDia } from "@/hooks/useReservasServicioDia";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { ETIQUETA_TURNO, horaCorta } from "@/lib/reservas/ocupacionSalas";
import { ESTADO_NO_SHOW, infoEstadoReserva } from "@/lib/reservas/estadosReserva";

// ============================================================================
// Lo apuntado en una hoja del libro (un día), por Comida y Cena: hora, nombre,
// personas, sala y estado. Lo usan «Escribir reserva» (`LibroReservas`) y la
// Lista vista como libro (`ListaComoLibro`). Misma consulta que «Reservas del
// día» del alta (`useReservasServicioDia`): una sola caché por día.
// Con `onAbrirReserva`, cada renglón es un botón que abre la ficha.
// ============================================================================

interface Props {
  fecha: string;
  resaltada?: string | null;
  onAbrirReserva?: (id: string) => void;
}

export function ReservasDeLaHoja({ fecha, resaltada = null, onAbrirReserva }: Props) {
  const { data: reservas, isLoading, isError, refetch } = useReservasServicioDia(fecha);
  const { data: espacios } = useEspaciosReserva();
  const nombreSala = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of (espacios ?? []) as Array<{ id: string; nombre: string }>) m.set(e.id, e.nombre);
    return m;
  }, [espacios]);
  const grupos = useMemo(() => agruparReservasDelDia(reservas), [reservas]);

  if (isLoading) return <Skeleton className="h-24 w-full bg-stone-200/60" />;
  if (isError) {
    return (
      <p role="alert" className="text-sm text-red-700">
        No se pudieron cargar las reservas de este día.{" "}
        <button type="button" className="underline" onClick={() => void refetch()}>
          Reintentar
        </button>
      </p>
    );
  }
  if (!grupos.length) return <p className="py-4 text-base italic text-stone-500">Hoja en blanco: aún no hay reservas este día.</p>;

  return (
    <div className="space-y-4">
      {grupos.map((g) => (
        <section key={g.turno} aria-label={ETIQUETA_TURNO[g.turno]}>
          <h3 className="mb-1 text-base font-semibold uppercase tracking-wide text-stone-500">
            {ETIQUETA_TURNO[g.turno]} · {g.reservas.length} {g.reservas.length === 1 ? "reserva" : "reservas"} · {g.pax} pax
          </h3>
          <ul>
            {g.reservas.map((r) => {
              const info = infoEstadoReserva(r.estado);
              const sala = r.espacio_id ? nombreSala.get(r.espacio_id) : null;
              const contenido = (
                <>
                  <span className="w-16 shrink-0 font-semibold tabular-nums">{horaCorta(r.hora) ?? r.hora}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {r.nombre || "Sin nombre"}
                    {r.notas_cliente ? <span className="ml-2 text-lg font-normal text-stone-500">· {r.notas_cliente}</span> : null}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{r.numero_comensales} px</span>
                  <span className="hidden w-32 shrink-0 truncate text-lg text-stone-600 sm:inline">{sala ?? "—"}</span>
                  {info && (
                    <Badge className={cn("shrink-0 text-sm", info.insignia)} variant={info.varianteInsignia}>
                      {info.etiqueta}
                    </Badge>
                  )}
                </>
              );
              const renglon = "flex min-h-14 w-full items-center gap-4 px-1 py-2 text-left text-xl";
              return (
                <li
                  key={r.id}
                  className={cn(
                    "border-b border-sky-300/60",
                    r.estado === ESTADO_NO_SHOW && "opacity-60",
                    resaltada === r.id && "bg-amber-200/50",
                  )}
                >
                  {onAbrirReserva ? (
                    <button
                      type="button"
                      className={cn(
                        renglon,
                        "rounded-sm hover:bg-amber-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600",
                      )}
                      onClick={() => onAbrirReserva(r.id)}
                      aria-label={`Abrir la reserva de ${r.nombre || "Sin nombre"}, ${horaCorta(r.hora) ?? r.hora}, ${r.numero_comensales} personas`}
                    >
                      {contenido}
                    </button>
                  ) : (
                    <div className={renglon}>{contenido}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
