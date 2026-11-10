// La lista de un grupo de «Hoy» («Por llegar», «Sentadas»), partida en «Menú del día» / «Carta» / «Resto» en la
// comida de martes a jueves (10/11/2026, `agruparPorMenu`); los demás servicios, una sola lista como siempre.
// La usan la lista de escritorio (`ListaHoyEscritorio`) y la del móvil (`VistaHoyMovil`).

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { agruparPorMenu, type ClaveBloqueMenu } from "@/lib/reservas/bloquesMenu";
import type { FiltroTurnoHoy } from "@/lib/reservas/vistaHoy";

export interface ServicioMostrado {
  fecha: string;
  filtroTurno: FiltroTurnoHoy;
}

const COLOR: Record<ClaveBloqueMenu, string> = {
  menu: "text-violet-800 dark:text-violet-300",
  carta: "text-foreground",
  resto: "text-muted-foreground",
  cena: "text-muted-foreground",
};

export function FilasPorMenu<F extends { reserva: { id: string; hora: string; numero_comensales: number; menu_del_dia?: boolean | null } }>({
  filas,
  servicio,
  pintar,
  className = "divide-y",
}: {
  filas: F[];
  /** Fecha y turno a la vista; sin él, una sola lista. */
  servicio?: ServicioMostrado | null;
  pintar: (fila: F) => ReactNode;
  className?: string;
}) {
  const bloques = servicio ? agruparPorMenu(filas, servicio) : null;
  if (!bloques) return <ul className={className}>{filas.map(pintar)}</ul>;
  return (
    <>
      {bloques.map((b) => (
        <div key={b.clave} role="group" aria-label={`${b.titulo}: ${b.filas.length} · ${b.pax} pax`} data-testid={`bloque-menu-${b.clave}`}>
          <h4
            className={cn(
              "flex items-center justify-between gap-2 border-b bg-background px-3 py-0.5 text-xs font-semibold uppercase tracking-wide",
              COLOR[b.clave],
            )}
            aria-hidden="true"
          >
            <span>{b.titulo}</span>
            <span className="font-normal normal-case tabular-nums">
              {b.filas.length} · {b.pax} pax
            </span>
          </h4>
          <ul className={className}>{b.filas.map(pintar)}</ul>
        </div>
      ))}
    </>
  );
}
