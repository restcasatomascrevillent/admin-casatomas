import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMesas, useCrearMesa, useActualizarMesa, useActualizarMesasSilent, useEliminarMesa, Mesa } from "@/hooks/useMesas";
import { usePlanoEspacio } from "@/hooks/usePlanosEspacio";
import { useAsignacionesMesa, useCrearAsignacion, useEliminarAsignacion, AsignacionConDetalles } from "@/hooks/useAsignacionesMesa";
import { useReservasHoyPorEspacio } from "@/hooks/useOcupacionHoy";
import { 
  DndContext, 
  DragEndEvent, 
  DragStartEvent,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  useDroppable,
  useDraggable
} from "@dnd-kit/core";
import { 
  Plus, 
  Trash2, 
  ArrowLeft, 
  Wand2, 
  FileDown,
  Move,
  Users,
  Clock,
  Phone,
  X,
  GripVertical,
  Utensils,
  AlertCircle,
  CheckCircle2
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PlanoEspacio2DProps {
  espacioId: string;
  espacioNombre: string;
  onBack: () => void;
  fecha?: string;
}

interface DragState {
  isDragging: boolean;
  mesaId: string | null;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
}

interface ElementoPlano {
  id: string;
  tipo: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  radius?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: Array<{ x: number; y: number }>;
  fill?: string;
  props?: Record<string, any>;
}

interface Reserva {
  id: string;
  nombre: string;
  hora: string;
  numero_comensales: number;
  estado: string;
  telefono?: string;
}

// Componente para reserva arrastrable
function DraggableReserva({ reserva, isAssigned }: { reserva: Reserva; isAssigned: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `reserva-${reserva.id}`,
    data: { type: "reserva", reserva },
    disabled: isAssigned,
  });

  const estadoColor = {
    confirmada: "bg-green-500/20 border-green-500 text-green-700",
    pendiente: "bg-yellow-500/20 border-yellow-500 text-yellow-700",
    cancelada: "bg-red-500/20 border-red-500 text-red-700",
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border-2 transition-all cursor-grab active:cursor-grabbing",
        isAssigned 
          ? "bg-muted/50 border-muted opacity-60" 
          : estadoColor[reserva.estado as keyof typeof estadoColor] || "bg-background border-border",
        isDragging && "opacity-50 scale-95",
        !isAssigned && "hover:shadow-md hover:scale-[1.02]"
      )}
    >
      <div className={cn(
        "p-2 rounded-md",
        isAssigned ? "bg-muted" : "bg-background/50"
      )}>
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm truncate">{reserva.nombre}</p>
          {isAssigned && (
            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {reserva.hora}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {reserva.numero_comensales}
          </span>
        </div>
      </div>
      <Badge 
        variant="outline" 
        className={cn(
          "text-[10px] flex-shrink-0",
          isAssigned && "bg-green-100 text-green-700 border-green-300"
        )}
      >
        {isAssigned ? "Asignada" : reserva.estado}
      </Badge>
    </div>
  );
}

// Componente para mesa con drop zone
function DroppableMesa({ 
  mesa, 
  reserva, 
  isSelected, 
  isDragging,
  onMouseDown,
  onClick,
  onRemoveAssignment,
  isDropTarget
}: { 
  mesa: Mesa; 
  reserva?: AsignacionConDetalles;
  isSelected: boolean;
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: () => void;
  onRemoveAssignment?: () => void;
  isDropTarget: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `mesa-${mesa.id}`,
    data: { type: "mesa", mesa },
  });

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            ref={setNodeRef}
            className={cn(
              "absolute cursor-move transition-all duration-200",
              "flex flex-col items-center justify-center text-center",
              "border-2 shadow-sm",
              mesa.forma === "circular" ? "rounded-full" : "rounded-lg",
              isSelected ? "border-primary ring-2 ring-primary/30 z-30" : "border-slate-300",
              isDragging ? "shadow-lg scale-105 z-50" : "",
              reserva ? "bg-primary/20 border-primary" : "bg-white",
              isOver && "ring-4 ring-green-400 border-green-500 scale-110 z-40",
              isDropTarget && !reserva && "animate-pulse border-dashed border-green-400"
            )}
            style={{
              left: mesa.pos_x,
              top: mesa.pos_y,
              width: mesa.ancho,
              height: mesa.alto,
              transform: `rotate(${mesa.rotacion}deg)`,
            }}
            onMouseDown={onMouseDown}
            onClick={onClick}
          >
            <span className="font-bold text-xs truncate w-full px-1">{mesa.nombre}</span>
            <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Users className="h-2.5 w-2.5" />
              <span>{mesa.capacidad}</span>
            </div>

            {reserva && (
              <>
                <div className="absolute -top-2 -right-2 z-10">
                  <Badge className="text-[9px] px-1.5 py-0.5 bg-primary shadow-sm">
                    {reserva.reservas.nombre?.split(" ")[0]}
                  </Badge>
                </div>
                {onRemoveAssignment && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveAssignment();
                    }}
                    className="absolute -top-1 -left-1 bg-destructive text-destructive-foreground rounded-full p-0.5 shadow-sm hover:scale-110 transition-transform z-10"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-semibold">{mesa.nombre}</p>
            <p className="text-xs">Capacidad: {mesa.capacidad} personas</p>
            {reserva && (
              <div className="pt-1 border-t border-border mt-1">
                <p className="text-xs font-medium">{reserva.reservas.nombre}</p>
                <p className="text-xs text-muted-foreground">
                  {reserva.reservas.hora} · {reserva.reservas.numero_comensales} pax
                </p>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function PlanoEspacio2D({ espacioId, espacioNombre, onBack, fecha }: PlanoEspacio2DProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedMesa, setSelectedMesa] = useState<Mesa | null>(null);
  const [showAddMesa, setShowAddMesa] = useState(false);
  const [localMesas, setLocalMesas] = useState<Mesa[]>([]);
  const [activeReserva, setActiveReserva] = useState<Reserva | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 500 });
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    mesaId: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const [newMesa, setNewMesa] = useState({
    nombre: "",
    capacidad: 4,
    forma: "rectangular",
    ancho: 80,
    alto: 80,
  });

  const fechaActual = fecha || new Date().toISOString().split("T")[0];

  const { data: mesas, isLoading: loadingMesas } = useMesas(espacioId);
  const { data: plano } = usePlanoEspacio(espacioId);
  const { data: asignaciones, refetch: refetchAsignaciones } = useAsignacionesMesa(fechaActual, espacioId);
  const { data: reservasHoy } = useReservasHoyPorEspacio(espacioId);

  const crearMesa = useCrearMesa();
  const actualizarMesasSilent = useActualizarMesasSilent();
  const eliminarMesa = useEliminarMesa();
  const crearAsignacion = useCrearAsignacion();
  const eliminarAsignacion = useEliminarAsignacion();

  // Sensors para dnd-kit
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Obtener dimensiones y escala del plano guardado
  const PIXELS_PER_METER = plano?.pixels_per_meter || 50;
  const realWidth = plano?.ancho_metros || 12;
  const realHeight = plano?.alto_metros || 8;
  
  // Canvas lógico basado en las dimensiones reales del plano
  const canvasWidth = realWidth * PIXELS_PER_METER;
  const canvasHeight = realHeight * PIXELS_PER_METER;
  
  const elementosPlano: ElementoPlano[] = plano?.configuracion?.elementos || [];

  // Medir el contenedor para escalar responsivamente
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Calcular escala para ajustar el canvas al contenedor
  const scale = Math.min(
    (containerSize.width - 32) / canvasWidth,
    (containerSize.height - 32) / canvasHeight,
    1 // No escalar más grande que el original
  );

  // Sincronizar mesas locales con datos del servidor
  useEffect(() => {
    if (mesas) {
      setLocalMesas(mesas);
    }
  }, [mesas]);

  // Verificar si una reserva está asignada
  const isReservaAsignada = useCallback((reservaId: string): boolean => {
    return asignaciones?.some((a) => a.reserva_id === reservaId) || false;
  }, [asignaciones]);

  // Obtener reserva asignada a una mesa
  const getReservaAsignada = useCallback((mesaId: string): AsignacionConDetalles | undefined => {
    return asignaciones?.find((a) => a.mesa_id === mesaId);
  }, [asignaciones]);

  // Handlers para drag & drop de reservas
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    if (active.data.current?.type === "reserva") {
      setActiveReserva(active.data.current.reserva);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveReserva(null);

    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    if (activeData?.type === "reserva" && overData?.type === "mesa") {
      const reserva = activeData.reserva as Reserva;
      const mesa = overData.mesa as Mesa;

      // Verificar capacidad
      if (reserva.numero_comensales > mesa.capacidad) {
        toast.warning(`La mesa ${mesa.nombre} solo tiene capacidad para ${mesa.capacidad} personas`);
        return;
      }

      // Verificar si la mesa ya tiene asignación
      const asignacionExistente = getReservaAsignada(mesa.id);
      if (asignacionExistente) {
        toast.error(`La mesa ${mesa.nombre} ya tiene una reserva asignada`);
        return;
      }

      try {
        await crearAsignacion.mutateAsync({
          reserva_id: reserva.id,
          mesa_id: mesa.id,
        });
        toast.success(`${reserva.nombre} asignado a ${mesa.nombre}`);
        refetchAsignaciones();
      } catch (error) {
        console.error("Error al asignar:", error);
      }
    }
  };

  // Handlers de arrastre de mesas
  const handleMouseDown = useCallback((e: React.MouseEvent, mesa: Mesa) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDragState({
      isDragging: true,
      mesaId: mesa.id,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: mesa.pos_x,
      offsetY: mesa.pos_y,
    });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.isDragging || !dragState.mesaId) return;

    // Delta en píxeles de pantalla, convertido a metros considerando la escala
    const deltaX = (e.clientX - dragState.startX) / (PIXELS_PER_METER * scale);
    const deltaY = (e.clientY - dragState.startY) / (PIXELS_PER_METER * scale);

    setLocalMesas((prev) =>
      prev.map((m) =>
        m.id === dragState.mesaId
          ? {
              ...m,
              pos_x: Math.max(0, Math.min(realWidth - (m.ancho || 80) / 100, dragState.offsetX + deltaX)),
              pos_y: Math.max(0, Math.min(realHeight - (m.alto || 80) / 100, dragState.offsetY + deltaY)),
            }
          : m
      )
    );
  }, [dragState, PIXELS_PER_METER, scale, realWidth, realHeight]);

  const handleMouseUp = useCallback(() => {
    if (dragState.isDragging && dragState.mesaId) {
      const mesa = localMesas.find((m) => m.id === dragState.mesaId);
      if (mesa) {
        actualizarMesasSilent.mutate([{ id: mesa.id, pos_x: mesa.pos_x, pos_y: mesa.pos_y }]);
      }
    }
    setDragState({ isDragging: false, mesaId: null, startX: 0, startY: 0, offsetX: 0, offsetY: 0 });
  }, [dragState, localMesas, actualizarMesasSilent]);

  const handleRemoveAssignment = async (asignacionId: string) => {
    try {
      await eliminarAsignacion.mutateAsync(asignacionId);
      toast.success("Asignación eliminada");
      refetchAsignaciones();
    } catch (error) {
      console.error("Error al eliminar asignación:", error);
    }
  };

  const handleAddMesa = async () => {
    if (!newMesa.nombre.trim()) {
      toast.error("Introduce un nombre para la mesa");
      return;
    }

    await crearMesa.mutateAsync({
      espacio_id: espacioId,
      nombre: newMesa.nombre,
      capacidad: newMesa.capacidad,
      forma: newMesa.forma,
      ancho: newMesa.ancho,
      alto: newMesa.alto,
      pos_x: 50,
      pos_y: 50,
    });

    setNewMesa({ nombre: "", capacidad: 4, forma: "rectangular", ancho: 80, alto: 80 });
    setShowAddMesa(false);
  };

  const handleDeleteMesa = async (id: string) => {
    await eliminarMesa.mutateAsync(id);
    setSelectedMesa(null);
  };

  const handleExportPDF = async () => {
    toast.info("Preparando PDF...");
    try {
      const { default: html2canvas } = await import("html2canvas");
      const { default: jsPDF } = await import("jspdf");

      if (!canvasRef.current) return;

      const canvas = await html2canvas(canvasRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      pdf.setFontSize(18);
      pdf.text(`${espacioNombre} - ${new Date(fechaActual).toLocaleDateString("es-ES")}`, 14, 15);

      const imgWidth = pdfWidth - 28;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      pdf.addImage(imgData, "PNG", 14, 25, imgWidth, Math.min(imgHeight, pdfHeight - 40));

      pdf.save(`plano-${espacioNombre}-${fechaActual}.pdf`);
      toast.success("PDF exportado correctamente");
    } catch (error) {
      console.error("Error al exportar PDF:", error);
      toast.error("Error al exportar PDF");
    }
  };

  const handleCalcularDistribucion = async () => {
    toast.info("Calculando distribución óptima con IA...");
    
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calcular-distribucion-mesas`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            espacioId,
            fecha: fechaActual,
            mesas: localMesas,
            reservas: reservasHoy,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Error en la respuesta del servidor");
      }

      const result = await response.json();
      
      if (result.asignaciones) {
        toast.success(`${result.asignaciones.length} mesas asignadas automáticamente`);
        refetchAsignaciones();
      }
    } catch (error) {
      console.error("Error al calcular distribución:", error);
      toast.error("Error al calcular distribución. Verifica que el servicio esté disponible.");
    }
  };

  // Renderizar elemento del plano
  const renderElementoPlano = (elem: ElementoPlano) => {
    const baseStyle: React.CSSProperties = {
      position: "absolute",
      pointerEvents: "none",
    };

    // Las propiedades pueden estar en elem directamente o en elem.props
    const props = elem.props || elem;

    switch (elem.tipo) {
      case "wall":
        const x1 = props.x1;
        const y1 = props.y1;
        const x2 = props.x2;
        const y2 = props.y2;
        
        if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
          const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
          const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
          return (
            <div
              key={elem.id}
              style={{
                ...baseStyle,
                left: x1 * scale,
                top: y1 * scale,
                width: length * scale,
                height: 6 * scale,
                backgroundColor: "#374151",
                transform: `rotate(${angle}deg)`,
                transformOrigin: "0 50%",
              }}
            />
          );
        }
        return null;

      case "rectangle":
      case "area":
        const rectLeft = (props.left || elem.left || 0) * scale;
        const rectTop = (props.top || elem.top || 0) * scale;
        const rectWidth = (props.width || elem.width || 100) * scale;
        const rectHeight = (props.height || elem.height || 100) * scale;
        return (
          <div
            key={elem.id}
            style={{
              ...baseStyle,
              left: rectLeft,
              top: rectTop,
              width: rectWidth,
              height: rectHeight,
              backgroundColor: props.fill || elem.fill || "rgba(226, 232, 240, 0.5)",
              border: `${2 * scale}px solid #64748b`,
              borderRadius: 4 * scale,
            }}
          />
        );

      case "circle":
        const circleLeft = (props.left || elem.left || 0) * scale;
        const circleTop = (props.top || elem.top || 0) * scale;
        const radius = (props.radius || elem.radius || 30) * scale;
        return (
          <div
            key={elem.id}
            style={{
              ...baseStyle,
              left: circleLeft,
              top: circleTop,
              width: radius * 2,
              height: radius * 2,
              backgroundColor: props.fill || elem.fill || "#e2e8f0",
              border: `${2 * scale}px solid #64748b`,
              borderRadius: "50%",
            }}
          />
        );

      case "door":
        const doorLeft = (props.left || elem.left || 0) * scale;
        const doorTop = (props.top || elem.top || 0) * scale;
        const doorWidth = (props.width || elem.width || 70) * scale;
        const doorHeight = (props.height || elem.height || 12) * scale;
        return (
          <div
            key={elem.id}
            style={{
              ...baseStyle,
              left: doorLeft,
              top: doorTop,
              width: doorWidth,
              height: doorHeight,
              backgroundColor: "#fef3c7",
              border: `${2 * scale}px solid #d97706`,
              borderRadius: 2 * scale,
            }}
          />
        );

      case "silla":
        const sillaLeft = (props.left || elem.left || 0) * scale;
        const sillaTop = (props.top || elem.top || 0) * scale;
        const sillaRadius = (props.radius || elem.radius || 15) * scale;
        return (
          <div
            key={elem.id}
            style={{
              ...baseStyle,
              left: sillaLeft,
              top: sillaTop,
              width: sillaRadius * 2,
              height: sillaRadius * 2,
              backgroundColor: "#fde68a",
              border: `${2 * scale}px solid #d97706`,
              borderRadius: "50%",
            }}
          />
        );

      case "elemento":
        const elemLeft = (props.left || elem.left || 0) * scale;
        const elemTop = (props.top || elem.top || 0) * scale;
        const elemWidth = (props.width || elem.width || 40) * scale;
        const elemHeight = (props.height || elem.height || 40) * scale;
        return (
          <div
            key={elem.id}
            style={{
              ...baseStyle,
              left: elemLeft,
              top: elemTop,
              width: elemWidth,
              height: elemHeight,
              backgroundColor: "#94a3b8",
              border: `${1 * scale}px solid #475569`,
              borderRadius: 4 * scale,
            }}
          />
        );

      case "polygon":
        const polyLeft = (props.left || elem.left || 0) * scale;
        const polyTop = (props.top || elem.top || 0) * scale;
        return (
          <div
            key={elem.id}
            style={{
              ...baseStyle,
              left: polyLeft,
              top: polyTop,
              width: 60 * scale,
              height: 60 * scale,
              clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
              backgroundColor: props.fill || elem.fill || "#e2e8f0",
            }}
          />
        );

      default:
        return null;
    }
  };

  // Estadísticas
  const reservasPendientes = reservasHoy?.filter((r: any) => !isReservaAsignada(r.id)) || [];
  const reservasAsignadas = reservasHoy?.filter((r: any) => isReservaAsignada(r.id)) || [];
  const mesasOcupadas = asignaciones?.length || 0;
  const mesasLibres = localMesas.length - mesasOcupadas;

  if (loadingMesas) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver
            </Button>
            <div>
              <h3 className="text-xl font-bold">{espacioNombre}</h3>
              <p className="text-sm text-muted-foreground">
                {new Date(fechaActual).toLocaleDateString("es-ES", { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </p>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setShowAddMesa(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Mesa
            </Button>
            <Button variant="outline" size="sm" onClick={handleCalcularDistribucion}>
              <Wand2 className="mr-2 h-4 w-4" />
              Auto-asignar
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF}>
              <FileDown className="mr-2 h-4 w-4" />
              PDF
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-md bg-blue-100">
                <Utensils className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Mesas</p>
                <p className="text-lg font-bold">{localMesas.length}</p>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-md bg-green-100">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Mesas Ocupadas</p>
                <p className="text-lg font-bold">{mesasOcupadas}</p>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-md bg-yellow-100">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Por Asignar</p>
                <p className="text-lg font-bold">{reservasPendientes.length}</p>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-md bg-primary/10">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Comensales</p>
                <p className="text-lg font-bold">
                  {reservasHoy?.reduce((acc: number, r: any) => acc + (r.numero_comensales || 0), 0) || 0}
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Main content */}
        <div className="grid gap-4 lg:grid-cols-[1fr_350px]">
          {/* Canvas del plano */}
          <Card className="overflow-hidden">
            <CardContent className="p-4">
              <div 
                ref={containerRef}
                className="relative w-full h-[500px] flex items-center justify-center bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden"
              >
                <div
                  ref={canvasRef}
                  className="relative bg-white dark:bg-slate-900 border border-border rounded-lg shadow-inner overflow-hidden"
                  style={{ 
                    width: canvasWidth * scale, 
                    height: canvasHeight * scale,
                    transform: `scale(1)`,
                  }}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  {/* Grid de fondo - escala según pixelsPerMeter */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      backgroundImage: `
                        linear-gradient(to right, hsl(var(--border) / 0.5) 1px, transparent 1px),
                        linear-gradient(to bottom, hsl(var(--border) / 0.5) 1px, transparent 1px)
                      `,
                      backgroundSize: `${PIXELS_PER_METER * scale}px ${PIXELS_PER_METER * scale}px`,
                    }}
                  />

                  {/* Elementos del plano (paredes, decoración, etc.) */}
                  {elementosPlano.map((elem) => renderElementoPlano(elem))}

                  {/* Mesas - posicionadas según pos_x/pos_y en metros */}
                  {localMesas.map((mesa) => {
                    const reserva = getReservaAsignada(mesa.id);
                    const isSelected = selectedMesa?.id === mesa.id;
                    const isDragging = dragState.mesaId === mesa.id;
                    
                    // Convertir posición de metros a píxeles y aplicar escala
                    const posXPixels = (mesa.pos_x || 0) * PIXELS_PER_METER * scale;
                    const posYPixels = (mesa.pos_y || 0) * PIXELS_PER_METER * scale;
                    // Dimensiones en cm convertidas a píxeles y escaladas
                    const anchoPixels = ((mesa.ancho || 80) / 100) * PIXELS_PER_METER * scale;
                    const altoPixels = ((mesa.alto || 80) / 100) * PIXELS_PER_METER * scale;

                    return (
                      <DroppableMesa
                        key={mesa.id}
                        mesa={{
                          ...mesa,
                          pos_x: posXPixels,
                          pos_y: posYPixels,
                          ancho: anchoPixels,
                          alto: altoPixels,
                        }}
                        reserva={reserva}
                        isSelected={isSelected}
                        isDragging={isDragging}
                        onMouseDown={(e) => handleMouseDown(e, mesa)}
                        onClick={() => setSelectedMesa(mesa)}
                        onRemoveAssignment={reserva ? () => handleRemoveAssignment(reserva.id) : undefined}
                        isDropTarget={!!activeReserva}
                      />
                    );
                  })}

                  {/* Mensaje si no hay mesas */}
                  {localMesas.length === 0 && elementosPlano.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <div className="text-center">
                        <Move className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>No hay configuración de plano</p>
                        <p className="text-sm">Configura el plano desde la sección Espacios</p>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Indicador de dimensiones */}
                <div className="absolute bottom-2 left-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
                  {realWidth}m × {realHeight}m
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Panel lateral */}
          <div className="space-y-4">
            {/* Mesa seleccionada */}
            {selectedMesa && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{selectedMesa.nombre}</CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setSelectedMesa(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Capacidad</p>
                      <p className="font-medium">{selectedMesa.capacidad} pax</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Forma</p>
                      <p className="font-medium capitalize">{selectedMesa.forma}</p>
                    </div>
                  </div>

                  {getReservaAsignada(selectedMesa.id) && (
                    <div className="p-3 bg-primary/10 rounded-lg">
                      <p className="font-medium text-sm mb-2">Reserva Asignada</p>
                      <div className="text-sm space-y-1">
                        <p className="font-semibold">{getReservaAsignada(selectedMesa.id)?.reservas.nombre}</p>
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {getReservaAsignada(selectedMesa.id)?.reservas.hora}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {getReservaAsignada(selectedMesa.id)?.reservas.numero_comensales}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={() => handleDeleteMesa(selectedMesa.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Eliminar Mesa
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Reservas */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Utensils className="h-5 w-5" />
                  Reservas de Hoy
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!reservasHoy?.length ? (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    No hay reservas para hoy
                  </p>
                ) : (
                  <ScrollArea className="h-[400px] pr-4">
                    <div className="space-y-2">
                      {/* Pendientes primero */}
                      {reservasPendientes.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                            Por asignar ({reservasPendientes.length})
                          </p>
                          <div className="space-y-2">
                            {reservasPendientes.map((r: any) => (
                              <DraggableReserva
                                key={r.id}
                                reserva={r}
                                isAssigned={false}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Asignadas */}
                      {reservasAsignadas.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                            Asignadas ({reservasAsignadas.length})
                          </p>
                          <div className="space-y-2">
                            {reservasAsignadas.map((r: any) => (
                              <DraggableReserva
                                key={r.id}
                                reserva={r}
                                isAssigned={true}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activeReserva && (
            <div className="flex items-center gap-3 p-3 rounded-lg border-2 border-primary bg-background shadow-xl">
              <Users className="h-4 w-4 text-primary" />
              <div>
                <p className="font-semibold text-sm">{activeReserva.nombre}</p>
                <p className="text-xs text-muted-foreground">
                  {activeReserva.hora} · {activeReserva.numero_comensales} pax
                </p>
              </div>
            </div>
          )}
        </DragOverlay>

        {/* Dialog para añadir mesa */}
        <Dialog open={showAddMesa} onOpenChange={setShowAddMesa}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Añadir Nueva Mesa</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nombre</Label>
                <Input
                  value={newMesa.nombre}
                  onChange={(e) => setNewMesa({ ...newMesa, nombre: e.target.value })}
                  placeholder="Ej: Mesa 1, Terraza A..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Capacidad</Label>
                  <Input
                    type="number"
                    value={newMesa.capacidad}
                    onChange={(e) => setNewMesa({ ...newMesa, capacidad: parseInt(e.target.value) || 4 })}
                    min={1}
                    max={20}
                  />
                </div>
                <div>
                  <Label>Forma</Label>
                  <Select
                    value={newMesa.forma}
                    onValueChange={(v) => setNewMesa({ ...newMesa, forma: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rectangular">Rectangular</SelectItem>
                      <SelectItem value="circular">Circular</SelectItem>
                      <SelectItem value="cuadrada">Cuadrada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Ancho (px)</Label>
                  <Input
                    type="number"
                    value={newMesa.ancho}
                    onChange={(e) => setNewMesa({ ...newMesa, ancho: parseInt(e.target.value) || 100 })}
                    min={50}
                    max={300}
                  />
                </div>
                <div>
                  <Label>Alto (px)</Label>
                  <Input
                    type="number"
                    value={newMesa.alto}
                    onChange={(e) => setNewMesa({ ...newMesa, alto: parseInt(e.target.value) || 80 })}
                    min={50}
                    max={300}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowAddMesa(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleAddMesa} disabled={crearMesa.isPending}>
                  <Plus className="mr-2 h-4 w-4" />
                  Crear Mesa
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DndContext>
  );
}
