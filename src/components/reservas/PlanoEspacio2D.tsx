import { useState, useRef, useCallback, useEffect, useMemo } from "react";
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
  DragOverEvent,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useDraggable,
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
  CheckCircle2,
  ZoomIn,
  ZoomOut,
  Maximize2
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

// Componente para reserva arrastrable y clickeable
function DraggableReserva({ 
  reserva, 
  isAssigned,
  isSelectedForClick,
  onClickSelect,
}: { 
  reserva: Reserva; 
  isAssigned: boolean;
  isSelectedForClick?: boolean;
  onClickSelect?: (reserva: Reserva) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `reserva-${reserva.id}`,
    data: { type: "reserva", reserva },
    disabled: isAssigned,
  });

  const estadoColor = {
    confirmada: "bg-green-500/20 border-green-500 text-green-700 dark:text-green-400",
    pendiente: "bg-yellow-500/20 border-yellow-500 text-yellow-700 dark:text-yellow-400",
    cancelada: "bg-red-500/20 border-red-500 text-red-700 dark:text-red-400",
  };

  const handleClick = (e: React.MouseEvent) => {
    // Solo activar click si no es drag
    if (!isDragging && !isAssigned && onClickSelect) {
      e.stopPropagation();
      onClickSelect(reserva);
    }
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={handleClick}
      className={cn(
        "group flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg border-2 transition-all duration-200",
        isAssigned 
          ? "bg-muted/50 border-muted opacity-60 cursor-not-allowed" 
          : estadoColor[reserva.estado as keyof typeof estadoColor] || "bg-background border-border",
        isDragging && "opacity-30 scale-95 shadow-inner",
        !isAssigned && "cursor-pointer hover:shadow-lg hover:border-primary hover:bg-accent/40 hover:scale-[1.02]",
        isSelectedForClick && "ring-4 ring-primary border-primary bg-primary/20 scale-[1.03] shadow-xl"
      )}
      style={{
        touchAction: isAssigned ? 'auto' : 'none',
      }}
    >
      <div className={cn(
        "p-1.5 sm:p-2 rounded-md flex-shrink-0 transition-all duration-200",
        isAssigned ? "bg-muted" : "bg-background/50 group-hover:bg-primary/20 group-hover:scale-110",
        isSelectedForClick && "bg-primary/30"
      )}>
        <GripVertical className={cn(
          "h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground transition-colors",
          !isAssigned && "group-hover:text-primary",
          isSelectedForClick && "text-primary"
        )} />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <p className="font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">{reserva.nombre}</p>
          {isAssigned && (
            <CheckCircle2 className="h-3 w-3 sm:h-4 sm:w-4 text-green-500 flex-shrink-0" />
          )}
          {isSelectedForClick && (
            <Badge className="bg-primary text-primary-foreground text-[8px] px-1 py-0">
              Seleccionada
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
          <span className="flex items-center gap-0.5 sm:gap-1">
            <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
            {reserva.hora}
          </span>
          <span className="flex items-center gap-0.5 sm:gap-1">
            <Users className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
            {reserva.numero_comensales}
          </span>
        </div>
      </div>
      <Badge 
        variant="outline" 
        className={cn(
          "text-[9px] sm:text-[10px] flex-shrink-0 px-1.5 sm:px-2 transition-colors",
          isAssigned && "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700"
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
  mesaOriginal,
  reserva, 
  isSelected, 
  isDragging,
  onDragStart,
  onClick,
  onRemoveAssignment,
  isDropTarget,
  draggingReserva,
  selectedReservaForClick,
  onClickAssign,
  scale,
}: { 
  mesa: Mesa; // Mesa con coordenadas en píxeles para render
  mesaOriginal: Mesa; // Mesa con datos originales para callbacks
  reserva?: AsignacionConDetalles;
  isSelected: boolean;
  isDragging: boolean;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, mesa: Mesa) => void;
  onClick: () => void;
  onRemoveAssignment?: () => void;
  isDropTarget: boolean;
  draggingReserva?: Reserva | null;
  selectedReservaForClick?: Reserva | null;
  onClickAssign?: (mesa: Mesa) => void;
  scale: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `mesa-${mesa.id}`,
    data: { type: "mesa", mesa: mesaOriginal },
  });

  // Calcular tamaño de fuente dinámico basado en dimensiones de la mesa
  const minDimension = Math.min(mesa.ancho || 60, mesa.alto || 60);
  const fontSize = Math.max(9, Math.min(14, minDimension * 0.18));
  const iconSize = Math.max(8, Math.min(12, minDimension * 0.12));

  // Usar reserva seleccionada por click O por drag
  const activeReservaForCompatibility = draggingReserva || selectedReservaForClick;

  // Lógica de compatibilidad
  const getCompatibility = () => {
    if (!activeReservaForCompatibility || reserva) return null;
    
    const comensales = activeReservaForCompatibility.numero_comensales;
    const capacidad = mesaOriginal.capacidad;
    
    if (comensales > capacidad) {
      return { type: 'incompatible', message: 'No cabe', icon: '✗' };
    } else if (comensales === capacidad) {
      return { type: 'perfect', message: '¡Perfecta!', icon: '✓' };
    } else if (comensales >= capacidad - 1) {
      return { type: 'good', message: 'Buena', icon: '○' };
    } else {
      return { type: 'oversized', message: 'Grande', icon: '+' };
    }
  };

  const compatibility = getCompatibility();
  const canAcceptClick = selectedReservaForClick && !reserva && compatibility?.type !== 'incompatible';

  // Escala de ampliación cuando está en hover durante drag - más grande para mesas pequeñas
  const baseScale = minDimension < 40 ? 1.6 : minDimension < 60 ? 1.4 : 1.2;
  const hoverScale = isOver && compatibility?.type !== 'incompatible' ? baseScale : 1;
  const hoverZIndex = isOver ? 100 : (isDragging ? 60 : isSelected ? 30 : 10);

  // Área de detección extendida para mesas pequeñas
  const minHitArea = 50 * scale;
  const mesaWidth = mesa.ancho || 60;
  const mesaHeight = mesa.alto || 60;
  const hitAreaPadding = Math.max(8, (minHitArea - Math.min(mesaWidth, mesaHeight)) / 2);

  const getCompatibilityStyles = () => {
    if (!compatibility) return '';
    switch (compatibility.type) {
      case 'incompatible':
        return 'ring-2 ring-red-400 border-red-400 opacity-40 grayscale';
      case 'perfect':
        return 'ring-4 ring-green-400 border-green-500 bg-green-100 dark:bg-green-900/40 shadow-xl shadow-green-500/30';
      case 'good':
        return 'ring-3 ring-blue-400 border-blue-400 bg-blue-50 dark:bg-blue-900/30 shadow-lg shadow-blue-500/20';
      case 'oversized':
        return 'ring-2 ring-yellow-400 border-yellow-400 opacity-80 bg-yellow-50 dark:bg-yellow-900/20';
      default:
        return '';
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Si hay reserva seleccionada para asignar, hacer click
    if (canAcceptClick && onClickAssign) {
      e.preventDefault();
      e.stopPropagation();
      onClickAssign(mesaOriginal);
      return;
    }
    
    // Sino, iniciar drag
    e.preventDefault();
    e.stopPropagation();
    onDragStart(e, mesaOriginal);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (canAcceptClick && onClickAssign) {
      e.preventDefault();
      e.stopPropagation();
      onClickAssign(mesaOriginal);
      return;
    }
    
    e.stopPropagation();
    onDragStart(e, mesaOriginal);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isDragging) {
      onClick();
    }
  };

  return (
    <div
      ref={setNodeRef}
      className="absolute"
      style={{
        left: (mesa.pos_x || 0) - hitAreaPadding,
        top: (mesa.pos_y || 0) - hitAreaPadding,
        width: mesaWidth + hitAreaPadding * 2,
        height: mesaHeight + hitAreaPadding * 2,
        zIndex: hoverZIndex,
        touchAction: 'none',
      }}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                "absolute flex flex-col items-center justify-center text-center select-none",
                "border-2 shadow-sm",
                mesa.forma === "circular" ? "rounded-full" : "rounded-lg",
                isSelected && "border-primary ring-2 ring-primary/30",
                !isSelected && !isDragging && "border-slate-300 dark:border-slate-600",
                isDragging && "shadow-2xl border-primary ring-4 ring-primary/40 opacity-90",
                reserva ? "bg-primary/20 border-primary" : "bg-white dark:bg-slate-800",
                isOver && compatibility?.type !== 'incompatible' && "ring-4 ring-green-400 border-green-500 shadow-2xl shadow-green-500/40",
                isOver && compatibility?.type === 'incompatible' && "ring-4 ring-red-400 border-red-500 opacity-50",
                isDropTarget && !reserva && "border-dashed",
                activeReservaForCompatibility && !reserva && getCompatibilityStyles(),
                canAcceptClick ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
              )}
              style={{
                left: hitAreaPadding,
                top: hitAreaPadding,
                width: mesaWidth,
                height: mesaHeight,
                transform: `rotate(${mesa.rotacion || 0}deg) scale(${hoverScale})`,
                transformOrigin: 'center center',
                padding: Math.max(2, minDimension * 0.05),
                transition: isDragging 
                  ? 'box-shadow 100ms ease' 
                  : 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 200ms ease',
              }}
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              onClick={handleClick}
            >
              <span 
                className="font-bold leading-tight text-center break-words pointer-events-none"
                style={{ 
                  fontSize: `${fontSize}px`,
                  maxWidth: '100%',
                  wordBreak: 'break-word',
                  lineHeight: 1.1,
                }}
              >
                {mesaOriginal.nombre}
              </span>
              <div 
                className="flex items-center gap-0.5 text-muted-foreground pointer-events-none"
                style={{ fontSize: `${iconSize}px`, marginTop: 1 }}
              >
                <Users style={{ width: iconSize, height: iconSize }} />
                <span>{mesaOriginal.capacidad}</span>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-1">
              <p className="font-semibold">{mesaOriginal.nombre}</p>
              <p className="text-xs">Capacidad: {mesaOriginal.capacidad} personas</p>
              {compatibility && (
                <p className={cn(
                  "text-xs font-medium",
                  compatibility.type === 'perfect' && "text-green-600",
                  compatibility.type === 'good' && "text-blue-600",
                  compatibility.type === 'oversized' && "text-yellow-600",
                  compatibility.type === 'incompatible' && "text-red-600"
                )}>
                  {compatibility.message}
                </p>
              )}
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

      {/* Indicador de compatibilidad */}
      {compatibility && !reserva && isOver && compatibility.type !== 'incompatible' && (
        <div 
          className={cn(
            "absolute left-1/2 -translate-x-1/2 px-2 py-1 rounded-lg text-xs font-bold whitespace-nowrap shadow-lg z-50 animate-in fade-in zoom-in-95 duration-150 pointer-events-none",
            compatibility.type === 'perfect' && "bg-green-500 text-white",
            compatibility.type === 'good' && "bg-blue-500 text-white",
            compatibility.type === 'oversized' && "bg-yellow-500 text-white",
          )}
          style={{
            top: -28,
          }}
        >
          {compatibility.icon} {compatibility.message}
        </div>
      )}

      {/* Tarjeta de reserva asignada */}
      {reserva && (
        <div 
          className="absolute left-1/2 -translate-x-1/2 z-20 bg-primary text-primary-foreground rounded-md shadow-lg px-2 py-1 min-w-max pointer-events-auto"
          style={{ 
            top: -28,
            maxWidth: Math.max(120, mesaWidth * 1.5),
          }}
        >
          {onRemoveAssignment && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveAssignment();
              }}
              className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 shadow-md hover:scale-110 transition-transform z-30"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
          <p className="font-semibold text-[11px] leading-tight truncate text-center pointer-events-none">
            {reserva.reservas.nombre}
          </p>
          <div className="flex items-center justify-center gap-1.5 text-[9px] opacity-90 pointer-events-none">
            <span className="flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {reserva.reservas.hora}
            </span>
            <span>·</span>
            <span className="flex items-center gap-0.5">
              <Users className="h-2.5 w-2.5" />
              {reserva.reservas.numero_comensales}
            </span>
          </div>
        </div>
      )}

      {/* Etiqueta bocadillo */}
      {mesaOriginal.etiqueta && (
        <div 
          className="absolute left-1/2 -translate-x-1/2 z-10 pointer-events-none"
          style={{ 
            top: hitAreaPadding + mesaHeight + 4,
          }}
        >
          <div 
            className="absolute left-1/2 -translate-x-1/2 -top-1 w-0 h-0"
            style={{
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderBottom: '4px solid #d97706',
            }}
          />
          <div className="bg-amber-100 border border-amber-500 rounded px-1.5 py-0.5 text-[9px] font-medium text-amber-800 whitespace-nowrap shadow-sm">
            {mesaOriginal.etiqueta}
          </div>
        </div>
      )}
    </div>
  );
}

export function PlanoEspacio2D({ espacioId, espacioNombre, onBack, fecha }: PlanoEspacio2DProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedMesa, setSelectedMesa] = useState<Mesa | null>(null);
  const [showAddMesa, setShowAddMesa] = useState(false);
  const [localMesas, setLocalMesas] = useState<Mesa[]>([]);
  const [activeReserva, setActiveReserva] = useState<Reserva | null>(null);
  const [selectedReservaForClick, setSelectedReservaForClick] = useState<Reserva | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 500 });
  const [manualZoom, setManualZoom] = useState<number | null>(null); // null = auto-zoom
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
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

  // Sensors para dnd-kit - mejorados para touch y pointer
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Más sensible
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 5,
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

  // Calcular bounding box del contenido real (paredes, elementos y mesas) - memoizado
  const contentBounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    // Incluir elementos del plano
    elementosPlano.forEach((elem) => {
      const props = elem.props || elem;
      
      if (elem.tipo === "wall" && props.x1 !== undefined) {
        minX = Math.min(minX, props.x1, props.x2);
        minY = Math.min(minY, props.y1, props.y2);
        maxX = Math.max(maxX, props.x1, props.x2);
        maxY = Math.max(maxY, props.y1, props.y2);
      } else if (props.left !== undefined && props.top !== undefined) {
        const w = props.width || props.radius * 2 || 100;
        const h = props.height || props.radius * 2 || 100;
        minX = Math.min(minX, props.left);
        minY = Math.min(minY, props.top);
        maxX = Math.max(maxX, props.left + w);
        maxY = Math.max(maxY, props.top + h);
      }
    });
    
    // Incluir mesas (convertir de metros a pixels)
    localMesas.forEach((mesa) => {
      const x = (mesa.pos_x || 0) * PIXELS_PER_METER;
      const y = (mesa.pos_y || 0) * PIXELS_PER_METER;
      const w = ((mesa.ancho || 80) / 100) * PIXELS_PER_METER;
      const h = ((mesa.alto || 80) / 100) * PIXELS_PER_METER;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    });
    
    // Si no hay contenido, usar todo el canvas
    if (minX === Infinity) {
      return { minX: 0, minY: 0, maxX: canvasWidth, maxY: canvasHeight, width: canvasWidth, height: canvasHeight };
    }
    
    // Añadir padding de exactamente 1 cuadro de grid (1 metro = PIXELS_PER_METER)
    const gridPadding = PIXELS_PER_METER;
    
    minX = Math.max(0, minX - gridPadding);
    minY = Math.max(0, minY - gridPadding);
    maxX = Math.min(canvasWidth, maxX + gridPadding);
    maxY = Math.min(canvasHeight, maxY + gridPadding);
    
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }, [elementosPlano, localMesas, PIXELS_PER_METER, canvasWidth, canvasHeight]);

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

  // Calcular escala base (auto-zoom)
  const autoScale = useMemo(() => {
    if (containerSize.width <= 0 || containerSize.height <= 0) return 1;
    if (contentBounds.width <= 0 || contentBounds.height <= 0) return 1;
    
    const padding = 32;
    const availableWidth = containerSize.width - padding;
    const availableHeight = containerSize.height - padding;
    
    return Math.min(
      availableWidth / contentBounds.width,
      availableHeight / contentBounds.height
    );
  }, [containerSize.width, containerSize.height, contentBounds.width, contentBounds.height]);

  // Usar zoom manual si está activo, sino auto-zoom
  const scale = manualZoom !== null ? manualZoom : autoScale;

  // Controles de zoom
  const handleZoomIn = useCallback(() => {
    const currentScale = manualZoom !== null ? manualZoom : autoScale;
    setManualZoom(Math.min(currentScale * 1.25, 5));
  }, [manualZoom, autoScale]);

  const handleZoomOut = useCallback(() => {
    const currentScale = manualZoom !== null ? manualZoom : autoScale;
    setManualZoom(Math.max(currentScale * 0.8, 0.2));
  }, [manualZoom, autoScale]);

  // Centrar y ajustar vista - calcula zoom óptimo para ver todo el contenido
  const handleCenterView = useCallback(() => {
    if (containerSize.width <= 0 || containerSize.height <= 0) return;
    if (contentBounds.width <= 0 || contentBounds.height <= 0) return;
    
    const padding = 48; // Padding visual en píxeles
    const availableWidth = containerSize.width - padding * 2;
    const availableHeight = containerSize.height - padding * 2;
    
    // Calcular zoom óptimo para que quepa todo el contenido
    const optimalScale = Math.min(
      availableWidth / contentBounds.width,
      availableHeight / contentBounds.height
    );
    
    // Aplicar zoom y resetear pan
    setManualZoom(optimalScale);
    setPanOffset({ x: 0, y: 0 });
  }, [containerSize, contentBounds]);

  // Zoom con rueda del ratón
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const currentScale = manualZoom !== null ? manualZoom : autoScale;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(Math.max(currentScale * delta, 0.2), 5);
    setManualZoom(newScale);
  }, [manualZoom, autoScale]);

  // Handlers para pan con Espacio + click y atajo F para centrar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignorar si el foco está en un input o textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      
      if (e.code === 'Space' && !isSpacePressed) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
      
      // Atajo F para centrar
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleCenterView();
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        setIsPanning(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSpacePressed, handleCenterView]);

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (isSpacePressed) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  }, [isSpacePressed, panOffset]);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (isPanning && isSpacePressed) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }
  }, [isPanning, isSpacePressed, panStart]);

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);
  
  // Offset para centrar el contenido
  const offsetX = contentBounds.minX;
  const offsetY = contentBounds.minY;

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

  // Handler para seleccionar reserva por click
  const handleClickSelectReserva = useCallback((reserva: Reserva) => {
    if (selectedReservaForClick?.id === reserva.id) {
      // Deseleccionar si ya está seleccionada
      setSelectedReservaForClick(null);
    } else {
      setSelectedReservaForClick(reserva);
      toast.info(`Ahora haz click en una mesa para asignar "${reserva.nombre}"`);
    }
  }, [selectedReservaForClick]);

  // Handler para asignar reserva por click en mesa
  const handleClickAssignToMesa = useCallback(async (mesa: Mesa) => {
    if (!selectedReservaForClick) return;

    // Verificar capacidad
    if (selectedReservaForClick.numero_comensales > mesa.capacidad) {
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
        reserva_id: selectedReservaForClick.id,
        mesa_id: mesa.id,
      });
      toast.success(`${selectedReservaForClick.nombre} asignado a ${mesa.nombre}`);
      setSelectedReservaForClick(null);
      refetchAsignaciones();
    } catch (error) {
      console.error("Error al asignar:", error);
    }
  }, [selectedReservaForClick, getReservaAsignada, crearAsignacion, refetchAsignaciones]);

  // Handlers de arrastre de mesas - unificado para mouse y touch
  const handleMesaDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, mesa: Mesa) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setDragState({
      isDragging: true,
      mesaId: mesa.id,
      startX: clientX,
      startY: clientY,
      offsetX: mesa.pos_x,
      offsetY: mesa.pos_y,
    });
    setSelectedMesa(mesa);
  }, []);

  const handleMesaMove = useCallback((clientX: number, clientY: number) => {
    if (!dragState.isDragging || !dragState.mesaId) return;

    // Delta en píxeles de pantalla, convertido a metros considerando la escala
    const deltaX = (clientX - dragState.startX) / (PIXELS_PER_METER * scale);
    const deltaY = (clientY - dragState.startY) / (PIXELS_PER_METER * scale);

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

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    handleMesaMove(e.clientX, e.clientY);
  }, [handleMesaMove]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragState.isDragging) {
      e.preventDefault();
      handleMesaMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, [dragState.isDragging, handleMesaMove]);

  const handleMesaDragEnd = useCallback(() => {
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

      // Create a temporary container with all elements at 1:1 scale
      const tempContainer = document.createElement("div");
      tempContainer.style.position = "fixed";
      tempContainer.style.left = "-9999px";
      tempContainer.style.top = "0";
      tempContainer.style.width = `${contentBounds.width}px`;
      tempContainer.style.height = `${contentBounds.height}px`;
      tempContainer.style.backgroundColor = "#ffffff";
      tempContainer.style.overflow = "visible";
      document.body.appendChild(tempContainer);

      // Create inner content div
      const contentDiv = document.createElement("div");
      contentDiv.style.position = "relative";
      contentDiv.style.width = "100%";
      contentDiv.style.height = "100%";
      tempContainer.appendChild(contentDiv);

      // Render grid
      const gridSize = 50;
      for (let x = 0; x <= contentBounds.width; x += gridSize) {
        const line = document.createElement("div");
        line.style.position = "absolute";
        line.style.left = `${x}px`;
        line.style.top = "0";
        line.style.width = "1px";
        line.style.height = "100%";
        line.style.backgroundColor = "#e5e7eb";
        contentDiv.appendChild(line);
      }
      for (let y = 0; y <= contentBounds.height; y += gridSize) {
        const line = document.createElement("div");
        line.style.position = "absolute";
        line.style.left = "0";
        line.style.top = `${y}px`;
        line.style.width = "100%";
        line.style.height = "1px";
        line.style.backgroundColor = "#e5e7eb";
        contentDiv.appendChild(line);
      }

      // Render architectural elements (walls, areas, doors, etc.)
      elementosPlano.forEach((elem) => {
        const props = elem.props || elem;
        const elemDiv = document.createElement("div");
        elemDiv.style.position = "absolute";
        
        switch (elem.tipo) {
          case "wall":
            const x1 = props.x1 ?? 0;
            const y1 = props.y1 ?? 0;
            const x2 = props.x2 ?? 0;
            const y2 = props.y2 ?? 0;
            const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
            const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
            elemDiv.style.left = `${x1 - offsetX}px`;
            elemDiv.style.top = `${y1 - offsetY}px`;
            elemDiv.style.width = `${length}px`;
            elemDiv.style.height = "6px";
            elemDiv.style.backgroundColor = "#374151";
            elemDiv.style.transform = `rotate(${angle}deg)`;
            elemDiv.style.transformOrigin = "0 50%";
            break;
            
          case "rectangle":
          case "area":
            elemDiv.style.left = `${(props.left || elem.left || 0) - offsetX}px`;
            elemDiv.style.top = `${(props.top || elem.top || 0) - offsetY}px`;
            elemDiv.style.width = `${props.width || elem.width || 100}px`;
            elemDiv.style.height = `${props.height || elem.height || 100}px`;
            elemDiv.style.backgroundColor = props.fill || elem.fill || "rgba(226, 232, 240, 0.5)";
            elemDiv.style.border = "2px solid #64748b";
            elemDiv.style.borderRadius = "4px";
            break;
            
          case "circle":
            const radius = props.radius || elem.radius || 30;
            elemDiv.style.left = `${(props.left || elem.left || 0) - offsetX}px`;
            elemDiv.style.top = `${(props.top || elem.top || 0) - offsetY}px`;
            elemDiv.style.width = `${radius * 2}px`;
            elemDiv.style.height = `${radius * 2}px`;
            elemDiv.style.backgroundColor = props.fill || elem.fill || "#e2e8f0";
            elemDiv.style.border = "2px solid #64748b";
            elemDiv.style.borderRadius = "50%";
            break;
            
          case "door":
            elemDiv.style.left = `${(props.left || elem.left || 0) - offsetX}px`;
            elemDiv.style.top = `${(props.top || elem.top || 0) - offsetY}px`;
            elemDiv.style.width = `${props.width || elem.width || 70}px`;
            elemDiv.style.height = `${props.height || elem.height || 12}px`;
            elemDiv.style.backgroundColor = "#fef3c7";
            elemDiv.style.border = "2px solid #d97706";
            elemDiv.style.borderRadius = "2px";
            break;
            
          case "window":
            elemDiv.style.left = `${(props.left || elem.left || 0) - offsetX}px`;
            elemDiv.style.top = `${(props.top || elem.top || 0) - offsetY}px`;
            elemDiv.style.width = `${props.width || elem.width || 60}px`;
            elemDiv.style.height = `${props.height || elem.height || 8}px`;
            elemDiv.style.backgroundColor = "#bfdbfe";
            elemDiv.style.border = "2px solid #3b82f6";
            break;
            
          default:
            return;
        }
        contentDiv.appendChild(elemDiv);
      });

      // Render mesas
      localMesas.forEach((mesa) => {
        const reserva = getReservaAsignada(mesa.id);
        const posXPixels = (mesa.pos_x || 0) * PIXELS_PER_METER - offsetX;
        const posYPixels = (mesa.pos_y || 0) * PIXELS_PER_METER - offsetY;
        const anchoPixels = ((mesa.ancho || 80) / 100) * PIXELS_PER_METER;
        const altoPixels = ((mesa.alto || 80) / 100) * PIXELS_PER_METER;

        const mesaDiv = document.createElement("div");
        mesaDiv.style.position = "absolute";
        mesaDiv.style.left = `${posXPixels}px`;
        mesaDiv.style.top = `${posYPixels}px`;
        mesaDiv.style.width = `${anchoPixels}px`;
        mesaDiv.style.height = `${altoPixels}px`;
        mesaDiv.style.backgroundColor = reserva ? "#bbf7d0" : "#e5e7eb";
        mesaDiv.style.border = "2px solid #6b7280";
        mesaDiv.style.borderRadius = mesa.forma === "circular" ? "50%" : "8px";
        mesaDiv.style.display = "flex";
        mesaDiv.style.alignItems = "center";
        mesaDiv.style.justifyContent = "center";
        mesaDiv.style.fontSize = "11px";
        mesaDiv.style.fontWeight = "600";
        mesaDiv.style.color = "#1f2937";
        mesaDiv.textContent = mesa.nombre;
        contentDiv.appendChild(mesaDiv);

        // Add reservation card if assigned - improved styling
        if (reserva) {
          const cardDiv = document.createElement("div");
          cardDiv.style.position = "absolute";
          cardDiv.style.left = `${posXPixels + anchoPixels / 2}px`;
          cardDiv.style.top = `${posYPixels - 45}px`;
          cardDiv.style.transform = "translateX(-50%)";
          cardDiv.style.backgroundColor = "#16a34a";
          cardDiv.style.color = "white";
          cardDiv.style.padding = "6px 10px";
          cardDiv.style.borderRadius = "8px";
          cardDiv.style.fontSize = "11px";
          cardDiv.style.fontWeight = "600";
          cardDiv.style.whiteSpace = "nowrap";
          cardDiv.style.boxShadow = "0 4px 6px rgba(0,0,0,0.15)";
          cardDiv.style.textAlign = "center";
          cardDiv.style.lineHeight = "1.3";
          cardDiv.style.minWidth = "80px";
          
          // Create structured content
          const nameSpan = document.createElement("div");
          nameSpan.style.fontWeight = "700";
          nameSpan.style.fontSize = "12px";
          nameSpan.textContent = reserva.reservas.nombre || "Sin nombre";
          
          const infoSpan = document.createElement("div");
          infoSpan.style.fontSize = "10px";
          infoSpan.style.opacity = "0.9";
          infoSpan.textContent = `${reserva.reservas.hora} · ${reserva.reservas.numero_comensales} pers.`;
          
          cardDiv.appendChild(nameSpan);
          cardDiv.appendChild(infoSpan);
          contentDiv.appendChild(cardDiv);
        }
      });

      const canvas = await html2canvas(tempContainer, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });

      // Clean up
      document.body.removeChild(tempContainer);

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const margin = 14;

      // Header
      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      pdf.text(`${espacioNombre}`, margin, 15);
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Fecha: ${new Date(fechaActual).toLocaleDateString("es-ES", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`, margin, 22);

      // Floor plan image - fit properly
      const maxImgWidth = pdfWidth - (margin * 2);
      const maxImgHeight = 90; // Fixed height for floor plan
      const imgRatio = canvas.width / canvas.height;
      let imgWidth = maxImgWidth;
      let imgHeight = imgWidth / imgRatio;
      
      if (imgHeight > maxImgHeight) {
        imgHeight = maxImgHeight;
        imgWidth = imgHeight * imgRatio;
      }

      const imgX = (pdfWidth - imgWidth) / 2;
      pdf.addImage(imgData, "PNG", imgX, 28, imgWidth, imgHeight);

      // Reservations list
      const tableStartY = 28 + imgHeight + 10;
      
      // Get all reservations with assignments
      const reservasAsignadas = asignaciones?.map(a => {
        const mesa = localMesas.find(m => m.id === a.mesa_id);
        return {
          nombre: a.reservas.nombre || "Sin nombre",
          hora: a.reservas.hora,
          comensales: a.reservas.numero_comensales,
          mesa: mesa?.nombre || "Sin mesa",
          notas: "",
        };
      }) || [];

      const reservasSinAsignar = reservasHoy?.filter(
        r => !asignaciones?.some(a => a.reserva_id === r.id)
      ).map(r => ({
        nombre: r.nombre || "Sin nombre",
        hora: r.hora,
        comensales: r.numero_comensales,
        mesa: "Sin asignar",
        notas: "",
      })) || [];

      const todasReservas = [...reservasAsignadas, ...reservasSinAsignar].sort((a, b) => a.hora.localeCompare(b.hora));

      if (todasReservas.length > 0) {
        pdf.setFontSize(14);
        pdf.setFont("helvetica", "bold");
        pdf.text("Reservas del día", margin, tableStartY);

        // Table header
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "bold");
        const colWidths = [30, 50, 25, 40, pdfWidth - margin * 2 - 145];
        const headers = ["Hora", "Cliente", "Personas", "Mesa", "Notas"];
        let xPos = margin;
        const headerY = tableStartY + 8;
        
        pdf.setFillColor(240, 240, 240);
        pdf.rect(margin, headerY - 4, pdfWidth - margin * 2, 7, "F");
        
        headers.forEach((header, i) => {
          pdf.text(header, xPos + 2, headerY);
          xPos += colWidths[i];
        });

        // Table rows
        pdf.setFont("helvetica", "normal");
        let rowY = headerY + 8;
        
        todasReservas.forEach((reserva, index) => {
          if (rowY > pdfHeight - 15) {
            pdf.addPage();
            rowY = 20;
          }

          // Alternate row background
          if (index % 2 === 0) {
            pdf.setFillColor(250, 250, 250);
            pdf.rect(margin, rowY - 4, pdfWidth - margin * 2, 7, "F");
          }

          xPos = margin;
          const rowData = [
            reserva.hora,
            reserva.nombre.substring(0, 25),
            String(reserva.comensales),
            reserva.mesa,
            reserva.notas.substring(0, 40) + (reserva.notas.length > 40 ? "..." : ""),
          ];
          
          rowData.forEach((cell, i) => {
            pdf.text(cell, xPos + 2, rowY);
            xPos += colWidths[i];
          });
          
          rowY += 7;
        });

        // Summary
        pdf.setFont("helvetica", "bold");
        pdf.text(`Total: ${todasReservas.length} reservas - ${todasReservas.reduce((acc, r) => acc + r.comensales, 0)} comensales`, margin, rowY + 5);
      } else {
        pdf.setFontSize(12);
        pdf.text("No hay reservas para este día", margin, tableStartY);
      }

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
                left: (x1 - offsetX) * scale,
                top: (y1 - offsetY) * scale,
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
        const rectLeft = ((props.left || elem.left || 0) - offsetX) * scale;
        const rectTop = ((props.top || elem.top || 0) - offsetY) * scale;
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
        const circleLeft = ((props.left || elem.left || 0) - offsetX) * scale;
        const circleTop = ((props.top || elem.top || 0) - offsetY) * scale;
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
        const doorLeft = ((props.left || elem.left || 0) - offsetX) * scale;
        const doorTop = ((props.top || elem.top || 0) - offsetY) * scale;
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
        const sillaLeft = ((props.left || elem.left || 0) - offsetX) * scale;
        const sillaTop = ((props.top || elem.top || 0) - offsetY) * scale;
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
        const elemLeft = ((props.left || elem.left || 0) - offsetX) * scale;
        const elemTop = ((props.top || elem.top || 0) - offsetY) * scale;
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
        const polyLeft = ((props.left || elem.left || 0) - offsetX) * scale;
        const polyTop = ((props.top || elem.top || 0) - offsetY) * scale;
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
      <div className="flex flex-col gap-4 h-[calc(100vh-220px)]">
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
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_350px] flex-1 min-h-0">
          {/* Canvas del plano */}
          <Card className="overflow-hidden flex flex-col">
            <CardContent className="p-0 flex-1 flex flex-col min-h-0">
              <div 
                ref={containerRef}
                className={cn(
                  "relative w-full flex-1 min-h-[400px] overflow-hidden",
                  isSpacePressed && "cursor-grab",
                  isPanning && "cursor-grabbing"
                )}
                style={{
                  backgroundImage: `
                    linear-gradient(to right, hsl(var(--border) / 0.25) 1px, transparent 1px),
                    linear-gradient(to bottom, hsl(var(--border) / 0.25) 1px, transparent 1px)
                  `,
                  backgroundSize: `${PIXELS_PER_METER * scale}px ${PIXELS_PER_METER * scale}px`,
                  backgroundPosition: `${panOffset.x}px ${panOffset.y}px`,
                }}
                onWheel={handleWheel}
                onMouseDown={handlePanStart}
                onMouseMove={(e) => {
                  handlePanMove(e);
                  if (!isPanning) handleMouseMove(e);
                }}
                onMouseUp={() => {
                  handlePanEnd();
                  handleMesaDragEnd();
                }}
                onMouseLeave={() => {
                  handlePanEnd();
                  handleMesaDragEnd();
                }}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleMesaDragEnd}
                onTouchCancel={handleMesaDragEnd}
              >
                <div
                  ref={canvasRef}
                  className="absolute"
                  style={{ 
                    width: contentBounds.width * scale, 
                    height: contentBounds.height * scale,
                    left: `calc(50% + ${panOffset.x}px)`,
                    top: `calc(50% + ${panOffset.y}px)`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >

                  {/* Elementos del plano (paredes, decoración, etc.) */}
                  {elementosPlano.map((elem) => renderElementoPlano(elem))}

                  {/* Mesas - posicionadas según pos_x/pos_y en metros */}
                  {localMesas.map((mesa) => {
                    const reserva = getReservaAsignada(mesa.id);
                    const isSelected = selectedMesa?.id === mesa.id;
                    const isDragging = dragState.mesaId === mesa.id;
                    
                    // Convertir posición de metros a píxeles, restar offset y aplicar escala
                    const posXPixels = ((mesa.pos_x || 0) * PIXELS_PER_METER - offsetX) * scale;
                    const posYPixels = ((mesa.pos_y || 0) * PIXELS_PER_METER - offsetY) * scale;
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
                        mesaOriginal={mesa}
                        reserva={reserva}
                        isSelected={isSelected}
                        isDragging={isDragging}
                        onDragStart={handleMesaDragStart}
                        onClick={() => setSelectedMesa(mesa)}
                        onRemoveAssignment={reserva ? () => handleRemoveAssignment(reserva.id) : undefined}
                        isDropTarget={!!activeReserva || !!selectedReservaForClick}
                        draggingReserva={activeReserva}
                        selectedReservaForClick={selectedReservaForClick}
                        onClickAssign={handleClickAssignToMesa}
                        scale={scale}
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

                  {/* Indicador de drop zone cuando se arrastra */}
                  {activeReserva && localMesas.length > 0 && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg">
                      <span className="flex items-center gap-1.5">
                        <Move className="h-3 w-3" />
                        Suelta en mesa verde o azul
                      </span>
                    </div>
                  )}

                  {/* Indicador cuando hay reserva seleccionada por click */}
                  {selectedReservaForClick && !activeReserva && localMesas.length > 0 && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-full bg-green-500 text-white text-xs font-medium shadow-lg animate-pulse">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3 w-3" />
                        Click en una mesa para asignar "{selectedReservaForClick.nombre}"
                      </span>
                    </div>
                  )}
                </div>
                
                {/* Controles de zoom */}
                <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-lg p-1 shadow-sm border border-border">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleZoomOut}
                    title="Alejar"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <span className="text-xs font-medium min-w-[40px] text-center">
                    {Math.round(scale * 100)}%
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleZoomIn}
                    title="Acercar"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleCenterView}
                    title="Centrar"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
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

            {/* Reservas - Panel mejorado */}
            <Card className="flex flex-col overflow-hidden">
              <CardHeader className="pb-3 border-b bg-gradient-to-r from-primary/5 to-transparent">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-primary/10">
                      <Utensils className="h-4 w-4 text-primary" />
                    </div>
                    Reservas
                  </CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    {reservasHoy?.length || 0} total
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 flex flex-col min-h-0">
                {!reservasHoy?.length ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                    <div className="p-3 rounded-full bg-muted mb-3">
                      <Utensils className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground text-sm font-medium">Sin reservas hoy</p>
                    <p className="text-muted-foreground text-xs">Las reservas aparecerán aquí</p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col min-h-0">
                    {/* Instrucciones de uso - más estéticas */}
                    <div className="px-3 py-2.5 bg-muted/50 border-b">
                      <div className="flex gap-3">
                        <div className="flex-1 flex items-center gap-2 p-2 rounded-lg bg-background border border-border/50">
                          <div className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">1</div>
                          <div className="text-[10px] text-muted-foreground">
                            <span className="font-medium text-foreground">Click</span> en reserva
                          </div>
                        </div>
                        <div className="flex items-center text-muted-foreground">→</div>
                        <div className="flex-1 flex items-center gap-2 p-2 rounded-lg bg-background border border-border/50">
                          <div className="flex items-center justify-center h-5 w-5 rounded-full bg-green-500/10 text-green-600 text-[10px] font-bold">2</div>
                          <div className="text-[10px] text-muted-foreground">
                            <span className="font-medium text-foreground">Click</span> en mesa
                          </div>
                        </div>
                      </div>
                      <p className="text-[9px] text-muted-foreground text-center mt-1.5">
                        O arrastra directamente al plano
                      </p>
                    </div>

                    {/* Botón cancelar selección */}
                    {selectedReservaForClick && (
                      <div className="px-3 py-2 bg-primary/10 border-b border-primary/20">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full text-xs h-7 border-primary/30 hover:bg-primary/20"
                          onClick={() => setSelectedReservaForClick(null)}
                        >
                          <X className="h-3 w-3 mr-1.5" />
                          Cancelar selección
                        </Button>
                      </div>
                    )}

                    <ScrollArea className="flex-1">
                      <div className="p-3 space-y-4">
                        {/* Pendientes primero */}
                        {reservasPendientes.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-yellow-100 dark:bg-yellow-900/30">
                                <div className="h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />
                                <span className="text-[10px] font-semibold text-yellow-700 dark:text-yellow-400 uppercase tracking-wide">
                                  Por asignar
                                </span>
                              </div>
                              <Badge variant="outline" className="text-[10px] h-5">
                                {reservasPendientes.length}
                              </Badge>
                            </div>
                            <div className="space-y-1.5">
                              {reservasPendientes.map((r: any) => (
                                <DraggableReserva
                                  key={r.id}
                                  reserva={r}
                                  isAssigned={false}
                                  isSelectedForClick={selectedReservaForClick?.id === r.id}
                                  onClickSelect={handleClickSelectReserva}
                                />
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Separador visual */}
                        {reservasPendientes.length > 0 && reservasAsignadas.length > 0 && (
                          <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                              <div className="w-full border-t border-border" />
                            </div>
                          </div>
                        )}

                        {/* Asignadas */}
                        {reservasAsignadas.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30">
                                <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
                                <span className="text-[10px] font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide">
                                  Asignadas
                                </span>
                              </div>
                              <Badge variant="outline" className="text-[10px] h-5 border-green-300 text-green-700 dark:text-green-400">
                                {reservasAsignadas.length}
                              </Badge>
                            </div>
                            <div className="space-y-1.5">
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
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Drag overlay - compacto para ver mejor las mesas */}
        <DragOverlay dropAnimation={{
          duration: 150,
          easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
        }}>
          {activeReserva && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border-2 border-primary bg-primary text-primary-foreground shadow-xl transform -rotate-1 scale-90 opacity-90">
              <Users className="h-3 w-3" />
              <span className="font-bold text-xs truncate max-w-[80px]">{activeReserva.nombre}</span>
              <span className="text-[10px] opacity-80">{activeReserva.numero_comensales}p</span>
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
