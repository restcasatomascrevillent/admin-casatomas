import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMesas, useCrearMesa, useActualizarMesa, useActualizarMesasSilent, useEliminarMesa, Mesa } from "@/hooks/useMesas";
import { usePlanoEspacio, useCrearOActualizarPlano } from "@/hooks/usePlanosEspacio";
import { useAsignacionesMesa, AsignacionConDetalles } from "@/hooks/useAsignacionesMesa";
import { useReservasHoyPorEspacio } from "@/hooks/useOcupacionHoy";
import { 
  Plus, 
  Trash2, 
  ArrowLeft, 
  Wand2, 
  FileDown,
  Move,
  Users,
  Clock
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
}

export function PlanoEspacio2D({ espacioId, espacioNombre, onBack, fecha }: PlanoEspacio2DProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selectedMesa, setSelectedMesa] = useState<Mesa | null>(null);
  const [showAddMesa, setShowAddMesa] = useState(false);
  const [localMesas, setLocalMesas] = useState<Mesa[]>([]);
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
    ancho: 100,
    alto: 80,
  });

  const { data: mesas, isLoading: loadingMesas } = useMesas(espacioId);
  const { data: plano } = usePlanoEspacio(espacioId);
  const { data: asignaciones } = useAsignacionesMesa(fecha || new Date().toISOString().split("T")[0], espacioId);
  const { data: reservasHoy } = useReservasHoyPorEspacio(espacioId);

  const crearMesa = useCrearMesa();
  const actualizarMesa = useActualizarMesa();
  const actualizarMesasSilent = useActualizarMesasSilent();
  const eliminarMesa = useEliminarMesa();

  // Canvas usa dimensiones fijas como el editor (800x500), ya que los elementos se guardan en esas coordenadas
  const canvasWidth = 800;
  const canvasHeight = 500;
  const elementosPlano: ElementoPlano[] = plano?.configuracion?.elementos || [];

  // Sincronizar mesas locales con datos del servidor
  useEffect(() => {
    if (mesas) {
      setLocalMesas(mesas);
    }
  }, [mesas]);

  // Obtener reserva asignada a una mesa
  const getReservaAsignada = useCallback((mesaId: string): AsignacionConDetalles | undefined => {
    return asignaciones?.find((a) => a.mesa_id === mesaId);
  }, [asignaciones]);

  // Handlers de arrastre
  const handleMouseDown = useCallback((e: React.MouseEvent, mesa: Mesa) => {
    e.preventDefault();
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

    const deltaX = e.clientX - dragState.startX;
    const deltaY = e.clientY - dragState.startY;

    setLocalMesas((prev) =>
      prev.map((m) =>
        m.id === dragState.mesaId
          ? {
              ...m,
              pos_x: Math.max(0, Math.min(canvasWidth - m.ancho, dragState.offsetX + deltaX)),
              pos_y: Math.max(0, Math.min(canvasHeight - m.alto, dragState.offsetY + deltaY)),
            }
          : m
      )
    );
  }, [dragState, canvasWidth, canvasHeight]);

  const handleMouseUp = useCallback(() => {
    if (dragState.isDragging && dragState.mesaId) {
      const mesa = localMesas.find((m) => m.id === dragState.mesaId);
      if (mesa) {
        actualizarMesasSilent.mutate([{ id: mesa.id, pos_x: mesa.pos_x, pos_y: mesa.pos_y }]);
      }
    }
    setDragState({ isDragging: false, mesaId: null, startX: 0, startY: 0, offsetX: 0, offsetY: 0 });
  }, [dragState, localMesas, actualizarMesasSilent]);

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

    setNewMesa({ nombre: "", capacidad: 4, forma: "rectangular", ancho: 100, alto: 80 });
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
      pdf.text(`${espacioNombre} - ${new Date().toLocaleDateString("es-ES")}`, 14, 15);

      const imgWidth = pdfWidth - 28;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      pdf.addImage(imgData, "PNG", 14, 25, imgWidth, Math.min(imgHeight, pdfHeight - 40));

      pdf.save(`plano-${espacioNombre}-${new Date().toISOString().split("T")[0]}.pdf`);
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
            fecha: fecha || new Date().toISOString().split("T")[0],
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

    switch (elem.tipo) {
      case "wall":
        if (elem.x1 !== undefined && elem.y1 !== undefined && elem.x2 !== undefined && elem.y2 !== undefined) {
          const length = Math.sqrt(Math.pow(elem.x2 - elem.x1, 2) + Math.pow(elem.y2 - elem.y1, 2));
          const angle = Math.atan2(elem.y2 - elem.y1, elem.x2 - elem.x1) * 180 / Math.PI;
          return (
            <div
              key={elem.id}
              style={{
                ...baseStyle,
                left: elem.x1,
                top: elem.y1,
                width: length,
                height: 8,
                backgroundColor: "#374151",
                transform: `rotate(${angle}deg)`,
                transformOrigin: "0 50%",
              }}
            />
          );
        }
        return null;

      case "rectangle":
        return (
          <div
            key={elem.id}
            style={{
              ...baseStyle,
              left: elem.left,
              top: elem.top,
              width: elem.width,
              height: elem.height,
              backgroundColor: elem.fill || "#e2e8f0",
              border: "2px solid #64748b",
              borderRadius: 4,
            }}
          />
        );

      case "circle":
        return (
          <div
            key={elem.id}
            style={{
              ...baseStyle,
              left: elem.left,
              top: elem.top,
              width: (elem.radius || 30) * 2,
              height: (elem.radius || 30) * 2,
              backgroundColor: elem.fill || "#e2e8f0",
              border: "2px solid #64748b",
              borderRadius: "50%",
            }}
          />
        );

      case "silla":
        return (
          <div
            key={elem.id}
            style={{
              ...baseStyle,
              left: elem.left,
              top: elem.top,
              width: (elem.radius || 15) * 2,
              height: (elem.radius || 15) * 2,
              backgroundColor: "#fde68a",
              border: "2px solid #d97706",
              borderRadius: "50%",
            }}
          />
        );

      case "elemento":
        return (
          <div
            key={elem.id}
            style={{
              ...baseStyle,
              left: elem.left,
              top: elem.top,
              width: elem.width || 40,
              height: elem.height || 40,
              backgroundColor: "#94a3b8",
              border: "1px solid #475569",
              borderRadius: 4,
            }}
          />
        );

      case "polygon":
        // Polígonos se renderizarían con SVG, simplificado aquí
        return (
          <div
            key={elem.id}
            style={{
              ...baseStyle,
              left: elem.left,
              top: elem.top,
              width: 60,
              height: 60,
              clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
              backgroundColor: elem.fill || "#e2e8f0",
            }}
          />
        );

      default:
        return null;
    }
  };

  if (loadingMesas) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Button>
          <div>
            <h3 className="text-xl font-bold">{espacioNombre}</h3>
            <p className="text-sm text-muted-foreground">
              {localMesas.length} mesas · {fecha || new Date().toLocaleDateString("es-ES")}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowAddMesa(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Añadir Mesa
          </Button>
          <Button variant="outline" onClick={handleCalcularDistribucion}>
            <Wand2 className="mr-2 h-4 w-4" />
            IA Distribución
          </Button>
          <Button variant="outline" onClick={handleExportPDF}>
            <FileDown className="mr-2 h-4 w-4" />
            Exportar PDF
          </Button>
        </div>
      </div>

      {/* Canvas del plano */}
      <Card>
        <CardContent className="p-4">
          <div
            ref={canvasRef}
            className="relative bg-slate-50 border-2 border-dashed border-slate-200 rounded-lg overflow-hidden"
            style={{ width: canvasWidth, height: canvasHeight, maxWidth: "100%" }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Grid de fondo */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: `
                  linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px),
                  linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)
                `,
                backgroundSize: "50px 50px",
              }}
            />

            {/* Elementos del plano (paredes, decoración, etc.) */}
            {elementosPlano.map((elem) => renderElementoPlano(elem))}

            {/* Mesas */}
            {localMesas.map((mesa) => {
              const reserva = getReservaAsignada(mesa.id);
              const isSelected = selectedMesa?.id === mesa.id;
              const isDragging = dragState.mesaId === mesa.id;

              return (
                <div
                  key={mesa.id}
                  className={cn(
                    "absolute cursor-move transition-shadow",
                    "flex flex-col items-center justify-center text-center p-2",
                    "border-2 shadow-sm hover:shadow-md",
                    mesa.forma === "circular" ? "rounded-full" : "rounded-lg",
                    isSelected ? "border-primary ring-2 ring-primary/30" : "border-slate-300",
                    isDragging ? "shadow-lg scale-105 z-50" : "",
                    reserva ? "bg-primary/20 border-primary" : "bg-white"
                  )}
                  style={{
                    left: mesa.pos_x,
                    top: mesa.pos_y,
                    width: mesa.ancho,
                    height: mesa.alto,
                    transform: `rotate(${mesa.rotacion}deg)`,
                  }}
                  onMouseDown={(e) => handleMouseDown(e, mesa)}
                  onClick={() => setSelectedMesa(mesa)}
                >
                  <span className="font-medium text-xs truncate w-full">{mesa.nombre}</span>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    <span>{mesa.capacidad}</span>
                  </div>

                  {reserva && (
                    <div className="absolute -top-1 -right-1">
                      <Badge className="text-[10px] px-1 py-0 bg-primary">
                        {reserva.reservas.nombre?.split(" ")[0]}
                      </Badge>
                    </div>
                  )}
                </div>
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
        </CardContent>
      </Card>

      {/* Panel lateral con detalles */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Mesa seleccionada */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Mesa Seleccionada</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedMesa ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Nombre</p>
                    <p className="font-medium">{selectedMesa.nombre}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Capacidad</p>
                    <p className="font-medium">{selectedMesa.capacidad} personas</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Forma</p>
                    <p className="font-medium capitalize">{selectedMesa.forma}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Dimensiones</p>
                    <p className="font-medium">{selectedMesa.ancho}x{selectedMesa.alto}px</p>
                  </div>
                </div>

                {getReservaAsignada(selectedMesa.id) && (
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <p className="font-medium text-sm mb-1">Reserva Asignada:</p>
                    <div className="text-sm space-y-1">
                      <p><span className="text-muted-foreground">Cliente:</span> {getReservaAsignada(selectedMesa.id)?.reservas.nombre}</p>
                      <p><span className="text-muted-foreground">Hora:</span> {getReservaAsignada(selectedMesa.id)?.reservas.hora}</p>
                      <p><span className="text-muted-foreground">Personas:</span> {getReservaAsignada(selectedMesa.id)?.reservas.numero_comensales}</p>
                    </div>
                  </div>
                )}

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDeleteMesa(selectedMesa.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar Mesa
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Selecciona una mesa del plano para ver sus detalles
              </p>
            )}
          </CardContent>
        </Card>

        {/* Reservas de hoy */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Reservas de Hoy</CardTitle>
          </CardHeader>
          <CardContent>
            {!reservasHoy?.length ? (
              <p className="text-muted-foreground text-sm">No hay reservas para hoy</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {reservasHoy.map((r: any) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between p-2 bg-muted/50 rounded-lg text-sm"
                  >
                    <div>
                      <p className="font-medium">{r.nombre}</p>
                      <p className="text-muted-foreground flex items-center gap-2">
                        <Clock className="h-3 w-3" />
                        {r.hora}
                        <Users className="h-3 w-3 ml-2" />
                        {r.numero_comensales}
                      </p>
                    </div>
                    <Badge variant={r.estado === "confirmada" ? "default" : "secondary"}>
                      {r.estado}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
  );
}
