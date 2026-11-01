import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Check, GripVertical, ImageOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ElementoOrdenable {
  id: string;
  nombre: string | null;
  imagen_url?: string | null;
  activado?: boolean | null;
}

interface OrdenarCategoriaProps {
  categoria: string;
  /** Todos los elementos de la categoría, en el orden actual. */
  elementos: ElementoOrdenable[];
  /** «platos», «bebidas»… para los textos. */
  nombrePlural: string;
  guardando: boolean;
  /** Guarda `ids` como 1, 2, 3…; si lanza, se sigue en el modo ordenar. */
  onGuardar: (ids: string[]) => Promise<unknown>;
  onSalir: () => void;
}

/**
 * Modo «Ordenar» de la pestaña Carta: lista compacta (miniatura + nombre) de
 * una categoría que se reordena arrastrando desde el asa (ratón, dedo o
 * teclado, mismo patrón que los conceptos de Facturación) o con las flechas
 * subir/bajar. No guarda nada hasta «Guardar orden».
 */
export function OrdenarCategoria({
  categoria,
  elementos,
  nombrePlural,
  guardando,
  onGuardar,
  onSalir,
}: OrdenarCategoriaProps) {
  const [ids, setIds] = useState<string[]>(() => elementos.map((e) => e.id));
  const porId = useMemo(() => new Map(elementos.map((e) => [e.id, e])), [elementos]);
  const idsOriginales = useMemo(() => elementos.map((e) => e.id), [elementos]);

  // Si la lista cambia mientras se ordena (alta, baja o refresco), se conserva
  // lo que ya se ha movido: fuera los que ya no están y los nuevos al final.
  useEffect(() => {
    setIds((previos) => {
      const vivos = previos.filter((id) => porId.has(id));
      const nuevos = idsOriginales.filter((id) => !vivos.includes(id));
      const siguiente = [...vivos, ...nuevos];
      return siguiente.length === previos.length && siguiente.every((id, i) => id === previos[i]) ? previos : siguiente;
    });
  }, [porId, idsOriginales]);

  const cambiado = ids.some((id, i) => id !== idsOriginales[i]);

  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const mover = (desde: number, hasta: number) => {
    if (hasta < 0 || hasta >= ids.length || desde === hasta) return;
    setIds((previos) => arrayMove(previos, desde, hasta));
  };

  const alSoltar = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    mover(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };

  const guardar = async () => {
    try {
      await onGuardar(ids);
      onSalir();
    } catch {
      // El aviso lo da el hook; se sigue aquí para poder reintentar.
    }
  };

  return (
    <section aria-label={`Ordenar ${categoria}`} className="space-y-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <h3 className="truncate font-semibold">Ordenar «{categoria}»</h3>
          <p className="text-xs text-muted-foreground">
            Arrastra desde <GripVertical className="inline h-3.5 w-3.5 align-text-bottom" aria-hidden /> o usa las
            flechas. Así saldrán los {nombrePlural} en la web.
          </p>
        </div>
        <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={onSalir} disabled={guardando}>
          Cancelar
        </Button>
        <Button type="button" className="h-11 flex-1 sm:flex-none" onClick={guardar} disabled={!cambiado || guardando}>
          {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Guardar orden
        </Button>
      </div>

      <DndContext sensors={sensores} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={alSoltar}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2" aria-label={`${nombrePlural} de ${categoria} en orden`}>
            {ids.map((id, indice) => {
              const elemento = porId.get(id);
              if (!elemento) return null;
              return (
                <FilaOrdenable
                  key={id}
                  elemento={elemento}
                  posicion={indice + 1}
                  esPrimero={indice === 0}
                  esUltimo={indice === ids.length - 1}
                  bloqueado={guardando}
                  onSubir={() => mover(indice, indice - 1)}
                  onBajar={() => mover(indice, indice + 1)}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
    </section>
  );
}

interface FilaOrdenableProps {
  elemento: ElementoOrdenable;
  posicion: number;
  esPrimero: boolean;
  esUltimo: boolean;
  bloqueado: boolean;
  onSubir: () => void;
  onBajar: () => void;
}

function FilaOrdenable({ elemento, posicion, esPrimero, esUltimo, bloqueado, onSubir, onBajar }: FilaOrdenableProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: elemento.id,
    disabled: bloqueado,
  });
  const nombre = elemento.nombre?.trim() || "Sin nombre";
  const [sinFoto, setSinFoto] = useState(false);
  const foto = elemento.imagen_url?.trim() && !sinFoto ? elemento.imagen_url : null;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative flex items-center gap-1.5 rounded-lg border bg-card p-1 sm:gap-2 sm:p-1.5 sm:pr-2",
        isDragging && "z-20 shadow-lg ring-2 ring-primary/30",
        elemento.activado === false && "opacity-60",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-11 w-11 shrink-0 touch-none cursor-grab active:cursor-grabbing"
        disabled={bloqueado}
        aria-label={`Arrastrar ${nombre}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5 text-muted-foreground" />
      </Button>
      {/* En móvil se oculta el número para dejar sitio al nombre. */}
      <span className="hidden w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:block" aria-hidden>
        {posicion}
      </span>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {foto ? (
          <img src={foto} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setSinFoto(true)} />
        ) : (
          <ImageOff className="h-4 w-4 text-muted-foreground/60" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{nombre}</p>
        {elemento.activado === false && <p className="text-xs text-muted-foreground">Oculto en la web</p>}
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-11 w-11 shrink-0"
        disabled={bloqueado || esPrimero}
        aria-label={`Subir ${nombre}`}
        onClick={onSubir}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-11 w-11 shrink-0"
        disabled={bloqueado || esUltimo}
        aria-label={`Bajar ${nombre}`}
        onClick={onBajar}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
    </li>
  );
}
