import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { agruparReservasDelDia } from "@/components/reservas/ReservasDelDia";
import { useReservasServicioDia } from "@/hooks/useReservasServicioDia";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { ETIQUETA_TURNO } from "@/lib/reservas/ocupacionSalas";
import { bloquesComidaMenuDelDia } from "@/lib/reservas/menuDelDia";
import { canceladasDelDia } from "@/lib/reservas/cancelacion";
import { RenglonReserva } from "./RenglonReserva";

// ============================================================================
// Lo apuntado en una hoja del libro (un día), por Comida y Cena: hora, nombre,
// personas, sala y estado. Lo usan «Escribir reserva» (`LibroReservas`) y la
// Lista vista como libro (`ListaComoLibro`). Misma consulta que «Reservas del
// día» del alta (`useReservasServicioDia`): una sola caché por día.
// Con `onAbrirReserva`, cada renglón es un botón que abre la ficha. La comida
// de martes a jueves va en bloques «Menú del día», «Carta» y «Resto».
// Con `conCanceladas` (la Lista, 16/11/2026: «que las canceladas aparezcan en el
// panel»), debajo de Comida y Cena va la sección «Canceladas» del día, aparte
// de las activas y diciendo quién canceló cada una. No cuentan en los totales.
// ============================================================================

interface Props {
  fecha: string;
  resaltada?: string | null;
  onAbrirReserva?: (id: string) => void;
  /** Enseña también las canceladas del día, en su sección aparte (la Lista). «Escribir reserva» no las enseña. */
  conCanceladas?: boolean;
}

export function ReservasDeLaHoja({ fecha, resaltada = null, onAbrirReserva, conCanceladas = false }: Props) {
  const { data: reservas, isLoading, isError, refetch } = useReservasServicioDia(fecha);
  const { data: espacios } = useEspaciosReserva();
  const nombreSala = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of (espacios ?? []) as Array<{ id: string; nombre: string }>) m.set(e.id, e.nombre);
    return m;
  }, [espacios]);
  const grupos = useMemo(() => agruparReservasDelDia(reservas), [reservas]);
  const canceladas = useMemo(() => (conCanceladas ? canceladasDelDia(reservas) : []), [conCanceladas, reservas]);

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
  if (!grupos.length && !canceladas.length) return <p className="py-4 text-base text-muted-foreground">Aún no hay reservas este día.</p>;

  const renglon = (r: (typeof grupos)[number]["reservas"][number]) => (
    <RenglonReserva
      key={r.id}
      reserva={r}
      sala={r.espacio_id ? nombreSala.get(r.espacio_id) : null}
      resaltada={resaltada === r.id}
      onAbrir={onAbrirReserva}
    />
  );
  const resumen = (n: number, pax: number) => `${n} ${n === 1 ? "reserva" : "reservas"} · ${pax} pax`;

  return (
    <div className="space-y-4">
      {!grupos.length && <p className="py-2 text-base text-muted-foreground">No hay reservas activas este día.</p>}
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
      {canceladas.length > 0 && (
        <section aria-label="Canceladas" data-testid="canceladas-del-dia">
          <h3 className="mb-1 rounded-md bg-red-50 px-3 py-1.5 text-sm font-semibold uppercase tracking-wide text-red-800 dark:bg-red-950/40 dark:text-red-200">
            Canceladas · {canceladas.length} {canceladas.length === 1 ? "reserva" : "reservas"}
          </h3>
          <ul>{canceladas.map(renglon)}</ul>
        </section>
      )}
    </div>
  );
}
