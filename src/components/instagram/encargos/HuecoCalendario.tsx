/**
 * Hueco de encargo en el calendario de Instagram: la fecha deseada de un
 * encargo enviado y vivo (la pieza aún no está, pero el día está reservado).
 * Color propio (azul, borde discontinuo); en rojo si la fecha ya pasó y aún no
 * está aprobado. Se importa directamente (no desde ./index) para que el
 * calendario no dependa de la ficha del encargo.
 */
import { KanbanSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOMBRE_ESTADO, NOMBRE_MARCA, referencia, type HuecoEncargo } from "./logica";

export function HuecoCalendario({ hueco, compacta, onAbrir, enPanel }: { hueco: HuecoEncargo; compacta?: boolean; onAbrir?: (id: string) => void; enPanel?: boolean }) {
  const testId = enPanel ? "hueco-panel" : "hueco-encargo";
  const etiqueta = `Hueco de encargo ${referencia(hueco.numero)}: ${hueco.titulo} (${NOMBRE_MARCA[hueco.marca]}, ${NOMBRE_ESTADO[hueco.estado]})${hueco.retrasado ? ", con retraso" : ""}`;
  const clase = cn(
    "flex min-h-11 w-full min-w-0 items-center gap-1.5 rounded-md border border-dashed p-1.5 text-left text-xs",
    hueco.retrasado ? "border-red-500 bg-red-50 text-red-900" : "border-[#1b6fc2] bg-[rgb(27_111_194/0.06)] text-[#155a9f]",
  );
  const contenido = (
    <>
      <KanbanSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{hueco.titulo}</span>
      {!compacta && <span className="shrink-0 rounded-full bg-background/70 px-1.5 py-px text-xs font-medium">Encargo</span>}
    </>
  );
  return onAbrir ? (
    <button type="button" className={cn(clase, "hover:bg-[rgb(27_111_194/0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")} aria-label={etiqueta} title={etiqueta} data-testid={testId} data-retrasado={hueco.retrasado} onClick={() => onAbrir(hueco.id)}>
      {contenido}
    </button>
  ) : (
    <div className={clase} role="note" aria-label={etiqueta} title={etiqueta} data-testid={testId} data-retrasado={hueco.retrasado}>
      {contenido}
    </div>
  );
}
