import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, Download, Trash2 } from "lucide-react";
import { usePlanoEspacio, useCrearOActualizarPlano } from "@/hooks/usePlanosEspacio";
import { useMesas, useActualizarMesasSilent } from "@/hooks/useMesas";
import { toast } from "sonner";
import { ToolbarDibujo, ToolType } from "./ToolbarDibujo";
import { CanvasPlano } from "./CanvasPlano";
import { PanelLateral } from "./PanelLateral";
import { ConfiguracionEscala } from "./ConfiguracionEscala";

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
  
  // Dimensiones del canvas fijas
  const CANVAS_WIDTH = 900;
  const CANVAS_HEIGHT = 550;
  
  // Escala: dimensiones reales en metros
  const [realDimensions, setRealDimensions] = useState({ width: 12, height: 8 });
  const [pixelsPerMeterX, setPixelsPerMeterX] = useState(CANVAS_WIDTH / 12);
  const [pixelsPerMeterY, setPixelsPerMeterY] = useState(CANVAS_HEIGHT / 8);

  const { data: plano, isLoading: loadingPlano } = usePlanoEspacio(espacioId);
  const { data: mesas = [], isLoading: loadingMesas } = useMesas(espacioId);
  const guardarPlano = useCrearOActualizarPlano();
  const actualizarMesas = useActualizarMesasSilent();

  // Aplicar nuevas dimensiones reales
  const handleApplyDimensions = useCallback((width: number, height: number) => {
    setRealDimensions({ width, height });
    setPixelsPerMeterX(CANVAS_WIDTH / width);
    setPixelsPerMeterY(CANVAS_HEIGHT / height);
    toast.success(`Escala aplicada: ${width}m × ${height}m`);
  }, []);

  // Guardar plano
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Guardar configuración del plano
      await guardarPlano.mutateAsync({
        espacio_id: espacioId,
        ancho: CANVAS_WIDTH,
        alto: CANVAS_HEIGHT,
        metros_cuadrados: realDimensions.width * realDimensions.height,
        configuracion: {
          elementos,
          pixelsPerMeterX,
          pixelsPerMeterY,
          realDimensions,
        },
      });

      // Actualizar posiciones de mesas
      if (mesasCanvas.length > 0) {
        const updates = mesasCanvas.map((mesa) => ({
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
  }, [espacioId, elementos, mesasCanvas, realDimensions, pixelsPerMeterX, pixelsPerMeterY, guardarPlano, actualizarMesas]);

  // Exportar imagen
  const handleExport = useCallback(() => {
    const canvas = document.querySelector("#plano-canvas") as HTMLCanvasElement;
    if (canvas) {
      const link = document.createElement("a");
      link.download = `plano-${espacioNombre}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success("Imagen exportada");
    }
  }, [espacioNombre]);

  // Limpiar canvas
  const handleClear = useCallback(() => {
    if (confirm("¿Eliminar todos los elementos del plano?")) {
      setElementos([]);
      setMesasCanvas([]);
      setSelectedElement(null);
      toast.info("Plano limpiado");
    }
  }, []);

  // Eliminar elemento seleccionado
  const handleDeleteSelected = useCallback(() => {
    if (!selectedElement) return;
    
    if (selectedElement.tipo === "mesa") {
      setMesasCanvas((prev) => prev.filter((m) => m.id !== selectedElement.id));
    } else {
      setElementos((prev) => prev.filter((e) => e.id !== selectedElement.id));
    }
    setSelectedElement(null);
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
      <div className="flex items-center justify-between bg-card rounded-lg p-4 border">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold">{espacioNombre}</h2>
            <p className="text-sm text-muted-foreground">
              Editor de plano • {realDimensions.width}m × {realDimensions.height}m
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Exportar
          </Button>
          <Button variant="outline" size="sm" onClick={handleClear}>
            <Trash2 className="h-4 w-4 mr-2" />
            Limpiar
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <ToolbarDibujo 
        activeTool={activeTool} 
        onToolChange={setActiveTool}
        onDeleteSelected={handleDeleteSelected}
        hasSelection={!!selectedElement}
      />

      {/* Main content */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Canvas */}
        <div className="flex-1 bg-card rounded-lg border overflow-hidden">
          <CanvasPlano
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            activeTool={activeTool}
            elementos={elementos}
            mesasCanvas={mesasCanvas}
            mesasDB={mesas}
            pixelsPerMeterX={pixelsPerMeterX}
            pixelsPerMeterY={pixelsPerMeterY}
            realDimensions={realDimensions}
            planoConfig={plano?.configuracion}
            selectedElement={selectedElement}
            onElementosChange={setElementos}
            onMesasChange={setMesasCanvas}
            onSelectionChange={setSelectedElement}
            onToolChange={setActiveTool}
          />
        </div>

        {/* Panel lateral */}
        <PanelLateral
          espacioId={espacioId}
          selectedElement={selectedElement}
          mesasCanvas={mesasCanvas}
          pixelsPerMeterX={pixelsPerMeterX}
          pixelsPerMeterY={pixelsPerMeterY}
          onMesasChange={setMesasCanvas}
          onSelectionChange={setSelectedElement}
        />
      </div>

      {/* Configuración de escala */}
      <ConfiguracionEscala
        realDimensions={realDimensions}
        onApply={handleApplyDimensions}
      />
    </div>
  );
}
