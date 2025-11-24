import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDashboardConfig } from "@/hooks/useDashboardConfig";
import { toast } from "sonner";
import { GripVertical, Save, Trash2, Star } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgetsDisponibles: { id: string; nombre: string }[];
  widgetsActivos: string[];
  ordenWidgets: string[];
  onSave: (activos: string[], orden: string[]) => void;
}

function SortableWidget({ id, nombre, activo, onToggle }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 border border-border rounded-lg bg-card hover:bg-muted/50"
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>
      <Checkbox checked={activo} onCheckedChange={() => onToggle(id)} id={id} />
      <Label htmlFor={id} className="flex-1 cursor-pointer">
        {nombre}
      </Label>
    </div>
  );
}

export function PersonalizarDashboard({
  open,
  onOpenChange,
  widgetsDisponibles,
  widgetsActivos: initialActivos,
  ordenWidgets: initialOrden,
  onSave,
}: Props) {
  const [widgetsActivos, setWidgetsActivos] = useState<string[]>(initialActivos);
  const [ordenWidgets, setOrdenWidgets] = useState<string[]>(initialOrden);
  const [nombreVista, setNombreVista] = useState("");
  const { configs, saveConfig, setDefaultConfig, deleteConfig } = useDashboardConfig();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = ordenWidgets.indexOf(active.id as string);
    const newIndex = ordenWidgets.indexOf(over.id as string);

    setOrdenWidgets(arrayMove(ordenWidgets, oldIndex, newIndex));
  };

  const toggleWidget = (id: string) => {
    if (widgetsActivos.includes(id)) {
      setWidgetsActivos(widgetsActivos.filter((w) => w !== id));
    } else {
      setWidgetsActivos([...widgetsActivos, id]);
      if (!ordenWidgets.includes(id)) {
        setOrdenWidgets([...ordenWidgets, id]);
      }
    }
  };

  const handleSave = () => {
    onSave(widgetsActivos, ordenWidgets);
    toast.success("Configuración aplicada");
  };

  const handleSaveVista = async () => {
    if (!nombreVista.trim()) {
      toast.error("Ingresa un nombre para la vista");
      return;
    }

    await saveConfig.mutateAsync({
      nombre: nombreVista,
      widgets: widgetsActivos,
      orden: ordenWidgets,
    });
    setNombreVista("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Personalizar Dashboard</DialogTitle>
          <DialogDescription>
            Activa/desactiva widgets y reordénalos arrastrándolos
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Vistas guardadas */}
          {configs && configs.length > 0 && (
            <div className="space-y-2">
              <Label>Vistas Guardadas</Label>
              <div className="flex flex-wrap gap-2">
                {configs.map((config) => (
                  <div
                    key={config.id}
                    className="flex items-center gap-2 p-2 border border-border rounded-lg"
                  >
                    {config.is_default && <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />}
                    <span className="text-sm">{config.nombre_vista}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => setDefaultConfig.mutate(config.id)}
                    >
                      Usar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-destructive"
                      onClick={() => deleteConfig.mutate(config.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lista de widgets */}
          <div className="space-y-2">
            <Label>Widgets Disponibles ({widgetsActivos.length} activos)</Label>
            <ScrollArea className="h-[300px] pr-4">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={ordenWidgets} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {ordenWidgets.map((widgetId) => {
                      const widget = widgetsDisponibles.find((w) => w.id === widgetId);
                      if (!widget) return null;
                      return (
                        <SortableWidget
                          key={widgetId}
                          id={widgetId}
                          nombre={widget.nombre}
                          activo={widgetsActivos.includes(widgetId)}
                          onToggle={toggleWidget}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            </ScrollArea>
          </div>

          {/* Guardar vista */}
          <div className="space-y-2 pt-4 border-t">
            <Label>Guardar como Vista Personalizada</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Nombre de la vista (ej: Vista Gerente)"
                value={nombreVista}
                onChange={(e) => setNombreVista(e.target.value)}
              />
              <Button onClick={handleSaveVista} disabled={saveConfig.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Guardar
              </Button>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave}>Aplicar Cambios</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
