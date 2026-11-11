import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { agruparReservasDelDia } from "@/components/reservas/ReservasDelDia";
import { useReservasServicioDia } from "@/hooks/useReservasServicioDia";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { ETIQUETA_TURNO, horaCorta } from "@/lib/reservas/ocupacionSalas";
import { ESTADO_NO_SHOW, infoEstadoReserva } from "@/lib/reservas/estadosReserva";
import { bloquesComidaMenuDelDia } from "@/lib/reservas/menuDelDia";

// ============================================================================
// Lo apuntado en una hoja del libro (un día), por Comida y Cena: hora, nombre,
// personas, sala y estado. Lo usan «Escribir reserva» (`LibroReservas`) y la
// Lista vista como libro (`ListaComoLibro`). Misma consulta que «Reservas del
// día» del alta (`useReservasServicioDia`): una sola caché por día.
// Con `onAbrirReserva`, cada renglón es un botón que abre la ficha. La comida
// de martes a jueves va en bloques «Menú del día», «Carta» y «Resto».
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

  if (isLoading) return <Skeleton className="h-24 w-full" />;
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
  if (!grupos.length) return <p className="py-4 text-base text-muted-foreground">Aún no hay reservas este día.</p>;

  const renglon = (r: (typeof grupos)[number]["reservas"][number]) => {
    const info = infoEstadoReserva(r.estado);
    const sala = r.espacio_id ? nombreSala.get(r.espacio_id) : null;
    const contenido = (
      <>
        <span className="w-16 shrink-0 font-semibold tabular-nums">{horaCorta(r.hora) ?? r.hora}</span>
        {/* Nombre entero (10/11/2026, «no se ven los nombres»): sin cortar, y las notas debajo en pequeño. */}
        <span className="min-w-0 flex-1">
          <span className="block break-words font-medium leading-snug">{r.nombre || "Sin nombre"}</span>
          {r.notas_cliente ? <span className="block truncate text-sm font-normal text-amber-800 dark:text-amber-300">{r.notas_cliente}</span> : null}
        </span>
        <span className="shrink-0 rounded-md border px-2 py-0.5 text-base font-semibold tabular-nums">{r.numero_comensales} px</span>
        <span className="hidden w-32 shrink-0 truncate text-base text-muted-foreground sm:inline">{sala ?? "—"}</span>
        {info && (
          <Badge className={cn("shrink-0 text-sm", info.insignia)} variant={info.varianteInsignia}>
            {info.etiqueta}
          </Badge>
        )}
      </>
    );
    const clases = "flex min-h-14 w-full items-center gap-3 px-2 py-2 text-left text-lg sm:gap-4";
    return (
      <li
        key={r.id}
        className={cn("border-b border-border/60 last:border-b-0", r.estado === ESTADO_NO_SHOW && "opacity-60", resaltada === r.id && "bg-amber-100 dark:bg-amber-900/30")}
      >
        {onAbrirReserva ? (
          <button
            type="button"
            className={cn(clases, "rounded-md hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
            onClick={() => onAbrirReserva(r.id)}
            aria-label={`Abrir la reserva de ${r.nombre || "Sin nombre"}, ${horaCorta(r.hora) ?? r.hora}, ${r.numero_comensales} personas`}
          >
            {contenido}
          </button>
        ) : (
          <div className={clases}>{contenido}</div>
        )}
      </li>
    );
  };
  const resumen = (n: number, pax: number) => `${n} ${n === 1 ? "reserva" : "reservas"} · ${pax} pax`;

  return (
    <div className="space-y-4">
      {grupos.map((g) => {
        // Comida de martes a jueves: «Menú del día», «Carta» y «Resto», cada uno por hora (10/11/2026).
        const bloques = g.turno === "comida" ? bloquesComidaMenuDelDia(fecha, g.reservas) : null;
        return (
          <section key={g.turno} aria-label={ETIQUETA_TURNO[g.turno]}>
            <h3 className="mb-1 rounded-md bg-muted px-3 py-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {ETIQUETA_TURNO[g.turno]} · {resumen(g.reservas.length, g.pax)}
            </h3>
            {bloques ? (
              <div className="space-y-3">
                {bloques.map((b) => (
                  <section key={b.clave} aria-label={b.etiqueta} className="pl-2">
                    <h4 className="mt-2 text-base font-semibold">
                      {b.etiqueta} <span className="font-normal text-muted-foreground">· {resumen(b.reservas.length, b.pax)}</span>
                    </h4>
                    <ul>{b.reservas.map(renglon)}</ul>
                  </section>
                ))}
              </div>
            ) : (
              <ul>{g.reservas.map(renglon)}</ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
