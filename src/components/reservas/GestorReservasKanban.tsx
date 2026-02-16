import { useState, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  MeasuringStrategy,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Clock, Users, Star, GripVertical, Phone, Search, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: reserva.id,
    data: reserva,
  });

  const style: React.CSSProperties = isDragOverlay
    ? { boxShadow: "0 15px 35px -5px rgba(0,0,0,0.25), 0 5px 15px rgba(0,0,0,0.1)", transform: "scale(1.03) rotate(1deg)" }
    : {};

  const estadoInfo = ESTADOS_RESERVA[reserva.estado] || { label: reserva.estado, color: "bg-gray-500" };

  if (isDragOverlay) {
    return (
      <div
        className="p-3 rounded-lg border-2 border-primary bg-card w-[230px] animate-in zoom-in-95 duration-150"
        style={style}
      >
        <CardContent reserva={reserva} estadoInfo={estadoInfo} />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "p-3 rounded-lg border bg-card transition-all duration-200 cursor-grab active:cursor-grabbing group outline-none focus:outline-none focus-visible:outline-none",
        "hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5",
        isDragging && "opacity-20 scale-95 border-dashed border-primary/40",
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
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {reserva.importante && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0" />}
          <span className="font-semibold text-sm truncate">{reserva.nombre || "Sin nombre"}</span>
        </div>
        <GripVertical className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1 bg-muted/50 rounded-md px-1.5 py-0.5">
          <Clock className="h-3 w-3" />
          {typeof reserva.hora === "string" ? reserva.hora.substring(0, 5) : reserva.hora}
        </span>
        <span className="flex items-center gap-1 bg-muted/50 rounded-md px-1.5 py-0.5">
          <Users className="h-3 w-3" />
          {reserva.numero_comensales}
        </span>
        <Badge className={cn("text-[10px] px-1.5 py-0 text-white h-4", estadoInfo.color)}>
          {estadoInfo.label}
        </Badge>
      </div>
      {reserva.telefono && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 mt-1.5">
          <Phone className="h-2.5 w-2.5" />
          {reserva.telefono}
        </div>
      )}
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
  isActive,
  minimized,
  onToggleMinimize,
}: {
  id: string;
  title: string;
  capacidadMax?: number;
  comensalesActuales: number;
  children: React.ReactNode;
  count: number;
  isActive: boolean;
  minimized: boolean;
  onToggleMinimize: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  const porcentaje = capacidadMax ? Math.min(100, Math.round((comensalesActuales / capacidadMax) * 100)) : 0;
  const excedido = capacidadMax ? comensalesActuales > capacidadMax : false;

  if (minimized) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-col items-center rounded-xl border-2 bg-muted/20 w-[52px] shrink-0 transition-all duration-200 cursor-pointer outline-none focus:outline-none focus-visible:outline-none",
          isOver && "border-primary bg-primary/5 shadow-lg shadow-primary/10",
          !isOver && "border-transparent hover:border-muted-foreground/20",
        )}
        onClick={onToggleMinimize}
      >
        <div className="p-2 flex flex-col items-center gap-2">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold [writing-mode:vertical-lr] rotate-180 whitespace-nowrap">
            {title}
          </span>
          <Badge variant="secondary" className="text-[10px] px-1.5 tabular-nums">{count}</Badge>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-xl border-2 bg-muted/20 min-w-[250px] w-[270px] shrink-0 transition-all duration-200 outline-none focus:outline-none focus-visible:outline-none",
        isOver && "border-primary bg-primary/5 shadow-lg shadow-primary/10 scale-[1.01]",
        !isOver && "border-transparent",
        isActive && !isOver && "border-muted-foreground/10"
      )}
    >
      {/* Header */}
      <div className={cn(
        "p-3 border-b space-y-2 transition-colors duration-200",
        isOver && "bg-primary/5"
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              onClick={onToggleMinimize}
              className="p-0.5 rounded hover:bg-muted transition-colors outline-none focus:outline-none focus-visible:outline-none"
              title="Minimizar columna"
            >
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <h4 className="font-semibold text-sm">{title}</h4>
          </div>
          <Badge variant="secondary" className="text-xs tabular-nums">{count}</Badge>
        </div>
        {capacidadMax != null && (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="tabular-nums">{comensalesActuales}/{capacidadMax} pax</span>
              <span className={cn("tabular-nums", excedido && "text-destructive font-medium")}>{porcentaje}%</span>
            </div>
            <Progress value={porcentaje} className={cn("h-1.5", excedido && "[&>div]:bg-destructive")} />
          </>
        )}
      </div>
      {/* Cards */}
      <ScrollArea className="flex-1 max-h-[70vh]">
        <div className={cn(
          "p-2 space-y-2 min-h-[120px] transition-colors duration-200 rounded-b-xl",
          isOver && "bg-primary/[0.02]"
        )}>
          {children}
          {count === 0 && (
            <div className={cn(
              "flex flex-col items-center justify-center py-8 text-muted-foreground/50 transition-all duration-200",
              isOver && "text-primary/60 scale-105"
            )}>
              <div className={cn(
                "w-12 h-12 rounded-full border-2 border-dashed flex items-center justify-center mb-2 transition-colors",
                isOver ? "border-primary/40 bg-primary/5" : "border-muted-foreground/20"
              )}>
                <Users className="h-5 w-5" />
              </div>
              <p className="text-xs font-medium">
                {isOver ? "Soltar aquí" : "Arrastra reservas aquí"}
              </p>
            </div>
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
  const [busqueda, setBusqueda] = useState("");
  const [minimizedCols, setMinimizedCols] = useState<Set<string>>(new Set());
  const hoy = format(new Date(), "yyyy-MM-dd");

  const toggleMinimize = (colId: string) => {
    setMinimizedCols((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId);
      else next.add(colId);
      return next;
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
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

  const reservasFiltradas = useMemo(() => {
    if (!busqueda.trim()) return reservas || [];
    const q = busqueda.toLowerCase().trim();
    return (reservas || []).filter((r) =>
      (r.nombre || "").toLowerCase().includes(q) ||
      (r.email || "").toLowerCase().includes(q) ||
      (r.telefono || "").includes(q)
    );
  }, [reservas, busqueda]);

  const reservasPorColumna = useMemo(() => {
    const map: Record<string, Reserva[]> = {};
    columnas.forEach((c) => (map[c.id] = []));
    reservasFiltradas.forEach((r) => {
      const key = r.espacio_id || "sin-asignar";
      if (map[key]) map[key].push(r);
      else map["sin-asignar"].push(r);
    });
    return map;
  }, [reservasFiltradas, columnas]);

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
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, email o teléfono..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-9 focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        collisionDetection={closestCenter}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 px-1">
        {columnas.map((col) => (
          <KanbanColumn
            key={col.id}
            id={col.id}
            title={col.title}
            capacidadMax={col.capacidadMax}
            comensalesActuales={comensalesPorColumna[col.id] || 0}
            count={reservasPorColumna[col.id]?.length || 0}
            isActive={!!activeReserva}
            minimized={minimizedCols.has(col.id)}
            onToggleMinimize={() => toggleMinimize(col.id)}
          >
            {(reservasPorColumna[col.id] || []).map((reserva) => (
              <ReservaCard key={reserva.id} reserva={reserva} />
            ))}
          </KanbanColumn>
        ))}
      </div>

      <DragOverlay dropAnimation={{
        duration: 200,
        easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
      }}>
        {activeReserva ? <ReservaCard reserva={activeReserva} isDragOverlay /> : null}
      </DragOverlay>
      </DndContext>
    </div>
  );
}
