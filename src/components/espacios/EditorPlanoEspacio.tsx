import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, Download, Trash2, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { usePlanoEspacio, useCrearOActualizarPlano } from "@/hooks/usePlanosEspacio";
import { useMesas, useActualizarMesasSilent } from "@/hooks/useMesas";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ToolbarDibujo, ToolType } from "./ToolbarDibujo";
import { CanvasPlano, CanvasPlanoRef } from "./CanvasPlano";
import { PanelLateral } from "./PanelLateral";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface EditorPlanoEspacioProps {
  espacioId: string;
  espacioNombre: string;
  onBack: () => void;
}

export interface MesaCanvas {
  id: string;
  nombre: string;
  capacidad: number;
  forma: "rectangular" | "circular";
  ancho: number;
  alto: number;
  posX: number;
  posY: number;
  isMerged?: boolean;
  originalMesas?: Array<{
    id: string;
    nombre: string;
    capacidad: number;
    forma: "rectangular" | "circular";
    ancho: number;
    alto: number;
  }>;
}

export interface ElementoCanvas {
  id: string;
  tipo: "wall" | "area" | "door";
  props: Record<string, any>;
}

export function EditorPlanoEspacio({ espacioId, espacioNombre, onBack }: EditorPlanoEspacioProps) {
  const [activeTool, setActiveTool] = useState<ToolType>("select");
  const [selectedElement, setSelectedElement] = useState<any>(null);
  const [elementos, setElementos] = useState<ElementoCanvas[]>([]);
  const [mesasCanvas, setMesasCanvas] = useState<MesaCanvas[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 500 });
  
  const canvasRef = useRef<CanvasPlanoRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Escala FIJA: 50 píxeles por metro (no cambia con el tamaño del contenedor)
  const PIXELS_PER_METER = 50;
  
  // Escala: dimensiones reales en metros
  const [realDimensions, setRealDimensions] = useState({ width: 12, height: 8 });

  const { data: plano, isLoading: loadingPlano } = usePlanoEspacio(espacioId);
  const { data: mesas = [], isLoading: loadingMesas, refetch: refetchMesas } = useMesas(espacioId);
  const guardarPlano = useCrearOActualizarPlano();
  const actualizarMesas = useActualizarMesasSilent();

  // Medir el contenedor
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

  // Calcular zoom para ajustar al contenedor (sin límite máximo)
  const canvasRealWidth = realDimensions.width * PIXELS_PER_METER;
  const canvasRealHeight = realDimensions.height * PIXELS_PER_METER;
  
  const fitZoom = Math.min(
    (containerSize.width - 40) / canvasRealWidth,
    (containerSize.height - 40) / canvasRealHeight
  );

  // Cargar dimensiones guardadas del plano (prioridad: columnas dedicadas, fallback: configuracion)
  useEffect(() => {
    if (plano?.ancho_metros && plano?.alto_metros) {
      setRealDimensions({ width: plano.ancho_metros, height: plano.alto_metros });
    } else if (plano?.configuracion?.realDimensions) {
      setRealDimensions(plano.configuracion.realDimensions);
    }
  }, [plano]);

  // Auto-ajustar zoom cuando cambian las dimensiones o el contenedor
  useEffect(() => {
    setZoomLevel(fitZoom);
  }, [fitZoom]);

  // Aplicar nuevas dimensiones reales
  const handleApplyDimensions = useCallback((width: number, height: number) => {
    setRealDimensions({ width, height });
    toast.success(`Escala aplicada: ${width}m × ${height}m`);
  }, []);

  // Guardar plano
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Calcular tamaño del canvas en píxeles
      const canvasWidth = realDimensions.width * PIXELS_PER_METER;
      const canvasHeight = realDimensions.height * PIXELS_PER_METER;
      
      // Guardar configuración del plano con dimensiones reales en metros
      await guardarPlano.mutateAsync({
        espacio_id: espacioId,
        ancho: canvasWidth,
        alto: canvasHeight,
        ancho_metros: realDimensions.width,
        alto_metros: realDimensions.height,
        pixels_per_meter: PIXELS_PER_METER,
        metros_cuadrados: realDimensions.width * realDimensions.height,
        configuracion: {
          elementos,
          realDimensions,
        },
      });

      // Actualizar posiciones de mesas (solo las que no son temporales)
      const mesasToUpdate = mesasCanvas.filter(m => !m.id.startsWith('mesa-temp-'));
      if (mesasToUpdate.length > 0) {
        const updates = mesasToUpdate.map((mesa) => ({
          id: mesa.id,
          pos_x: mesa.posX,
          pos_y: mesa.posY,
          ancho: mesa.ancho,
          alto: mesa.alto,
        }));
        await actualizarMesas.mutateAsync(updates);
      }

      toast.success("Plano guardado correctamente");
    } catch (error) {
      console.error("Error al guardar:", error);
      toast.error("Error al guardar el plano");
    } finally {
      setIsSaving(false);
    }
  }, [espacioId, elementos, mesasCanvas, realDimensions, PIXELS_PER_METER, guardarPlano, actualizarMesas]);

  // Exportar imagen
  const handleExport = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    if (canvas) {
      const link = document.createElement("a");
      link.download = `plano-${espacioNombre}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success("Imagen exportada");
    }
  }, [espacioNombre]);

  // Limpiar canvas (incluyendo mesas de la BBDD)
  const handleClear = useCallback(async () => {
    try {
      // Eliminar todas las mesas del espacio de la BBDD
      const { error } = await supabase
        .from("mesas")
        .delete()
        .eq("espacio_id", espacioId);
      
      if (error) throw error;
      
      // Limpiar estado local
      setElementos([]);
      setMesasCanvas([]);
      setSelectedElement(null);
      canvasRef.current?.clearCanvas();
      
      // Refrescar datos
      refetchMesas();
      
      setShowClearDialog(false);
      toast.success("Plano y mesas eliminados correctamente");
    } catch (error) {
      console.error("Error al limpiar:", error);
      toast.error("Error al eliminar las mesas");
    }
  }, [espacioId, refetchMesas]);

  // Eliminar elemento seleccionado
  const handleDeleteSelected = useCallback(() => {
    if (!selectedElement) return;
    
    if (selectedElement.tipo === "mesa") {
      setMesasCanvas((prev) => prev.filter((m) => m.id !== selectedElement.id));
      canvasRef.current?.removeElement(selectedElement.id);
    } else {
      setElementos((prev) => prev.filter((e) => e.id !== selectedElement.id));
      canvasRef.current?.removeElement(selectedElement.id);
    }
    setSelectedElement(null);
    setShowDeleteDialog(false);
    toast.success("Elemento eliminado");
  }, [selectedElement]);

  if (loadingPlano || loadingMesas) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-card to-card/80 rounded-xl p-4 border shadow-sm">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="rounded-full">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold">{espacioNombre}</h2>
            <p className="text-sm text-muted-foreground">
              Editor de plano • {realDimensions.width}m × {realDimensions.height}m • {(realDimensions.width * realDimensions.height).toFixed(0)} m²
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Controles de zoom */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-7 w-7"
              onClick={() => {
                const newZoom = Math.max(0.25, zoomLevel / 1.15);
                canvasRef.current?.setZoom(newZoom);
                setZoomLevel(newZoom);
              }}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium w-12 text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-7 w-7"
              onClick={() => {
                const newZoom = Math.min(3, zoomLevel * 1.15);
                canvasRef.current?.setZoom(newZoom);
                setZoomLevel(newZoom);
              }}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-7 w-7"
              onClick={() => {
                canvasRef.current?.resetView();
                setZoomLevel(fitZoom);
              }}
              title="Ajustar al espacio"
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </div>
          
          <Button variant="outline" size="sm" onClick={handleExport} className="rounded-lg">
            <Download className="h-4 w-4 mr-2" />
            Exportar
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowClearDialog(true)}
            className="rounded-lg text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Limpiar
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="rounded-lg">
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <ToolbarDibujo 
        activeTool={activeTool} 
        onToolChange={setActiveTool}
        onDeleteSelected={() => selectedElement ? setShowDeleteDialog(true) : null}
        hasSelection={!!selectedElement}
      />

      {/* Main content */}
      <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
        {/* Canvas - zoom nativo de Fabric.js */}
        <div 
          ref={containerRef}
          className="flex-1 rounded-xl border-2 border-border/30 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 overflow-hidden shadow-lg min-h-[400px] relative"
        >
          <CanvasPlano
            ref={canvasRef}
            pixelsPerMeter={PIXELS_PER_METER}
            activeTool={activeTool}
            elementos={elementos}
            mesasCanvas={mesasCanvas}
            mesasDB={mesas}
            realDimensions={realDimensions}
            containerSize={containerSize}
            planoConfig={plano?.configuracion}
            selectedElement={selectedElement}
            initialZoom={fitZoom}
            onElementosChange={setElementos}
            onMesasChange={setMesasCanvas}
            onSelectionChange={setSelectedElement}
            onToolChange={setActiveTool}
            onZoomChange={setZoomLevel}
          />
          {/* Indicador de modo pan */}
          <div className="absolute bottom-3 left-3 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
            🖱️ Rueda: Zoom • Espacio + Arrastrar: Mover
          </div>
        </div>

        {/* Panel lateral */}
        <PanelLateral
          espacioId={espacioId}
          selectedElement={selectedElement}
          mesasCanvas={mesasCanvas}
          pixelsPerMeter={PIXELS_PER_METER}
          onMesasChange={setMesasCanvas}
          onSelectionChange={setSelectedElement}
          onUnmergeMesa={(mesaId) => {
            canvasRef.current?.unmergeMesa(mesaId);
            setSelectedElement(null);
          }}
        />
      </div>


      {/* Dialog de confirmación para limpiar */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Limpiar todo el plano?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará TODOS los elementos del plano incluyendo paredes, áreas, puertas y 
              <strong> todas las mesas guardadas en la base de datos</strong>. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleClear} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Limpiar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de confirmación para eliminar elemento */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este elemento?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedElement?.tipo === "mesa" 
                ? `Se eliminará la mesa "${selectedElement?.nombre || 'seleccionada'}".`
                : `Se eliminará el elemento de tipo "${selectedElement?.tipo || 'seleccionado'}".`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSelected} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
