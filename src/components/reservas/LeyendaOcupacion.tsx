// ============================================================================
// LEYENDA DE LA CUADRÍCULA DEL MES
// ----------------------------------------------------------------------------
// Sale de la MISMA tabla que pinta las casillas (`ocupacionCalendario.ts`):
// si se ajusta un umbral o un color, la leyenda cambia sola. Trae los RANGOS EN
// NÚMEROS (no solo la muestra de color) porque el color nunca va solo: es lo que
// permite leerla con daltonismo o en una pantalla mala.
//
// VARIANTE COMPACTA (2026-10-04, calendario a altura de pantalla): la leyenda va
// dentro del alto fijo del calendario y no puede comerse 150 px. `compacta` pone
// la escala, los indicadores y el aviso de aforo en un solo bloque de 1-2 líneas;
// el texto largo («Cifra grande: …», aforo) pasa a un botón «Cómo se lee» (≥ 44 px
// con el dedo) que lo abre en un popover. Mismos datos y mismos colores que la
// completa: salen de la misma tabla.
// ============================================================================

import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  NIVELES_ESCALA,
  estiloNivel,
  rangoNivel,
  type NivelCalendario,
} from "@/lib/reservas/ocupacionCalendario";

function Muestra({ nivel }: { nivel: NivelCalendario }) {
  return (
    <span
      aria-hidden="true"
      data-nivel-muestra={nivel}
      className={cn("h-5 w-5 shrink-0 rounded border", estiloNivel(nivel).muestra)}
    />
  );
}

export function LeyendaOcupacion({
  ventanaHoras,
  aforo = null,
  aforoNoDisponible = false,
  compacta = false,
}: {
  /** Ventana de asignación: el punto de «sin sala» solo sale dentro de ella. */
  ventanaHoras: number;
  /** Aforo por turno de Casa Tomás, para decir contra qué se mide el %. */
  aforo?: number | null;
  /** No se han podido leer los espacios: hay comensales pero no porcentaje. */
  aforoNoDisponible?: boolean;
  /** Una sola banda baja, para el calendario de altura fija. */
  compacta?: boolean;
}) {
  if (compacta) {
    return (
      <Card className="shrink-0" data-testid="leyenda-compacta">
        <CardContent className="flex items-center gap-2 p-2">
          <ul
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-[15px] leading-snug"
            aria-label="Escala de ocupación"
          >
            <li className="flex items-center gap-1.5">
              <Muestra nivel="vacio" />
              <span>Sin reservas</span>
            </li>
            {NIVELES_ESCALA.map((nivel) => (
              <li key={nivel} className="flex items-center gap-1.5">
                <Muestra nivel={nivel} />
                <span>
                  <span className="font-medium">{estiloNivel(nivel).etiqueta}</span>{" "}
                  <span className="text-muted-foreground">{rangoNivel(nivel)}</span>
                </span>
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <Muestra nivel="pasado" />
              <span>Día pasado</span>
            </li>
            {/* Las etiquetas de cada día, en color (11/11/2026, petición del dueño). */}
            <li className="flex items-center gap-1.5">
              <span className="rounded bg-destructive/10 px-1 text-xs font-semibold uppercase leading-5 text-destructive">Cerrado</span>
              <span className="rounded bg-amber-100 px-1 text-xs font-semibold uppercase leading-5 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">Sin cena</span>
              <span className="rounded bg-sky-100 px-1 text-xs font-medium leading-5 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100">Sin web</span>
            </li>
            {aforoNoDisponible && (
              <li role="status" className="font-medium text-muted-foreground">
                Aforo no disponible: sin porcentaje.
              </li>
            )}
          </ul>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="touch-target flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 py-1 text-[15px] font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Info className="h-5 w-5" aria-hidden="true" />
                Cómo se lee
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-96 max-w-[calc(100vw-2rem)] space-y-2 text-[15px] leading-snug">
              <p>
                Color: ocupación del turno más lleno del día (comida o cena)
                {aforo !== null && <> sobre el aforo de {aforo} comensales por turno</>}. Día pasado: lo que se reservó, sin
                porcentaje. El punto ámbar marca reservas sin sala en las próximas {ventanaHoras} h.
                Cada casilla dice si el día está cerrado para reservas («Cerrado», «Sin comida», «Sin cena»); pulsa un
                día para cerrarlo o abrirlo.
              </p>
              <p className="text-muted-foreground">
                Cifra grande: comensales del día. Cifra pequeña: reservas. Barras: comida (izquierda) y cena (derecha).
                Cuentan las reservas pendientes, verificadas y confirmadas.
              </p>
            </PopoverContent>
          </Popover>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div>
          <p className="mb-2 text-[15px] font-medium text-muted-foreground">
            Color: ocupación del turno más lleno del día (comida o cena)
            {aforo !== null && <> sobre el aforo de {aforo} comensales por turno</>}
          </p>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] sm:text-base" aria-label="Escala de ocupación">
            <li className="flex items-center gap-2">
              <Muestra nivel="vacio" />
              <span>Sin reservas</span>
            </li>
            {NIVELES_ESCALA.map((nivel) => (
              <li key={nivel} className="flex items-center gap-2">
                <Muestra nivel={nivel} />
                <span>
                  <span className="font-medium">{estiloNivel(nivel).etiqueta}</span>{" "}
                  <span className="text-muted-foreground">{rangoNivel(nivel)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] sm:text-base">
          <li className="flex items-center gap-2">
            <Muestra nivel="pasado" />
            <span>Día pasado: lo que se reservó, sin porcentaje</span>
          </li>
        </ul>

        <p className="text-[15px] text-muted-foreground">
          Cifra grande: comensales del día. Cifra pequeña: reservas. Barras: comida (izquierda) y cena (derecha). Cuentan las
          reservas pendientes, verificadas y confirmadas.
        </p>

        {aforoNoDisponible && (
          <p role="status" className="text-[15px] font-medium text-muted-foreground">
            No se ha podido leer el aforo de las salas: se enseñan los comensales sin porcentaje.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
