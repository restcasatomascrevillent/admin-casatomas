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
  Save, 
  ArrowLeft, 
  Wand2, 
  FileDown,
  Move,
  RotateCw,
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
  const guardarPlano = useCrearOActualizarPlano();

  const canvasWidth = plano?.ancho || 800;
  const canvasHeight = plano?.alto || 600;

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
    // Usar html2canvas + jspdf para exportar
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

      // Título
      pdf.setFontSize(18);
      pdf.text(`${espacioNombre} - ${new Date().toLocaleDateString("es-ES")}`, 14, 15);

      // Imagen del plano
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
            {localMesas.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Move className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No hay mesas configuradas</p>
                  <p className="text-sm">Añade mesas usando el botón superior</p>
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
