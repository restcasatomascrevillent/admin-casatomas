import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { ArrowLeft, Search, Users, Clock, GripVertical } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";

const ESTADOS_RESERVA: Record<string, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "bg-yellow-500" },
  verificada: { label: "Verificada", color: "bg-blue-500" },
  confirmada: { label: "Confirmada", color: "bg-green-500" },
  cancelada: { label: "Cancelada", color: "bg-red-500" },
  "no-show": { label: "No Show", color: "bg-gray-500" },
};

// ── Draggable reservation card (sidebar) ──
function ReservaCardDraggable({ reserva }: { reserva: any }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: reserva.id,
    data: reserva,
  });

  const estadoInfo = ESTADOS_RESERVA[reserva.estado] || { label: reserva.estado, color: "bg-gray-500" };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-2 p-2.5 rounded-lg border bg-card cursor-grab active:cursor-grabbing transition-all hover:shadow-sm hover:border-primary/30",
        isDragging && "opacity-30"
      )}
      {...listeners}
      {...attributes}
    >
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-medium truncate">{reserva.nombre || "Sin nombre"}</span>
          <Badge className={cn("text-white text-[10px] px-1.5 py-0 shrink-0", estadoInfo.color)}>
            {estadoInfo.label}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {typeof reserva.hora === "string" ? reserva.hora.substring(0, 5) : reserva.hora}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {reserva.numero_comensales}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Drag overlay (floating card while dragging) ──
function ReservaOverlay({ reserva }: { reserva: any }) {
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-lg border bg-card shadow-lg w-[260px]">
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate">{reserva.nombre || "Sin nombre"}</span>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {typeof reserva.hora === "string" ? reserva.hora.substring(0, 5) : reserva.hora}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {reserva.numero_comensales}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Kanban column card (already assigned) ──
function KanbanCard({ reserva }: { reserva: any }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded border bg-card text-sm">
      <span className="truncate font-medium">{reserva.nombre || "Sin nombre"}</span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
        <Users className="h-3 w-3" />
        {reserva.numero_comensales}
      </span>
    </div>
  );
}

// ── Droppable kanban column ──
function KanbanColumn({ espacio, reservas }: { espacio: any; reservas: any[] }) {
  const { isOver, setNodeRef } = useDroppable({
    id: espacio.id,
  });

  const totalComensales = reservas.reduce((acc: number, r: any) => acc + (r.numero_comensales || 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-xl border-2 border-dashed transition-colors min-h-[300px]",
        isOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"
      )}
    >
      <div className="p-3 border-b bg-muted/30 rounded-t-xl">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{espacio.nombre}</h3>
          <Badge variant="outline" className="text-xs">
            {totalComensales}/{espacio.capacidad_maxima}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {reservas.length} reserva{reservas.length !== 1 ? "s" : ""}
        </p>
      </div>
      <ScrollArea className="flex-1 p-2">
        <div className="space-y-1.5">
          {reservas.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              Arrastra reservas aquí
            </p>
          ) : (
            reservas.map((r: any) => <KanbanCard key={r.id} reserva={r} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Main page ──
export default function GestionSalas() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [ordenar, setOrdenar] = useState("hora");
  const [activeReserva, setActiveReserva] = useState<any>(null);

  const hoy = format(new Date(), "yyyy-MM-dd");

  const { data: espacios } = useEspaciosReserva();

  const { data: reservasHoy } = useQuery({
    queryKey: ["reservas-hoy-gestion", hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservas")
        .select("*, espacios_reserva:sala_id (nombre)")
        .eq("fecha", hoy)
        .neq("estado", "cancelada")
        .order("hora", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Split reservations: unassigned (no sala_id or not in active spaces) vs assigned per space
  const { sinAsignar, porEspacio } = useMemo(() => {
    const espacioIds = new Set((espacios || []).map((e: any) => e.id));
    const sin: any[] = [];
    const por: Record<string, any[]> = {};
    (espacios || []).forEach((e: any) => {
      por[e.id] = [];
    });

    (reservasHoy || []).forEach((r: any) => {
      if (r.sala_id && espacioIds.has(r.sala_id)) {
        por[r.sala_id]?.push(r);
      } else {
        sin.push(r);
      }
    });
    return { sinAsignar: sin, porEspacio: por };
  }, [reservasHoy, espacios]);

  // Filter & sort sidebar
  const reservasFiltradas = useMemo(() => {
    const term = busqueda.toLowerCase();
    let list = sinAsignar.filter((r) => {
      const matchBusqueda =
        !term ||
        (r.nombre || "").toLowerCase().includes(term) ||
        (r.email || "").toLowerCase().includes(term) ||
        (r.telefono || "").toLowerCase().includes(term);
      const matchEstado = filtroEstado === "todos" || r.estado === filtroEstado;
      return matchBusqueda && matchEstado;
    });

    if (ordenar === "hora") {
      list.sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
    } else if (ordenar === "nombre") {
      list.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    } else if (ordenar === "comensales") {
      list.sort((a, b) => (b.numero_comensales || 0) - (a.numero_comensales || 0));
    }
    return list;
  }, [sinAsignar, busqueda, filtroEstado, ordenar]);

  // Also filter assigned reservations in kanban
  const reservasAsignadas = useMemo(() => {
    const all = reservasHoy || [];
    return all.filter((r: any) => r.sala_id && (espacios || []).some((e: any) => e.id === r.sala_id));
  }, [reservasHoy, espacios]);

  const handleDragStart = (event: DragStartEvent) => {
    const reserva = sinAsignar.find((r) => r.id === event.active.id) || reservasHoy?.find((r: any) => r.id === event.active.id);
    setActiveReserva(reserva || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveReserva(null);
    const { active, over } = event;
    if (!over) return;

    const reservaId = active.id as string;
    const espacioId = over.id as string;

    // Check it's a valid space
    if (!(espacios || []).some((e: any) => e.id === espacioId)) return;

    try {
      const { error } = await supabase
        .from("reservas")
        .update({ sala_id: espacioId })
        .eq("id", reservaId);

      if (error) throw error;

      toast.success("Reserva asignada al espacio");
      queryClient.invalidateQueries({ queryKey: ["reservas-hoy-gestion"] });
      queryClient.invalidateQueries({ queryKey: ["reservas-hoy"] });
      queryClient.invalidateQueries({ queryKey: ["ocupacion_hoy"] });
    } catch (err: any) {
      toast.error("Error al asignar: " + err.message);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/reservas")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Gestión de Salas</h2>
            <p className="text-muted-foreground text-sm">Arrastra las reservas a los espacios del restaurante</p>
          </div>
        </div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 h-[calc(100vh-200px)]">
            {/* ── Left sidebar: unassigned reservations ── */}
            <div className="w-[320px] shrink-0 flex flex-col border rounded-xl bg-card">
              <div className="p-3 border-b space-y-2">
                <h3 className="font-semibold text-sm">Reservas sin asignar ({sinAsignar.length})</h3>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    className="pl-9 h-9 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Select value={filtroEstado} onValueChange={setFiltroEstado}>
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="confirmada">Confirmada</SelectItem>
                      <SelectItem value="pendiente">Pendiente</SelectItem>
                      <SelectItem value="verificada">Verificada</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={ordenar} onValueChange={setOrdenar}>
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hora">Por hora</SelectItem>
                      <SelectItem value="nombre">Por nombre</SelectItem>
                      <SelectItem value="comensales">Por comensales</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <ScrollArea className="flex-1 p-2">
                <div className="space-y-1.5">
                  {reservasFiltradas.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No hay reservas sin asignar
                    </p>
                  ) : (
                    reservasFiltradas.map((r) => (
                      <ReservaCardDraggable key={r.id} reserva={r} />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* ── Right: Kanban columns ── */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-min overflow-y-auto">
              {(espacios || []).map((espacio: any) => (
                <KanbanColumn
                  key={espacio.id}
                  espacio={espacio}
                  reservas={porEspacio[espacio.id] || []}
                />
              ))}
            </div>
          </div>

          <DragOverlay>
            {activeReserva ? <ReservaOverlay reserva={activeReserva} /> : null}
          </DragOverlay>
        </DndContext>
      </div>
    </DashboardLayout>
  );
}
