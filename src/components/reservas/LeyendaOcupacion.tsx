// ============================================================================
// LEYENDA DE LA CUADRÍCULA DEL MES
// ----------------------------------------------------------------------------
// Sale de la MISMA tabla que pinta las casillas (`ocupacionCalendario.ts`):
// si se ajusta un umbral o un color, la leyenda cambia sola. Trae los RANGOS EN
// NÚMEROS (no solo la muestra de color) porque el color nunca va solo: es lo que
// permite leerla con daltonismo o en una pantalla mala.
// ============================================================================

import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  CLASES_PUNTO_SIN_SALA,
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
      className={cn("h-4 w-4 shrink-0 rounded border", estiloNivel(nivel).muestra)}
    />
  );
}

export function LeyendaOcupacion({
  ventanaHoras,
  aforo = null,
  aforoNoDisponible = false,
}: {
  /** Ventana de asignación: el punto de «sin sala» solo sale dentro de ella. */
  ventanaHoras: number;
  /** Aforo por turno de Casa Tomás, para decir contra qué se mide el %. */
  aforo?: number | null;
  /** No se han podido leer los espacios: hay comensales pero no porcentaje. */
  aforoNoDisponible?: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Color: ocupación del turno más lleno del día (comida o cena)
            {aforo !== null && <> sobre el aforo de {aforo} comensales por turno</>}
          </p>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm" aria-label="Escala de ocupación">
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

        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm">
          <li className="flex items-center gap-2">
            <Muestra nivel="pasado" />
            <span>Día pasado: lo que se reservó, sin porcentaje</span>
          </li>
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              data-testid="muestra-sin-sala"
              className={cn("mx-0.5 h-3 w-3 shrink-0", CLASES_PUNTO_SIN_SALA)}
            />
            <span>Reservas sin sala en las próximas {ventanaHoras} h</span>
          </li>
          <li className="flex items-center gap-2">
            <Lock aria-hidden="true" data-testid="muestra-sala-privada" className="mx-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Reservado ocupado (fuera de aforo: no cuenta en las cifras)</span>
          </li>
        </ul>

        <p className="text-xs text-muted-foreground">
          Cifra grande: comensales del día. Cifra pequeña: reservas. Barras: comida (izquierda) y cena (derecha). Cuentan las
          reservas pendientes, verificadas y confirmadas.
        </p>

        {aforoNoDisponible && (
          <p role="status" className="text-xs font-medium text-muted-foreground">
            No se ha podido leer el aforo de las salas: se enseñan los comensales sin porcentaje.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
