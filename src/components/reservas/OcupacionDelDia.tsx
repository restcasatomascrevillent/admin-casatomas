// ============================================================================
// OCUPACIÓN DE UN DÍA POR TURNO — cabecera del panel del día
// ----------------------------------------------------------------------------
// Es lo que está detrás del color de la casilla del mes, desglosado: el % de
// aforo de Casa Tomás en comida y en cena. Los datos son los MISMOS que usa la
// casilla (`ocupacionPorTurno`, que calcula también el panel con las filas de
// `vista_asignacion_dia`), así que casilla y panel dicen siempre lo mismo.
//
// Una sola escala, un solo negocio (Touza ya no admite reservas: su aforo no se
// enseña y sus reservas antiguas se ignoran). Cada fila lleva el % escrito y una
// barra: el color de la barra es el nivel (mismo azul que la casilla), pero
// nunca va solo.
// ============================================================================

import { cn } from "@/lib/utils";
import { TURNOS, type Turno } from "@/lib/reservas/asignacionMesas";
import { estiloNivel, type TurnoOcupacion } from "@/lib/reservas/ocupacionCalendario";

const NOMBRE_TURNO: Record<Turno, string> = { comida: "Comida", cena: "Cena" };

function FilaTurno({ ocupacion }: { ocupacion: TurnoOcupacion }) {
  const estilo = estiloNivel(ocupacion.nivel);
  const sinAforo = ocupacion.porcentaje === null;
  const texto = sinAforo ? "—" : ocupacion.nivel === "completo" ? "Completo" : `${ocupacion.porcentaje}%`;
  const ancho = sinAforo ? 0 : Math.max(0, Math.min(100, ocupacion.porcentaje ?? 0));

  return (
    <div
      className="flex items-center gap-2 text-xs"
      data-testid={`ocupacion-${ocupacion.turno}`}
      data-nivel={ocupacion.nivel}
      title={
        sinAforo
          ? "No hay aforo configurado"
          : `${Math.min(ocupacion.comensales, ocupacion.capacidad ?? 0)} de ${ocupacion.capacidad} comensales`
      }
    >
      <span className="w-12 shrink-0 text-muted-foreground">{NOMBRE_TURNO[ocupacion.turno]}</span>
      <span aria-hidden="true" className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", estilo.relleno)} style={{ width: `${ancho}%` }} />
      </span>
      <span
        className={cn(
          "shrink-0 text-right tabular-nums",
          ocupacion.nivel === "completo" ? "font-semibold" : "font-medium",
          ocupacion.nivel === "vacio" && "text-muted-foreground",
        )}
      >
        {texto}
      </span>
    </div>
  );
}

export function OcupacionDelDia({
  turnos,
  aforo,
}: {
  turnos: Readonly<Record<Turno, TurnoOcupacion>>;
  /** Aforo por turno de Casa Tomás; `null` si no se conoce. */
  aforo: number | null;
}) {
  return (
    <div className="space-y-1" role="group" aria-label="Ocupación por turno" data-testid="ocupacion-del-dia">
      {aforo !== null && <p className="text-[11px] text-muted-foreground">Aforo: {aforo} comensales por turno</p>}
      {TURNOS.map((turno) => (
        <FilaTurno key={turno} ocupacion={turnos[turno]} />
      ))}
    </div>
  );
}
