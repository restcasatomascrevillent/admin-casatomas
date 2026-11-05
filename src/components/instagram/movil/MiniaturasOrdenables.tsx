/**
 * Rejilla de miniaturas reordenables con el dedo (mantener pulsado y
 * arrastrar), con el ratón o con el teclado. Tocar una foto la selecciona y
 * abre la barra de abajo con «Antes», «Después» y «Quitar» (botones de 48 px,
 * para quien no quiera arrastrar o use lector de pantalla).
 */
import type { ReactNode } from "react";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FotoMovil } from "./estado";

interface Props {
  fotos: FotoMovil[];
  seleccionada: string | null;
  onSeleccionar: (clave: string | null) => void;
  onMover: (desde: number, hasta: number) => void;
  onQuitar: (clave: string) => void;
  /** Hueco final («Añadir»), si quedan sitios. */
  extra?: ReactNode;
}

function Miniatura({ foto, indice, total, seleccionada, onSeleccionar, onQuitar }: { foto: FotoMovil; indice: number; total: number; seleccionada: boolean; onSeleccionar: () => void; onQuitar: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: foto.clave });
  const estado =
    foto.estado === "subida" ? "subida" : foto.estado === "error" ? "no se ha podido subir" : foto.estado === "preparando" ? "preparándose" : "subiéndose";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, touchAction: "manipulation" }}
      className={cn("relative list-none", isDragging && "z-10 opacity-80")}
      data-clave={foto.clave}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={onSeleccionar}
        aria-pressed={seleccionada}
        aria-label={`Foto ${indice + 1} de ${total}${indice === 0 ? " (portada)" : ""}, ${estado}. Toca para moverla o quitarla; mantén pulsado para arrastrar.`}
        className={cn(
          "relative block aspect-[4/5] w-full overflow-hidden rounded-lg bg-muted outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring",
          seleccionada && "ring-4 ring-primary",
        )}
      >
        {foto.vista ? <img src={foto.vista} alt="" draggable={false} className="h-full w-full select-none object-cover" /> : null}
        <span className="absolute left-1 top-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">{indice === 0 ? "1 · Portada" : indice + 1}</span>
        <span className="absolute bottom-1 left-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white" aria-hidden="true">
          {foto.estado === "subida" ? (
            <Check className="h-4 w-4" />
          ) : foto.estado === "error" ? (
            <AlertCircle className="h-4 w-4 text-red-300" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={onQuitar}
        aria-label={`Quitar la foto ${indice + 1}`}
        className="absolute -right-1 -top-1 flex h-12 w-12 items-start justify-end p-1"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white shadow">
          <X className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>
    </li>
  );
}

export function MiniaturasOrdenables({ fotos, seleccionada, onSeleccionar, onMover, onQuitar, extra }: Props) {
  const sensores = useSensors(
    // Mantener pulsado 200 ms para arrastrar: deslizar sin más sigue haciendo scroll.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = fotos.map((f) => f.clave);
  const alSoltar = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const desde = ids.indexOf(String(e.active.id));
    const hasta = ids.indexOf(String(e.over.id));
    if (desde >= 0 && hasta >= 0) onMover(desde, hasta);
  };
  return (
    <DndContext
      sensors={sensores}
      collisionDetection={closestCenter}
      onDragEnd={alSoltar}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Has cogido la foto ${ids.indexOf(String(active.id)) + 1}.`,
          onDragOver: ({ over }) => (over ? `Sobre la posición ${ids.indexOf(String(over.id)) + 1}.` : "Fuera de la lista."),
          onDragEnd: ({ over }) => (over ? `Foto colocada en la posición ${ids.indexOf(String(over.id)) + 1}.` : "Foto soltada sin moverla."),
          onDragCancel: () => "Movimiento cancelado.",
        },
        screenReaderInstructions: { draggable: "Pulsa Espacio para coger la foto, muévela con las flechas y pulsa Espacio para soltarla." },
      }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ul className="grid grid-cols-3 gap-2" aria-label="Fotos elegidas, en el orden en que se publicarán">
          {fotos.map((f, i) => (
            <Miniatura
              key={f.clave}
              foto={f}
              indice={i}
              total={fotos.length}
              seleccionada={seleccionada === f.clave}
              onSeleccionar={() => onSeleccionar(seleccionada === f.clave ? null : f.clave)}
              onQuitar={() => onQuitar(f.clave)}
            />
          ))}
          {extra ? <li className="list-none">{extra}</li> : null}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
