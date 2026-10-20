// ============================================================================
// Piezas, pico y uniones en el plano — lo comparten el plano de reparto
// (`PlanoEspacio2D`) y el plano de «Hoy» (`servicio/MapaSalaServicio`).
// Geometría pura y tests en `@/lib/reservas/dibujoMesas.ts`.
// ============================================================================

import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { divisoresPiezas } from "@/lib/reservas/dibujoMesas";
import type { LadoCrecimiento } from "@/lib/reservas/piezasMesa";

export interface PiezasDibujo {
  piezas: number;
  picos: number;
  ladoPico: LadoCrecimiento;
  vertical: boolean;
}

/**
 * Raya entre piezas (línea continua que cruza también el borde, para que 2
 * piezas se vean como 2 mesas que se tocan) y la marca del
 * pico en su cabecera. Va DENTRO de la caja de la mesa (posición relativa a
 * ella); `borde` = grosor del borde de esa caja, para cortarlo entero.
 */
export function RanurasPiezas({ info, borde = 2, redonda = false }: { info: PiezasDibujo; borde?: number; redonda?: boolean }) {
  // Las redondas no se juntan ni se parten: una sola mesa.
  if (redonda) return null;
  const fuera = -borde - 1;
  return (
    <>
      {divisoresPiezas(info.piezas).map((f) => (
        <span
          key={f}
          aria-hidden="true"
          data-ranura-pieza
          className="pointer-events-none absolute bg-slate-500/80 dark:bg-slate-400/80"
          style={
            info.vertical
              ? { left: fuera, right: fuera, height: 2, top: `calc(${f * 100}% - 1px)` }
              : { top: fuera, bottom: fuera, width: 2, left: `calc(${f * 100}% - 1px)` }
          }
        />
      ))}
      {info.picos > 0 && (
        <span
          aria-hidden="true"
          data-pico
          className={cn(
            "pointer-events-none absolute rounded-sm bg-amber-500",
            info.vertical ? "left-1/2 h-1.5 w-1/2 -translate-x-1/2" : "top-1/2 h-1/2 w-1.5 -translate-y-1/2",
          )}
          style={{
            [info.ladoPico === "arriba"
              ? "top"
              : info.ladoPico === "abajo"
                ? "bottom"
                : info.ladoPico === "izquierda"
                  ? "left"
                  : "right"]: -borde - 7,
          }}
        />
      )}
    </>
  );
}

/**
 * Contorno común de unas mesas juntas y rótulo «3+4 · 8 plazas». Caja en px
 * de pantalla (la que envuelve las mesas); se dibuja por DEBAJO de las mesas y
 * sin eventos, así tocar una mesa de la unión sigue abriendo esa mesa.
 */
export function ContornoUnion({
  x,
  y,
  ancho,
  alto,
  texto,
}: {
  x: number;
  y: number;
  ancho: number;
  alto: number;
  texto: string;
}) {
  const margen = 6;
  return (
    <div
      aria-hidden="true"
      data-union-mesas={texto}
      className="pointer-events-none absolute rounded-xl border-2 border-sky-600 bg-sky-200/50 dark:border-sky-400 dark:bg-sky-900/40"
      style={{ left: x - margen, top: y - margen, width: ancho + margen * 2, height: alto + margen * 2, zIndex: 5 }}
    >
      <span
        className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-sky-600 px-2 py-0.5 text-[12px] font-semibold leading-tight text-white shadow dark:bg-sky-500"
        style={{ top: "calc(100% + 3px)" }}
      >
        <Link2 className="h-3 w-3" />
        {texto}
      </span>
    </div>
  );
}
