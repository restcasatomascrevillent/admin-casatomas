import { useState, useMemo } from "react";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, DragStartEvent, DragEndEvent, useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Clock, Users, Star, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";

const ESTADOS_RESERVA: Record<string, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "bg-yellow-500" },
  verificada: { label: "Verificada", color: "bg-blue-500" },
  confirmada: { label: "Confirmada", color: "bg-green-500" },
  cancelada: { label: "Cancelada", color: "bg-red-500" },
  rechazada: { label: "Rechazada", color: "bg-destructive" },
  completada: { label: "Completada", color: "bg-primary" },
  "no-show": { label: "No Show", color: "bg-gray-500" },
};

interface Reserva {
  id: string;
  nombre: string | null;
  hora: string;
  numero_comensales: number;
  estado: string;
  importante: boolean;
  espacio_id: string | null;
  email: string | null;
  telefono: string | null;
}

// Draggable reservation card
function ReservaCard({ reserva, isDragOverlay }: { reserva: Reserva; isDragOverlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: reserva.id,
    data: reserva,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const estadoInfo = ESTADOS_RESERVA[reserva.estado] || { label: reserva.estado, color: "bg-gray-500" };

  if (isDragOverlay) {
    return (
      <div className="p-3 rounded-lg border bg-card shadow-lg w-[220px]">
        <CardContent reserva={reserva} estadoInfo={estadoInfo} />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "p-3 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing",
        isDragging && "opacity-30",
        reserva.importante && "border-amber-400 bg-amber-50/30 dark:bg-amber-950/20"
      )}
      {...listeners}
      {...attributes}
    >
      <CardContent reserva={reserva} estadoInfo={estadoInfo} />
    </div>
  );
}

function CardContent({ reserva, estadoInfo }: { reserva: Reserva; estadoInfo: { label: string; color: string } }) {
  return (
    <>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {reserva.importante && <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />}
          <span className="font-medium text-sm truncate">{reserva.nombre || "Sin nombre"}</span>
        </div>
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {typeof reserva.hora === "string" ? reserva.hora.substring(0, 5) : reserva.hora}
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {reserva.numero_comensales}
        </span>
        <Badge className={cn("text-[10px] px-1.5 py-0 text-white h-4", estadoInfo.color)}>
          {estadoInfo.label}
        </Badge>
      </div>
    </>
  );
}

// Droppable column
function KanbanColumn({
  id,
  title,
  capacidadMax,
  comensalesActuales,
  children,
  count,
}: {
  id: string;
  title: string;
  capacidadMax?: number;
  comensalesActuales: number;
  children: React.ReactNode;
  count: number;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  const porcentaje = capacidadMax ? Math.min(100, Math.round((comensalesActuales / capacidadMax) * 100)) : 0;
  const excedido = capacidadMax ? comensalesActuales > capacidadMax : false;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-xl border bg-muted/30 min-w-[240px] w-[260px] shrink-0",
        isOver && "ring-2 ring-primary/50 bg-primary/5"
      )}
    >
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm">{title}</h4>
          <Badge variant="secondary" className="text-xs">{count}</Badge>
        </div>
        {capacidadMax != null && (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{comensalesActuales}/{capacidadMax} pax</span>
              <span className={cn(excedido && "text-destructive font-medium")}>{porcentaje}%</span>
            </div>
            <Progress value={porcentaje} className={cn("h-1.5", excedido && "[&>div]:bg-destructive")} />
          </>
        )}
      </div>
      {/* Cards */}
      <ScrollArea className="flex-1 max-h-[60vh]">
        <div className="p-2 space-y-2 min-h-[100px]">
          {children}
          {count === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              Arrastra reservas aquí
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function GestorReservasKanban() {
  const queryClient = useQueryClient();
  const { data: espacios } = useEspaciosReserva();
  const [activeReserva, setActiveReserva] = useState<Reserva | null>(null);
  const hoy = format(new Date(), "yyyy-MM-dd");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const { data: reservas, isLoading } = useQuery({
    queryKey: ["reservas-kanban", hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservas")
        .select("id, nombre, hora, numero_comensales, estado, importante, espacio_id, email, telefono")
        .eq("fecha", hoy)
        .not("estado", "in", "(cancelada,rechazada)")
        .order("hora", { ascending: true });
      if (error) throw error;
      return data as Reserva[];
    },
  });

  const espaciosActivos = useMemo(
    () => (espacios || []).filter((e: any) => e.activa !== false),
    [espacios]
  );

  const columnas = useMemo(() => {
    const cols: { id: string; title: string; capacidadMax?: number }[] = [
      { id: "sin-asignar", title: "Sin asignar" },
      ...espaciosActivos.map((e: any) => ({
        id: e.id,
        title: e.nombre,
        capacidadMax: e.capacidad_maxima,
      })),
    ];
    return cols;
  }, [espaciosActivos]);

  const reservasPorColumna = useMemo(() => {
    const map: Record<string, Reserva[]> = {};
    columnas.forEach((c) => (map[c.id] = []));
    (reservas || []).forEach((r) => {
      const key = r.espacio_id || "sin-asignar";
      if (map[key]) map[key].push(r);
      else map["sin-asignar"].push(r);
    });
    return map;
  }, [reservas, columnas]);

  const comensalesPorColumna = useMemo(() => {
    const map: Record<string, number> = {};
    Object.entries(reservasPorColumna).forEach(([key, list]) => {
      map[key] = list.reduce((sum, r) => sum + r.numero_comensales, 0);
    });
    return map;
  }, [reservasPorColumna]);

  const handleDragStart = (event: DragStartEvent) => {
    const r = (reservas || []).find((res) => res.id === event.active.id);
    setActiveReserva(r || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveReserva(null);
    const { active, over } = event;
    if (!over) return;

    const reservaId = active.id as string;
    const targetColumnId = over.id as string;
    const newEspacioId = targetColumnId === "sin-asignar" ? null : targetColumnId;

    const reserva = (reservas || []).find((r) => r.id === reservaId);
    if (!reserva) return;
    if (reserva.espacio_id === newEspacioId) return;

    // Check capacity
    if (newEspacioId) {
      const col = columnas.find((c) => c.id === newEspacioId);
      if (col?.capacidadMax) {
        const currentPax = comensalesPorColumna[newEspacioId] || 0;
        if (currentPax + reserva.numero_comensales > col.capacidadMax) {
          toast.warning(`Se excede la capacidad máxima de ${col.title} (${col.capacidadMax} pax)`);
        }
      }
    }

    // Optimistic update
    queryClient.setQueryData(["reservas-kanban", hoy], (old: Reserva[] | undefined) =>
      (old || []).map((r) => (r.id === reservaId ? { ...r, espacio_id: newEspacioId } : r))
    );

    const { error } = await supabase
      .from("reservas")
      .update({ espacio_id: newEspacioId })
      .eq("id", reservaId);

    if (error) {
      toast.error("Error al mover la reserva");
      queryClient.invalidateQueries({ queryKey: ["reservas-kanban", hoy] });
    } else {
      const destino = newEspacioId
        ? columnas.find((c) => c.id === newEspacioId)?.title
        : "Sin asignar";
      toast.success(`Reserva movida a ${destino}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Cargando reservas...
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {columnas.map((col) => (
          <KanbanColumn
            key={col.id}
            id={col.id}
            title={col.title}
            capacidadMax={col.capacidadMax}
            comensalesActuales={comensalesPorColumna[col.id] || 0}
            count={reservasPorColumna[col.id]?.length || 0}
          >
            {(reservasPorColumna[col.id] || []).map((reserva) => (
              <ReservaCard key={reserva.id} reserva={reserva} />
            ))}
          </KanbanColumn>
        ))}
      </div>

      <DragOverlay>
        {activeReserva ? <ReservaCard reserva={activeReserva} isDragOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
