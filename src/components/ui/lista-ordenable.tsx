// ---------------------------------------------------------------------------
// Lista ordenable común (tarea «Ordenar la Cata arrastrando»). Cada elemento
// se arrastra desde su asa, con ratón, con el dedo o con el teclado (Espacio o
// Intro para coger, flechas para mover, Escape para cancelar). Los botones de
// subir y bajar los pone quien la usa: esta lista no los sustituye.
//
// - Solo el asa escucha el arrastre y solo ella lleva `touch-action: none`:
//   deslizar el dedo por el resto de la fila desplaza la página.
// - Movimiento solo en vertical y dentro de la lista: no hay scroll horizontal
//   y soltar fuera deja el elemento donde estaba.
// - Con un solo elemento no se puede arrastrar.
// - Anuncios para lector de pantalla en español.
// ---------------------------------------------------------------------------

import { type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ElementoListaOrdenable {
  /** El asa de arrastre ya montada (44 × 44 px). */
  asa: ReactNode;
  /** true mientras este elemento se está arrastrando. */
  arrastrando: boolean;
}

interface ListaOrdenableProps {
  /** Ids estables de los elementos, en orden. */
  ids: string[];
  /** Nombre legible de un elemento, para el asa y los anuncios. */
  nombre: (id: string) => string;
  /** Se llama al soltar en otra posición dentro de la lista. */
  onMover: (desde: number, hasta: number) => void;
  /** Contenido de cada fila (el `li` lo pone la lista, con `data-clave={id}`). */
  children: (id: string, indice: number, elemento: ElementoListaOrdenable) => ReactNode;
  className?: string;
  claseElemento?: string;
  "aria-label"?: string;
}

export const INSTRUCCIONES_LISTA_ORDENABLE: ScreenReaderInstructions = {
  draggable:
    "Para coger este elemento, pulsa Espacio o Intro. Mientras lo tienes, usa las flechas arriba y abajo para moverlo. Pulsa Espacio o Intro otra vez para soltarlo, o Escape para cancelar.",
};

/** Anuncios en español para el lector de pantalla. */
export function anunciosListaOrdenable(ids: string[], nombre: (id: string) => string): Announcements {
  const total = ids.length;
  const posicion = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1;
  const de = (id: UniqueIdentifier) => `«${nombre(String(id))}»`;
  return {
    onDragStart: ({ active }) => `Has cogido ${de(active.id)}. Está en la posición ${posicion(active.id)} de ${total}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${de(active.id)} pasaría a la posición ${posicion(over.id)} de ${total}.`
        : `${de(active.id)} está fuera de la lista.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Has soltado ${de(active.id)} en la posición ${posicion(over.id)} de ${total}.`
        : `Has soltado ${de(active.id)} fuera de la lista. Se queda en la posición ${posicion(active.id)}.`,
    onDragCancel: ({ active }) =>
      `Cancelado. ${de(active.id)} vuelve a la posición ${posicion(active.id)} de ${total}.`,
  };
}

/** Índices de origen y destino de un arrastre terminado, o null si no hay que mover nada. */
export function destinoArrastre(ids: string[], { active, over }: Pick<DragEndEvent, "active" | "over">) {
  if (!over || active.id === over.id) return null;
  const desde = ids.indexOf(String(active.id));
  const hasta = ids.indexOf(String(over.id));
  if (desde < 0 || hasta < 0) return null;
  return { desde, hasta };
}

export function ListaOrdenable({
  ids,
  nombre,
  onMover,
  children,
  className,
  claseElemento,
  "aria-label": ariaLabel,
}: ListaOrdenableProps) {
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const fijo = ids.length < 2;

  return (
    <DndContext
      sensors={sensores}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      accessibility={{
        announcements: anunciosListaOrdenable(ids, nombre),
        screenReaderInstructions: INSTRUCCIONES_LISTA_ORDENABLE,
      }}
      onDragEnd={(evento) => {
        const destino = destinoArrastre(ids, evento);
        if (destino) onMover(destino.desde, destino.hasta);
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={fijo}>
        <ol className={className} aria-label={ariaLabel}>
          {ids.map((id, indice) => (
            <ElementoOrdenable key={id} id={id} nombre={nombre(id)} fijo={fijo} className={claseElemento}>
              {(elemento) => children(id, indice, elemento)}
            </ElementoOrdenable>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function ElementoOrdenable({
  id,
  nombre,
  fijo,
  className,
  children,
}: {
  id: string;
  nombre: string;
  fijo: boolean;
  className?: string;
  children: (elemento: ElementoListaOrdenable) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: fijo,
  });

  const asa = (
    <Button
      ref={setActivatorNodeRef}
      type="button"
      variant="ghost"
      size="icon"
      disabled={fijo}
      data-asa-arrastre=""
      {...attributes}
      {...listeners}
      aria-roledescription="elemento ordenable"
      aria-label={`Arrastrar «${nombre}»`}
      className="h-11 w-11 shrink-0 touch-none cursor-grab active:cursor-grabbing"
    >
      <GripVertical className="h-5 w-5" aria-hidden="true" />
    </Button>
  );

  return (
    <li
      ref={setNodeRef}
      data-clave={id}
      data-arrastrando={isDragging ? "" : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "relative",
        // El elemento cogido se levanta; el hueco que deja al moverse marca dónde caerá.
        isDragging && "z-20 rounded-md bg-background shadow-lg ring-2 ring-primary",
        className,
      )}
    >
      {children({ asa, arrastrando: isDragging })}
    </li>
  );
}
