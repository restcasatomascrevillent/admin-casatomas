import type { ReactNode } from "react";
import { CalendarX2, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { GradoAsignacion } from "@/lib/reservas/asignacionMesas";
import type { DatosDia, EtiquetasDia, ResumenTurnoDia } from "@/lib/reservas/asignacionPorDias";
import { ETIQUETA_TURNO } from "@/lib/reservas/ocupacionSalas";
import type { ReservaVentana } from "@/lib/reservas/ventanaAsignacion";

// ============================================================================
// PANEL DE UN DÍA — lo que se ve dentro de la pestaña activa de «Asignación»
// ----------------------------------------------------------------------------
// Resumen del día (todo el día, comida y cena: reservas, comensales y sin mesa), un
// aviso cuando no queda nada por asignar y, debajo, los turnos con sus subgrupos y filas.
// Las filas las pinta quien lo monta (`renderFila`): este componente solo organiza.
// Estados: «Sin reservas este día» y «Todo asignado».
// ============================================================================

const ETIQUETA_GRADO: Record<GradoAsignacion, string> = {
  sin_sala: "Sin sala",
  sin_mesa: "Con sala, sin mesa",
  con_mesa: "Con mesa",
};

/** Pendiente no es error: tonos neutros, nunca rojo (ver saltoAsignacion.ts). */
const CLASES_GRADO: Record<GradoAsignacion, string> = {
  sin_sala: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  sin_mesa: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
  con_mesa: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
};

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

interface PanelDiaProps<T extends ReservaVentana> {
  dia: DatosDia<T>;
  etiquetas: EtiquetasDia;
  /** El día cae dentro de la ventana de asignación. */
  enVentana: boolean;
  ventanaHoras: number;
  renderFila: (fila: T) => ReactNode;
}

export function PanelDia<T extends ReservaVentana>({ dia, etiquetas, enVentana, ventanaHoras, renderFila }: PanelDiaProps<T>) {
  const todoAsignado = dia.hayReservas && dia.sinMesa === 0;

  // El panel de la pestaña ya lo nombra su pestaña (aria-labelledby de Radix): aquí no hace falta otro
  // «region», solo el título del día.
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-balance text-base font-semibold sm:text-lg">
            {etiquetas.titulo}
          </h3>
          {enVentana && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Dentro de las próximas {ventanaHoras}&nbsp;h
            </span>
          )}
        </div>
        {etiquetas.esHoy && (
          <p className="text-xs text-muted-foreground">Solo salen las reservas de hoy que aún no han empezado.</p>
        )}
      </header>

      {!dia.hayReservas ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center text-muted-foreground">
          <CalendarX2 className="h-6 w-6" aria-hidden="true" />
          <p className="text-sm">Sin reservas este día</p>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            <CeldaResumen titulo="Todo el día" datos={dia} destacada />
            <CeldaResumen titulo={ETIQUETA_TURNO.comida} datos={dia.porTurno.comida} />
            <CeldaResumen titulo={ETIQUETA_TURNO.cena} datos={dia.porTurno.cena} />
          </dl>

          {todoAsignado && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                <span className="font-medium">Todo asignado.</span>{" "}
                {textoTodoAsignado(dia.ocultas > 0 ? dia.ocultas : dia.reservas, dia.ocultas > 0)}
              </p>
            </div>
          )}

          {dia.turnos.map((grupo) => {
            const resumen = dia.porTurno[grupo.turno];
            return (
              <Card key={grupo.turno}>
                <CardHeader className="px-3 pb-2 pt-3 sm:px-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <CardTitle className="text-sm font-semibold sm:text-base">{ETIQUETA_TURNO[grupo.turno]}</CardTitle>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {resumen.reservas} {plural(resumen.reservas, "reserva", "reservas")} · {resumen.comensales} comensales
                      {resumen.sinMesa > 0 && ` · ${resumen.sinMesa} sin mesa`}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 px-3 pb-3 sm:px-4">
                  {grupo.grados.map(({ grado, reservas }) => (
                    <div key={grado} className="space-y-1.5">
                      <Badge variant="outline" className={cn("text-[11px] font-medium", CLASES_GRADO[grado])}>
                        {ETIQUETA_GRADO[grado]} · {reservas.length}
                      </Badge>
                      <ul className="divide-y rounded-md border">{reservas.map(renderFila)}</ul>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

function textoTodoAsignado(cantidad: number, ocultas: boolean): string {
  if (ocultas) {
    return cantidad === 1
      ? "La reserva de este día ya tiene mesa (oculta por el filtro)."
      : `Las ${cantidad} reservas de este día ya tienen mesa (ocultas por el filtro).`;
  }
  return cantidad === 1 ? "La reserva de este día ya tiene mesa." : `Las ${cantidad} reservas de este día ya tienen mesa.`;
}

/** Una celda del resumen: reservas, comensales y cuántas faltan por asignar. */
function CeldaResumen({
  titulo,
  datos,
  destacada = false,
}: {
  titulo: string;
  datos: Pick<ResumenTurnoDia, "reservas" | "comensales" | "sinMesa" | "ocultas">;
  destacada?: boolean;
}) {
  const sinNada = datos.reservas === 0 && datos.ocultas === 0;
  const todoAsignado = !sinNada && datos.sinMesa === 0;
  return (
    <div className={cn("min-w-0 rounded-lg border bg-card p-2.5 sm:p-3", destacada && "bg-muted/40")}>
      <dt className="text-xs font-medium text-muted-foreground">{titulo}</dt>
      <dd className="mt-1">
        {sinNada ? (
          <span className="text-sm text-muted-foreground">Sin reservas</span>
        ) : (
          <>
            <p className="text-xl font-semibold leading-none tabular-nums">
              {datos.reservas}{" "}
              <span className="text-xs font-normal text-muted-foreground sm:text-sm">
                {plural(datos.reservas, "reserva", "reservas")}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">{datos.comensales} comensales</p>
            <p
              className={cn(
                "mt-1.5 text-xs font-medium tabular-nums",
                todoAsignado ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300",
              )}
            >
              {todoAsignado ? "Todo asignado" : `${datos.sinMesa} sin mesa`}
            </p>
            {datos.ocultas > 0 && (
              <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground tabular-nums">
                {datos.ocultas} {plural(datos.ocultas, "con mesa oculta", "con mesa ocultas")}
              </p>
            )}
          </>
        )}
      </dd>
    </div>
  );
}
