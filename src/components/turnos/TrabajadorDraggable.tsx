import { useDraggable } from "@dnd-kit/core";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GripVertical } from "lucide-react";
import { Trabajador } from "@/hooks/useTurnos";

interface TrabajadorDraggableProps {
  trabajador: Trabajador;
}

export const TrabajadorDraggable = ({ trabajador }: TrabajadorDraggableProps) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: trabajador.id,
    data: { trabajador },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`p-3 cursor-grab active:cursor-grabbing transition-all ${
        isDragging ? "opacity-50 shadow-lg" : "hover:shadow-md"
      }`}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">
            {trabajador.nombre} {trabajador.apellidos}
          </p>
          <Badge variant="secondary" className="text-xs mt-1">
            {trabajador.rol}
          </Badge>
        </div>
      </div>
    </Card>
  );
};
