import type { ReactNode } from "react";
import { CalendarX2, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { GradoAsignacion } from "@/lib/reservas/asignacionMesas";
import type { DatosDia, EtiquetasDia, ResumenTurnoDia } from "@/lib/reservas/asignacionPorDias";
import { ETIQUETA_TURNO } from "@/lib/reservas/ocupacionSalas";
import type { ReservaVentana } from "@/lib/reservas/ventanaAsignacion";

// ============================================================================
// PANEL DE UN DÍA — lo que se ve dentro de la pestaña activa de «Asignación»
// ----------------------------------------------------------------------------
// Cabecera compacta de UNA fila (04/10/2026, a petición del dueño: la lista tiene que empezar lo
// más arriba posible): título del día + resumen del día en una línea pequeña (reservas, comensales
// y sin mesa) + chip «Próximas 48 h» + interruptor «Ocultar las que ya tienen mesa» a la derecha
// (si no cabe, envuelve a dos líneas). Ya no hay tarjetas de contadores: el resumen de la comida y
// de la cena va en la cabecera de su propia sección. Debajo, un aviso cuando no queda nada por
// asignar y los turnos con sus subgrupos y filas.
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

const TEXTO_SOLO_HOY = "Solo salen las reservas de hoy que aún no han empezado.";

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

const textoOcultas = (n: number) => `${n} ${plural(n, "con mesa oculta", "con mesa ocultas")}`;

interface PanelDiaProps<T extends ReservaVentana> {
  dia: DatosDia<T>;
  etiquetas: EtiquetasDia;
  /** El día cae dentro de la ventana de asignación. */
  enVentana: boolean;
  ventanaHoras: number;
  /** Interruptor «Ocultar las que ya tienen mesa» (el estado vive en quien monta el panel). */
  soloPendientes: boolean;
  onSoloPendientes: (valor: boolean) => void;
  renderFila: (fila: T) => ReactNode;
}

export function PanelDia<T extends ReservaVentana>({
  dia,
  etiquetas,
  enVentana,
  ventanaHoras,
  soloPendientes,
  onSoloPendientes,
  renderFila,
}: PanelDiaProps<T>) {
  const todoAsignado = dia.hayReservas && dia.sinMesa === 0;

  // El panel de la pestaña ya lo nombra su pestaña (aria-labelledby de Radix): aquí no hace falta otro
  // «region», solo el título del día.
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h3 className="text-balance text-base font-semibold sm:text-lg">{etiquetas.titulo}</h3>
          {dia.hayReservas && (
            <p
              data-testid="resumen-dia"
              className="text-xs text-muted-foreground tabular-nums"
              title={etiquetas.esHoy ? TEXTO_SOLO_HOY : undefined}
            >
              {dia.reservas} {plural(dia.reservas, "reserva", "reservas")} · {dia.comensales} comensales ·{" "}
              {todoAsignado ? (
                <span className="font-medium text-emerald-700 dark:text-emerald-300">todo asignado</span>
              ) : (
                <span className="font-medium text-amber-800 dark:text-amber-300">{dia.sinMesa} sin mesa</span>
              )}
              {dia.ocultas > 0 && ` · ${textoOcultas(dia.ocultas)}`}
            </p>
          )}
          {/* Solo hoy: por qué «Hoy» no cuenta las reservas que ya han empezado. Sin línea propia: va
              en el aviso emergente del resumen y, para lectores de pantalla, como texto oculto. */}
          {etiquetas.esHoy && <span className="sr-only">{TEXTO_SOLO_HOY}</span>}
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          {enVentana && (
            <span
              className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
              title={`Dentro de las próximas ${ventanaHoras} h`}
            >
              <Clock className="h-3 w-3" aria-hidden="true" />
              Próximas {ventanaHoras}&nbsp;h
            </span>
          )}
          <div className="flex items-center gap-2 pointer-coarse:min-h-11">
            <Switch id="asignacion-solo-pendientes" checked={soloPendientes} onCheckedChange={onSoloPendientes} />
            <Label htmlFor="asignacion-solo-pendientes" className="cursor-pointer text-sm font-normal">
              Ocultar las que ya tienen mesa
            </Label>
          </div>
        </div>
      </header>

      {!dia.hayReservas ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-6 text-center text-muted-foreground">
          <CalendarX2 className="h-6 w-6" aria-hidden="true" />
          <p className="text-sm">Sin reservas este día</p>
        </div>
      ) : (
        <>
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

          {(["comida", "cena"] as const).map((turno) => {
            const grupo = dia.turnos.find((g) => g.turno === turno);
            const resumen = dia.porTurno[turno];
            if (!grupo) {
              // Turno con todas sus reservas ocultas por el interruptor: no tiene filas, pero se dice.
              return resumen.ocultas > 0 ? (
                <div
                  key={turno}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border px-3 py-2 sm:px-4"
                >
                  <span className="text-sm font-semibold sm:text-base">{ETIQUETA_TURNO[turno]}</span>
                  <ResumenTurno resumen={resumen} />
                </div>
              ) : null;
            }
            return (
              <Card key={grupo.turno}>
                <CardHeader className="px-3 pb-2 pt-3 sm:px-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <CardTitle className="text-sm font-semibold sm:text-base">{ETIQUETA_TURNO[grupo.turno]}</CardTitle>
                    <ResumenTurno resumen={resumen} />
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

/** Resumen de un turno, en la cabecera de su sección: reservas, comensales, sin mesa y ocultas. */
function ResumenTurno({ resumen }: { resumen: Pick<ResumenTurnoDia, "reservas" | "comensales" | "sinMesa" | "ocultas"> }) {
  const hayReservas = resumen.reservas > 0;
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {resumen.reservas} {plural(resumen.reservas, "reserva", "reservas")} · {resumen.comensales} comensales
      {hayReservas && resumen.sinMesa > 0 && ` · ${resumen.sinMesa} sin mesa`}
      {(!hayReservas || resumen.sinMesa === 0) && (
        <>
          {" · "}
          <span className="font-medium text-emerald-700 dark:text-emerald-300">todo asignado</span>
        </>
      )}
      {resumen.ocultas > 0 && ` · ${textoOcultas(resumen.ocultas)}`}
    </span>
  );
}
