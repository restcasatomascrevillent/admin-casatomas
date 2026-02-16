import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useCrearBlacklist } from "@/hooks/useBlacklist";
import { ArrowLeft, Search, Users, Clock, GripVertical, Phone, Mail, MapPin, CalendarCheck, AlertCircle, ShieldBan, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
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

const ESTADOS_RESERVA: Record<string, { label: string; color: string; bg: string }> = {
  pendiente: { label: "Pendiente", color: "bg-yellow-500", bg: "bg-yellow-500/10 text-yellow-700 border-yellow-200" },
  verificada: { label: "Verificada", color: "bg-blue-500", bg: "bg-blue-500/10 text-blue-700 border-blue-200" },
  confirmada: { label: "Confirmada", color: "bg-green-500", bg: "bg-green-500/10 text-green-700 border-green-200" },
  cancelada: { label: "Cancelada", color: "bg-red-500", bg: "bg-red-500/10 text-red-700 border-red-200" },
  "no-show": { label: "No Show", color: "bg-gray-500", bg: "bg-gray-500/10 text-gray-700 border-gray-200" },
};

// ── Draggable reservation card (sidebar) ──
function ReservaCardDraggable({ reserva, onBlacklist }: { reserva: any; onBlacklist: (r: any) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: reserva.id,
    data: reserva,
  });

  const estadoInfo = ESTADOS_RESERVA[reserva.estado] || { label: reserva.estado, color: "bg-gray-500", bg: "bg-gray-500/10 text-gray-700 border-gray-200" };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group flex items-start gap-2.5 p-3 rounded-lg border bg-card cursor-grab active:cursor-grabbing transition-all hover:shadow-md hover:border-primary/40 hover:-translate-y-0.5",
        isDragging && "opacity-30 scale-95"
      )}
      {...listeners}
      {...attributes}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 mt-0.5 transition-colors" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-semibold truncate">{reserva.nombre || "Sin nombre"}</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onBlacklist(reserva); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10"
              title="Añadir a lista negra"
            >
              <ShieldBan className="h-3.5 w-3.5 text-destructive" />
            </button>
            <Badge className={cn("text-[10px] px-1.5 py-0 border", estadoInfo.bg)}>
              {estadoInfo.label}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {typeof reserva.hora === "string" ? reserva.hora.substring(0, 5) : reserva.hora}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {reserva.numero_comensales} pax
          </span>
        </div>
        {(reserva.telefono || reserva.email) && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
            {reserva.telefono && (
              <span className="flex items-center gap-1 truncate">
                <Phone className="h-2.5 w-2.5" />
                {reserva.telefono}
              </span>
            )}
            {reserva.email && (
              <span className="flex items-center gap-1 truncate">
                <Mail className="h-2.5 w-2.5" />
                {reserva.email}
              </span>
            )}
          </div>
        )}
        {reserva.notas && (
          <p className="text-[11px] text-muted-foreground/60 italic truncate">
            "{reserva.notas}"
          </p>
        )}
      </div>
    </div>
  );
}

// ── Drag overlay (floating card while dragging) ──
function ReservaOverlay({ reserva }: { reserva: any }) {
  const estadoInfo = ESTADOS_RESERVA[reserva.estado] || { label: reserva.estado, color: "bg-gray-500", bg: "" };
  return (
    <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-card shadow-2xl w-[280px] ring-2 ring-primary/20">
      <GripVertical className="h-4 w-4 text-primary shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-semibold truncate">{reserva.nombre || "Sin nombre"}</span>
          <Badge className={cn("text-[10px] px-1.5 py-0 shrink-0 border", estadoInfo.bg)}>
            {estadoInfo.label}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {typeof reserva.hora === "string" ? reserva.hora.substring(0, 5) : reserva.hora}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {reserva.numero_comensales} pax
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Kanban column card (also draggable for re-assignment) ──
function KanbanCard({ reserva, onBlacklist }: { reserva: any; onBlacklist: (r: any) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: reserva.id,
    data: reserva,
  });

  const estadoInfo = ESTADOS_RESERVA[reserva.estado] || { label: reserva.estado, color: "bg-gray-500", bg: "" };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group flex items-center gap-2 px-3 py-2 rounded-lg border bg-card text-sm cursor-grab active:cursor-grabbing hover:border-primary/30 hover:shadow-sm transition-all",
        isDragging && "opacity-30 scale-95"
      )}
      {...listeners}
      {...attributes}
    >
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0 transition-colors" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate font-medium">{reserva.nombre || "Sin nombre"}</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onBlacklist(reserva); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10"
              title="Añadir a lista negra"
            >
              <ShieldBan className="h-3 w-3 text-destructive" />
            </button>
            <div className={cn("w-2 h-2 rounded-full shrink-0", estadoInfo.color)} title={estadoInfo.label} />
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          <span className="flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {typeof reserva.hora === "string" ? reserva.hora.substring(0, 5) : reserva.hora}
          </span>
          <span className="flex items-center gap-0.5">
            <Users className="h-2.5 w-2.5" />
            {reserva.numero_comensales}
          </span>
          {reserva.telefono && (
            <span className="flex items-center gap-0.5 truncate">
              <Phone className="h-2.5 w-2.5" />
              {reserva.telefono}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Droppable kanban column ──
function KanbanColumn({ espacio, reservas, searchTerm, onBlacklist }: { espacio: any; reservas: any[]; searchTerm: string; onBlacklist: (r: any) => void }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `espacio-${espacio.id}`,
  });

  const filtered = useMemo(() => {
    if (!searchTerm) return reservas;
    const t = searchTerm.toLowerCase();
    return reservas.filter((r: any) =>
      (r.nombre || "").toLowerCase().includes(t) ||
      (r.email || "").toLowerCase().includes(t) ||
      (r.telefono || "").toLowerCase().includes(t)
    );
  }, [reservas, searchTerm]);

  const totalComensales = reservas.reduce((acc: number, r: any) => acc + (r.numero_comensales || 0), 0);
  const ocupacion = espacio.capacidad_maxima > 0 ? Math.round((totalComensales / espacio.capacidad_maxima) * 100) : 0;
  const isOverCapacity = totalComensales > espacio.capacidad_maxima;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-xl border-2 transition-all min-h-[280px]",
        isOver ? "border-primary bg-primary/5 shadow-lg scale-[1.01]" : "border-border/60 bg-card/50",
        isOverCapacity && !isOver && "border-destructive/40"
      )}
    >
      <div className={cn(
        "p-3 border-b rounded-t-xl",
        isOverCapacity ? "bg-destructive/5" : "bg-muted/30"
      )}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            <h3 className="font-semibold text-sm">{espacio.nombre}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {isOverCapacity && <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
            <Badge variant={isOverCapacity ? "destructive" : "outline"} className="text-xs font-mono">
              {totalComensales}/{espacio.capacidad_maxima}
            </Badge>
          </div>
        </div>
        <Progress
          value={Math.min(ocupacion, 100)}
          className={cn("h-1.5", isOverCapacity && "[&>div]:bg-destructive")}
        />
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[11px] text-muted-foreground">
            {reservas.length} reserva{reservas.length !== 1 ? "s" : ""}
            {searchTerm && filtered.length !== reservas.length && ` · ${filtered.length} coinciden`}
          </p>
          <p className="text-[11px] text-muted-foreground font-medium">
            {ocupacion}% ocupado
          </p>
        </div>
      </div>
      <ScrollArea className="flex-1 p-2">
        <div className="space-y-1.5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
              <Users className="h-8 w-8 mb-2" />
              <p className="text-xs">
                {searchTerm ? "Sin resultados" : "Arrastra reservas aquí"}
              </p>
            </div>
          ) : (
            filtered.map((r: any) => <KanbanCard key={r.id} reserva={r} onBlacklist={onBlacklist} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Droppable sidebar (sin asignar) ──
function SidebarDropZone({ children }: { children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: "sin-asignar" });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "w-[320px] shrink-0 flex flex-col border rounded-xl bg-card transition-all",
        isOver && "border-primary bg-primary/5 shadow-lg"
      )}
    >
      {children}
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
  const [blacklistTarget, setBlacklistTarget] = useState<any>(null);
  const [blacklistMotivo, setBlacklistMotivo] = useState("");
  const [blacklistTipo, setBlacklistTipo] = useState<"email" | "telefono">("email");

  const crearBlacklist = useCrearBlacklist();

  const openBlacklistModal = (reserva: any) => {
    setBlacklistTarget(reserva);
    setBlacklistMotivo("");
    setBlacklistTipo(reserva.email ? "email" : "telefono");
  };

  const hoy = format(new Date(), "yyyy-MM-dd");
  const hoyDisplay = format(new Date(), "EEEE d 'de' MMMM", { locale: es });

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

  // Split reservations
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

  // Summary stats
  const stats = useMemo(() => {
    const total = reservasHoy?.length || 0;
    const totalPax = (reservasHoy || []).reduce((acc: number, r: any) => acc + (r.numero_comensales || 0), 0);
    const asignadas = total - sinAsignar.length;
    return { total, totalPax, asignadas, sinAsignar: sinAsignar.length };
  }, [reservasHoy, sinAsignar]);

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

  const handleDragStart = (event: DragStartEvent) => {
    const reserva = reservasHoy?.find((r: any) => r.id === event.active.id);
    setActiveReserva(reserva || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveReserva(null);
    const { active, over } = event;
    if (!over) return;

    const reservaId = active.id as string;
    const targetId = over.id as string;

    const reserva = reservasHoy?.find((r: any) => r.id === reservaId);
    if (!reserva) return;

    // Dropping back to "sin asignar"
    if (targetId === "sin-asignar") {
      if (!reserva.sala_id) return;
      try {
        const { error } = await supabase
          .from("reservas")
          .update({ sala_id: null, estado: "pendiente" })
          .eq("id", reservaId);
        if (error) throw error;
        toast.success("Reserva desasignada → Pendiente");
        invalidateAll();
      } catch (err: any) {
        toast.error("Error: " + err.message);
      }
      return;
    }

    // Dropping onto a space column
    const espacioId = targetId.replace("espacio-", "");
    if (!(espacios || []).some((e: any) => e.id === espacioId)) return;
    if (reserva.sala_id === espacioId) return;

    try {
      const { error } = await supabase
        .from("reservas")
        .update({ sala_id: espacioId, estado: "confirmada" })
        .eq("id", reservaId);
      if (error) throw error;

      const espacioNombre = (espacios || []).find((e: any) => e.id === espacioId)?.nombre || "espacio";
      toast.success(`Reserva asignada a ${espacioNombre} → Confirmada`);
      invalidateAll();
    } catch (err: any) {
      toast.error("Error al asignar: " + err.message);
    }
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["reservas-hoy-gestion"] });
    queryClient.invalidateQueries({ queryKey: ["reservas-hoy"] });
    queryClient.invalidateQueries({ queryKey: ["ocupacion_hoy"] });
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/reservas")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Gestión de Salas</h2>
              <p className="text-muted-foreground text-sm capitalize">{hoyDisplay}</p>
            </div>
          </div>

          {/* Summary stats */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border">
              <CalendarCheck className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{stats.total} reservas</span>
              <span className="text-xs text-muted-foreground">· {stats.totalPax} pax</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-200">
              <MapPin className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-700">{stats.asignadas} asignadas</span>
            </div>
            {stats.sinAsignar > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-200">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <span className="text-sm font-medium text-yellow-700">{stats.sinAsignar} pendientes</span>
              </div>
            )}
          </div>
        </div>

        {/* Global search bar */}
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar reservas (nombre, email, teléfono)..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 h-[calc(100vh-280px)]">
            {/* ── Left sidebar: unassigned reservations (droppable) ── */}
            <SidebarDropZone>
              <div className="p-3 border-b space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Sin asignar</h3>
                  <Badge variant="secondary" className="text-xs">
                    {sinAsignar.length}
                  </Badge>
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
                <div className="space-y-2">
                  {reservasFiltradas.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50">
                      <CalendarCheck className="h-10 w-10 mb-3" />
                      <p className="text-sm font-medium">Todo asignado</p>
                      <p className="text-xs mt-1">No hay reservas sin asignar</p>
                    </div>
                  ) : (
                    reservasFiltradas.map((r) => (
                      <ReservaCardDraggable key={r.id} reserva={r} onBlacklist={openBlacklistModal} />
                    ))
                  )}
                </div>
              </ScrollArea>
            </SidebarDropZone>

            {/* ── Right: Kanban columns ── */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-min overflow-y-auto">
              {(espacios || []).map((espacio: any) => (
                <KanbanColumn
                  key={espacio.id}
                  espacio={espacio}
                  reservas={porEspacio[espacio.id] || []}
                  searchTerm={busqueda}
                  onBlacklist={openBlacklistModal}
                />
              ))}
            </div>
          </div>

          <DragOverlay>
            {activeReserva ? <ReservaOverlay reserva={activeReserva} /> : null}
          </DragOverlay>
        </DndContext>
        {/* ── Blacklist Modal ── */}
        <Dialog open={!!blacklistTarget} onOpenChange={(open) => { if (!open) { setBlacklistTarget(null); setBlacklistMotivo(""); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldBan className="h-5 w-5 text-destructive" />
                Añadir a Lista Negra
              </DialogTitle>
              <DialogDescription>
                Esta persona no podrá realizar futuras reservas.
              </DialogDescription>
            </DialogHeader>

            {blacklistTarget && (
              <div className="space-y-4">
                {/* Info de la reserva */}
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                  <p className="text-sm font-semibold">{blacklistTarget.nombre || "Sin nombre"}</p>
                  {blacklistTarget.email && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Mail className="h-3 w-3" /> {blacklistTarget.email}
                    </p>
                  )}
                  {blacklistTarget.telefono && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Phone className="h-3 w-3" /> {blacklistTarget.telefono}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    {typeof blacklistTarget.hora === "string" ? blacklistTarget.hora.substring(0, 5) : blacklistTarget.hora}
                    {" · "}
                    <Users className="h-3 w-3" /> {blacklistTarget.numero_comensales} pax
                  </p>
                </div>

                {/* Tipo de bloqueo */}
                <div className="space-y-2">
                  <Label className="text-sm">Bloquear por</Label>
                  <Select value={blacklistTipo} onValueChange={(v) => setBlacklistTipo(v as "email" | "telefono")}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {blacklistTarget.email && <SelectItem value="email">Email: {blacklistTarget.email}</SelectItem>}
                      {blacklistTarget.telefono && <SelectItem value="telefono">Teléfono: {blacklistTarget.telefono}</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>

                {/* Motivo */}
                <div className="space-y-2">
                  <Label className="text-sm">Motivo del bloqueo</Label>
                  <Textarea
                    placeholder="Describe el motivo por el cual esta persona será bloqueada..."
                    value={blacklistMotivo}
                    onChange={(e) => setBlacklistMotivo(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => { setBlacklistTarget(null); setBlacklistMotivo(""); }}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                disabled={!blacklistMotivo.trim() || crearBlacklist.isPending}
                onClick={async () => {
                  if (!blacklistTarget) return;
                  const valor = blacklistTipo === "email" ? blacklistTarget.email : blacklistTarget.telefono;
                  if (!valor) {
                    toast.error("No hay " + blacklistTipo + " para esta reserva");
                    return;
                  }
                  await crearBlacklist.mutateAsync({
                    tipo: blacklistTipo,
                    valor,
                    nombre: blacklistTarget.nombre || null,
                    motivo: blacklistMotivo.trim(),
                  });
                  setBlacklistTarget(null);
                  setBlacklistMotivo("");
                }}
              >
                {crearBlacklist.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Añadiendo...</>
                ) : (
                  <><ShieldBan className="h-4 w-4 mr-1" /> Añadir a Lista Negra</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
