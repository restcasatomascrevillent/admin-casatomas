import type { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { restrictToHorizontalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { X } from "lucide-react";
import { anunciosListaOrdenable, destinoArrastre } from "@/components/ui/lista-ordenable";
import { cn } from "@/lib/utils";
import type { Foto } from "@/lib/instagram";
import { MiniaturaFoto, nombreFoto } from "./BibliotecaFotos";

interface Props {
  ids: string[];
  catalogo: readonly Foto[];
  baseFotos: string;
  onMover: (desde: number, hasta: number) => void;
  onQuitar: (id: string) => void;
  /** Imagen que se ve en la vista previa (se resalta). */
  actual?: number;
  onVer?: (indice: number) => void;
}

/**
 * Fotos elegidas en el orden en que se publican. Se arrastran con el ratón,
 * con el dedo o con el teclado (Espacio para coger, flechas para mover).
 * La primera es la portada.
 */
export function OrdenFotos({ ids, catalogo, baseFotos, onMover, onQuitar, actual, onVer }: Props) {
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const foto = (id: string) => catalogo.find((f) => f.id === id);
  const nombre = (id: string) => nombreFoto(foto(id));
  if (!ids.length) return null;

  return (
    <DndContext
      sensors={sensores}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
      accessibility={{
        announcements: anunciosListaOrdenable(ids, nombre),
        screenReaderInstructions: {
          draggable: "Para coger esta foto, pulsa Espacio. Muévela con las flechas izquierda y derecha y suéltala con Espacio, o cancela con Escape.",
        },
      }}
      onDragEnd={(evento) => {
        const d = destinoArrastre(ids, evento);
        if (d) onMover(d.desde, d.hasta);
      }}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy} disabled={ids.length < 2}>
        <ol className="flex gap-2 overflow-x-auto pb-1 pt-2" aria-label="Orden de las fotos" data-testid="orden-fotos">
          {ids.map((id, i) => (
            <Ficha
              key={id}
              id={id}
              indice={i}
              nombre={nombre(id)}
              resaltada={actual === i}
              fijo={ids.length < 2}
              onQuitar={() => onQuitar(id)}
              onVer={onVer ? () => onVer(i) : undefined}
            >
              {foto(id) ? <MiniaturaFoto foto={foto(id)!} baseFotos={baseFotos} /> : <span className="block h-full w-full bg-muted" />}
            </Ficha>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function Ficha({
  id,
  indice,
  nombre,
  resaltada,
  fijo,
  onQuitar,
  onVer,
  children,
}: {
  id: string;
  indice: number;
  nombre: string;
  resaltada: boolean;
  fijo: boolean;
  onQuitar: () => void;
  onVer?: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: fijo });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative w-16 shrink-0", isDragging && "z-20")}
      data-clave={id}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-roledescription="foto ordenable"
        aria-label={`${indice === 0 ? "Portada" : `Foto ${indice + 1}`}: ${nombre}. Arrástrala para cambiar el orden.`}
        onClick={onVer}
        className={cn(
          "block aspect-[4/5] w-full touch-none overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          fijo ? "cursor-default" : "cursor-grab active:cursor-grabbing",
          resaltada ? "border-primary ring-2 ring-primary" : "border-border",
          isDragging && "shadow-lg ring-2 ring-primary",
        )}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-background/90 px-1 text-xs font-semibold leading-4 text-foreground" aria-hidden="true">
        {indice === 0 ? "Portada" : indice + 1}
      </span>
      {/* Botón pequeño a la vista, con 44 px de zona táctil (after:-inset). */}
      <button
        type="button"
        onClick={onQuitar}
        aria-label={`Quitar ${nombre}`}
        className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border bg-background text-foreground shadow-sm after:absolute after:-inset-2.5 after:content-[''] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}
