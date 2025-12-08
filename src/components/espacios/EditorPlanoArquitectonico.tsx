import { useEffect, useRef, useState, useCallback } from "react";
import { Canvas as FabricCanvas, Rect, Circle, Line, Polygon, FabricObject, PencilBrush, Path } from "fabric";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePlanoEspacio, useCrearOActualizarPlano } from "@/hooks/usePlanosEspacio";
import { useMesas, useCrearMesa, useActualizarMesasSilent, useEliminarMesa, Mesa } from "@/hooks/useMesas";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Save,
  ArrowLeft,
  Plus,
  Trash2,
  MousePointer,
  Square,
  Circle as CircleIcon,
  Minus,
  Triangle,
  Armchair,
  Move,
  Users,
  Download,
  Ruler,
  RefreshCw,
  Pencil,
  Wand2,
  Loader2,
  Copy,
  Clipboard
} from "lucide-react";

interface EditorPlanoArquitectonicoProps {
  espacioId: string;
  espacioNombre: string;
  onBack: () => void;
}

type ToolType = "select" | "wall" | "rectangle" | "circle" | "polygon" | "mesa" | "silla" | "elemento" | "freehand";

interface ElementoDecorador {
  id: string;
  tipo: string;
  fabricObjectId?: string;
}

export function EditorPlanoArquitectonico({ 
  espacioId, 
  espacioNombre, 
  onBack 
}: EditorPlanoArquitectonicoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>("select");
  // Tamaño fijo del canvas en píxeles (no cambia)
  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 500;
  const [canvasSize] = useState({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
  const [selectedObject, setSelectedObject] = useState<FabricObject | null>(null);
  const [isDrawingWall, setIsDrawingWall] = useState(false);
  const [wallStart, setWallStart] = useState<{ x: number; y: number } | null>(null);
  const [previewLine, setPreviewLine] = useState<Line | null>(null);
  
  // Refs para mantener valores actualizados en los event handlers sin recrear listeners
  const isDrawingWallRef = useRef(false);
  const wallStartRef = useRef<{ x: number; y: number } | null>(null);
  const previewLineRef = useRef<Line | null>(null);
  const activeToolRef = useRef<ToolType>("select");
  const [elementos, setElementos] = useState<ElementoDecorador[]>([]);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  
  // Estado para dibujo a mano alzada
  const [freehandPath, setFreehandPath] = useState<Path | null>(null);
  const [freehandPoints, setFreehandPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  
  // Escala: píxeles por metro en cada eje (pueden ser diferentes)
  const [pixelsPerMeterX, setPixelsPerMeterX] = useState(CANVAS_WIDTH / 9); // ~88.89
  const [pixelsPerMeterY, setPixelsPerMeterY] = useState(CANVAS_HEIGHT / 6); // ~83.33
  
  // Mantener compatibilidad con código existente (usar el promedio o el mínimo)
  const pixelsPerMeter = Math.min(pixelsPerMeterX, pixelsPerMeterY);
  
  // Dimensiones reales del espacio en metros
  const [realDimensions, setRealDimensions] = useState({ width: 9, height: 6 });

  // Configuración de nueva mesa (medidas en cm)
  const [newMesa, setNewMesa] = useState({
    nombre: "",
    capacidad: 4,
    forma: "rectangular" as "rectangular" | "circular" | "cuadrada",
    largo: 120, // cm - para rectangular
    ancho: 80,  // cm - para rectangular y cuadrada
    diametro: 100, // cm - para circular
  });

  // Estado para copiar/pegar mesas
  const [copiedMesa, setCopiedMesa] = useState<{
    nombre: string;
    capacidad: number;
    forma: string;
    ancho: number;
    alto: number;
  } | null>(null);

  // Estado para editar dimensiones de pared
  const [wallLength, setWallLength] = useState<number>(0);

  const { data: plano, isLoading: loadingPlano } = usePlanoEspacio(espacioId);
  const { data: mesas = [], isLoading: loadingMesas } = useMesas(espacioId);
  const guardarPlano = useCrearOActualizarPlano();
  const crearMesa = useCrearMesa();
  const actualizarMesas = useActualizarMesasSilent();
  const eliminarMesa = useEliminarMesa();

  // Inicializar canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: canvasSize.width,
      height: canvasSize.height,
      backgroundColor: "#f8fafc",
      selection: true,
    });

    canvas.on("selection:created", (e) => {
      setSelectedObject(e.selected?.[0] || null);
    });

    canvas.on("selection:updated", (e) => {
      setSelectedObject(e.selected?.[0] || null);
    });

    canvas.on("selection:cleared", () => {
      setSelectedObject(null);
    });

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, []);

  // Manejar modo de dibujo libre
  useEffect(() => {
    if (!fabricCanvas) return;

    if (activeTool === "freehand") {
      fabricCanvas.isDrawingMode = true;
      fabricCanvas.freeDrawingBrush = new PencilBrush(fabricCanvas);
      fabricCanvas.freeDrawingBrush.color = "#ef4444";
      fabricCanvas.freeDrawingBrush.width = 4;
      
      // Capturar el path cuando se termina de dibujar
      const handlePathCreated = (e: any) => {
        const path = e.path as Path;
        if (path) {
          // Extraer puntos del path
          const pathData = path.path || [];
          const points: Array<{ x: number; y: number }> = [];
          
          pathData.forEach((segment: any) => {
            if (segment[0] === "M" || segment[0] === "L") {
              points.push({ x: segment[1], y: segment[2] });
            } else if (segment[0] === "Q") {
              points.push({ x: segment[3], y: segment[4] });
            }
          });
          
          setFreehandPoints(points);
          setFreehandPath(path);
          
          // Cambiar color del path para indicar que está listo
          path.set({ stroke: "#f97316", strokeDashArray: [5, 5] });
          fabricCanvas.renderAll();
          
          toast.info("Dibujo capturado. Pulsa 'Convertir con IA' para generar paredes.");
        }
      };

      fabricCanvas.on("path:created", handlePathCreated);

      return () => {
        fabricCanvas.off("path:created", handlePathCreated);
      };
    } else {
      fabricCanvas.isDrawingMode = false;
    }
  }, [fabricCanvas, activeTool]);

  // Función para procesar el dibujo con IA
  const processWithAI = useCallback(async () => {
    if (freehandPoints.length < 10) {
      toast.error("Dibuja un perímetro más completo primero");
      return;
    }

    setIsProcessingAI(true);
    
    try {
      const { data, error } = await supabase.functions.invoke("procesar-dibujo-perimetro", {
        body: {
          points: freehandPoints,
          canvasWidth: canvasSize.width,
          canvasHeight: canvasSize.height,
          pixelsPerMeter,
        },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      // Eliminar el dibujo a mano alzada
      if (freehandPath && fabricCanvas) {
        fabricCanvas.remove(freehandPath);
        setFreehandPath(null);
        setFreehandPoints([]);
      }

      // Añadir las paredes generadas por IA
      if (data.walls && fabricCanvas) {
        data.walls.forEach((wall: any, index: number) => {
          const line = new Line([wall.x1, wall.y1, wall.x2, wall.y2], {
            stroke: "#374151",
            strokeWidth: 8,
            selectable: true,
            hasControls: true,
            originX: "left",
            originY: "top",
          });
          line.set({ left: 0, top: 0 });
          const wallId = `wall-ai-${Date.now()}-${index}`;
          (line as any).customData = { 
            tipo: "wall", 
            id: wallId,
            lengthMeters: wall.lengthMeters 
          };
          fabricCanvas.add(line);
          setElementos(prev => [...prev, { id: wallId, tipo: "wall" }]);
        });

        fabricCanvas.renderAll();
        
        toast.success(
          `Perímetro generado: ${data.walls.length} paredes, ${data.perimeter?.toFixed(1) || "?"} metros de perímetro, ${data.area?.toFixed(1) || "?"} m² de área`
        );
      }

      setActiveTool("select");
    } catch (error) {
      console.error("Error processing with AI:", error);
      toast.error(error instanceof Error ? error.message : "Error al procesar con IA");
    } finally {
      setIsProcessingAI(false);
    }
  }, [freehandPoints, freehandPath, fabricCanvas, canvasSize, pixelsPerMeter]);

  // Limpiar dibujo a mano alzada
  const clearFreehand = useCallback(() => {
    if (freehandPath && fabricCanvas) {
      fabricCanvas.remove(freehandPath);
      setFreehandPath(null);
      setFreehandPoints([]);
      fabricCanvas.renderAll();
    }
  }, [freehandPath, fabricCanvas]);

  // Cargar configuración guardada
  useEffect(() => {
    if (!fabricCanvas || !plano) return;

    // Restaurar escala desde la configuración guardada
    if (plano.configuracion?.pixelsPerMeterX && plano.configuracion?.pixelsPerMeterY) {
      setPixelsPerMeterX(plano.configuracion.pixelsPerMeterX);
      setPixelsPerMeterY(plano.configuracion.pixelsPerMeterY);
    } else if (plano.configuracion?.pixelsPerMeter) {
      // Compatibilidad con configuración antigua
      setPixelsPerMeterX(plano.configuracion.pixelsPerMeter);
      setPixelsPerMeterY(plano.configuracion.pixelsPerMeter);
    }
    if (plano.configuracion?.realDimensions) {
      setRealDimensions(plano.configuracion.realDimensions);
    }

    // Restaurar elementos del plano (paredes, elementos decorativos)
    if (plano.configuracion?.elementos) {
      try {
        const elementosData = plano.configuracion.elementos;
        elementosData.forEach((elem: any) => {
          let obj: FabricObject | null = null;

          switch (elem.tipo) {
            case "wall":
              obj = new Line([elem.x1, elem.y1, elem.x2, elem.y2], {
                stroke: "#374151",
                strokeWidth: 8,
                selectable: true,
                hasControls: true,
                originX: "left",
                originY: "top",
              });
              // Posicionar en 0,0 para que las coordenadas x1,y1,x2,y2 sean absolutas
              if (obj) {
                obj.set({ left: 0, top: 0 });
              }
              break;
            case "rectangle":
              obj = new Rect({
                left: elem.left,
                top: elem.top,
                width: elem.width,
                height: elem.height,
                fill: elem.fill || "#e2e8f0",
                stroke: "#64748b",
                strokeWidth: 2,
              });
              break;
            case "circle":
              obj = new Circle({
                left: elem.left,
                top: elem.top,
                radius: elem.radius || 30,
                fill: elem.fill || "#e2e8f0",
                stroke: "#64748b",
                strokeWidth: 2,
              });
              break;
            case "polygon":
              if (elem.points) {
                obj = new Polygon(elem.points, {
                  left: elem.left,
                  top: elem.top,
                  fill: elem.fill || "#e2e8f0",
                  stroke: "#64748b",
                  strokeWidth: 2,
                });
              }
              break;
            case "elemento":
              obj = new Rect({
                left: elem.left,
                top: elem.top,
                width: elem.width || 40,
                height: elem.height || 40,
                fill: "#94a3b8",
                stroke: "#475569",
                strokeWidth: 1,
                rx: 4,
                ry: 4,
              });
              break;
          }

          if (obj) {
            (obj as any).customData = { tipo: elem.tipo, id: elem.id };
            fabricCanvas.add(obj);
          }
        });
        setElementos(elementosData.map((e: any) => ({ id: e.id, tipo: e.tipo })));
      } catch (e) {
        console.error("Error cargando elementos:", e);
      }
    }

    fabricCanvas.renderAll();
  }, [fabricCanvas, plano]);

  // Renderizar mesas desde la base de datos - solo una vez al cargar
  const mesasRenderedRef = useRef<Set<string>>(new Set());
  
  useEffect(() => {
    if (!fabricCanvas || loadingMesas || !mesas) return;

    // Encontrar mesas nuevas que no están en el canvas
    const mesasEnCanvas = new Set<string>();
    fabricCanvas.getObjects().forEach((obj) => {
      const customData = (obj as any).customData;
      if (customData?.tipo === "mesa" && customData.mesaId) {
        mesasEnCanvas.add(customData.mesaId);
      }
    });

    // Solo añadir mesas nuevas, no eliminar ni recrear las existentes
    mesas.forEach((mesa) => {
      if (mesasEnCanvas.has(mesa.id)) return; // Ya existe en canvas
      
      let obj: FabricObject;

      if (mesa.forma === "circular") {
        obj = new Circle({
          left: mesa.pos_x,
          top: mesa.pos_y,
          radius: Math.min(mesa.ancho, mesa.alto) / 2,
          fill: "#dbeafe",
          stroke: "#3b82f6",
          strokeWidth: 2,
          originX: "left",
          originY: "top",
        });
      } else {
        obj = new Rect({
          left: mesa.pos_x,
          top: mesa.pos_y,
          width: mesa.ancho,
          height: mesa.alto,
          fill: "#dbeafe",
          stroke: "#3b82f6",
          strokeWidth: 2,
          rx: 6,
          ry: 6,
          originX: "left",
          originY: "top",
        });
      }

      (obj as any).customData = { 
        tipo: "mesa", 
        mesaId: mesa.id, 
        nombre: mesa.nombre,
        capacidad: mesa.capacidad 
      };

      fabricCanvas.add(obj);
    });

    // Eliminar mesas del canvas que ya no existen en la BD
    const mesaIds = new Set(mesas.map(m => m.id));
    fabricCanvas.getObjects().forEach((obj) => {
      const customData = (obj as any).customData;
      if (customData?.tipo === "mesa" && customData.mesaId && !mesaIds.has(customData.mesaId)) {
        fabricCanvas.remove(obj);
      }
    });

    fabricCanvas.renderAll();
  }, [fabricCanvas, mesas, loadingMesas]);

  // Sincronizar refs con estados
  useEffect(() => {
    isDrawingWallRef.current = isDrawingWall;
  }, [isDrawingWall]);
  
  useEffect(() => {
    wallStartRef.current = wallStart;
  }, [wallStart]);
  
  useEffect(() => {
    previewLineRef.current = previewLine;
  }, [previewLine]);
  
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  // Manejar dibujo de paredes arrastrando - usando refs para evitar recrear listeners
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleMouseDown = (opt: any) => {
      const pointer = fabricCanvas.getScenePoint(opt.e);
      const currentTool = activeToolRef.current;

      // Dibujar pared arrastrando
      if (currentTool === "wall") {
        isDrawingWallRef.current = true;
        setIsDrawingWall(true);
        wallStartRef.current = { x: pointer.x, y: pointer.y };
        setWallStart({ x: pointer.x, y: pointer.y });
        
        // Crear línea de preview
        const preview = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
          stroke: "#374151",
          strokeWidth: 8,
          strokeDashArray: [10, 5],
          selectable: false,
          evented: false,
          opacity: 0.6,
        });
        fabricCanvas.add(preview);
        previewLineRef.current = preview;
        setPreviewLine(preview);
        fabricCanvas.renderAll();
        return;
      }

      if (currentTool === "select") return;

      // Otros elementos se crean con un solo click
      if (currentTool === "rectangle") {
        const rect = new Rect({
          left: pointer.x - 50,
          top: pointer.y - 40,
          width: 100,
          height: 80,
          fill: "#e2e8f0",
          stroke: "#64748b",
          strokeWidth: 2,
        });
        (rect as any).customData = { tipo: "rectangle", id: `rect-${Date.now()}` };
        fabricCanvas.add(rect);
        setElementos(prev => [...prev, { id: `rect-${Date.now()}`, tipo: "rectangle" }]);
        setActiveTool("select");
      } else if (currentTool === "circle") {
        const circle = new Circle({
          left: pointer.x - 50,
          top: pointer.y - 50,
          radius: 50,
          fill: "#e2e8f0",
          stroke: "#64748b",
          strokeWidth: 2,
        });
        (circle as any).customData = { tipo: "circle", id: `circle-${Date.now()}` };
        fabricCanvas.add(circle);
        setElementos(prev => [...prev, { id: `circle-${Date.now()}`, tipo: "circle" }]);
        setActiveTool("select");
      } else if (currentTool === "polygon") {
        const points = [
          { x: 0, y: 60 },
          { x: 30, y: 0 },
          { x: 60, y: 60 },
        ];
        const polygon = new Polygon(points, {
          left: pointer.x - 30,
          top: pointer.y - 30,
          fill: "#e2e8f0",
          stroke: "#64748b",
          strokeWidth: 2,
        });
        (polygon as any).customData = { tipo: "polygon", id: `polygon-${Date.now()}` };
        fabricCanvas.add(polygon);
        setElementos(prev => [...prev, { id: `polygon-${Date.now()}`, tipo: "polygon" }]);
        setActiveTool("select");
      } else if (currentTool === "silla") {
        const silla = new Circle({
          left: pointer.x - 15,
          top: pointer.y - 15,
          radius: 15,
          fill: "#fde68a",
          stroke: "#d97706",
          strokeWidth: 2,
        });
        (silla as any).customData = { tipo: "silla", id: `silla-${Date.now()}` };
        fabricCanvas.add(silla);
        setElementos(prev => [...prev, { id: `silla-${Date.now()}`, tipo: "silla" }]);
      } else if (currentTool === "elemento") {
        const elem = new Rect({
          left: pointer.x - 20,
          top: pointer.y - 20,
          width: 40,
          height: 40,
          fill: "#94a3b8",
          stroke: "#475569",
          strokeWidth: 1,
          rx: 4,
          ry: 4,
        });
        (elem as any).customData = { tipo: "elemento", id: `elem-${Date.now()}` };
        fabricCanvas.add(elem);
        setElementos(prev => [...prev, { id: `elem-${Date.now()}`, tipo: "elemento" }]);
      }

      fabricCanvas.renderAll();
    };

    const handleMouseMove = (opt: any) => {
      if (!isDrawingWallRef.current || !wallStartRef.current || !previewLineRef.current) return;

      const pointer = fabricCanvas.getScenePoint(opt.e);
      
      // Actualizar la línea de preview
      previewLineRef.current.set({
        x2: pointer.x,
        y2: pointer.y,
      });
      fabricCanvas.renderAll();
    };

    const handleMouseUp = (opt: any) => {
      if (!isDrawingWallRef.current || !wallStartRef.current) return;

      const pointer = fabricCanvas.getScenePoint(opt.e);
      const currentWallStart = wallStartRef.current;
      
      // Eliminar línea de preview
      if (previewLineRef.current) {
        fabricCanvas.remove(previewLineRef.current);
        previewLineRef.current = null;
        setPreviewLine(null);
      }

      // Solo crear pared si hay suficiente distancia
      const distance = Math.sqrt(
        Math.pow(pointer.x - currentWallStart.x, 2) + Math.pow(pointer.y - currentWallStart.y, 2)
      );

      if (distance > 20) {
        const wall = new Line([currentWallStart.x, currentWallStart.y, pointer.x, pointer.y], {
          stroke: "#374151",
          strokeWidth: 8,
          selectable: true,
          hasControls: true,
          originX: "left",
          originY: "top",
        });
        // Mantener left/top en 0 para que las coordenadas sean absolutas
        wall.set({ left: 0, top: 0 });
        const wallId = `wall-${Date.now()}`;
        (wall as any).customData = { tipo: "wall", id: wallId };
        fabricCanvas.add(wall);
        setElementos(prev => [...prev, { id: wallId, tipo: "wall" }]);
      }

      isDrawingWallRef.current = false;
      setIsDrawingWall(false);
      wallStartRef.current = null;
      setWallStart(null);
      fabricCanvas.renderAll();
    };

    fabricCanvas.on("mouse:down", handleMouseDown);
    fabricCanvas.on("mouse:move", handleMouseMove);
    fabricCanvas.on("mouse:up", handleMouseUp);

    return () => {
      fabricCanvas.off("mouse:down", handleMouseDown);
      fabricCanvas.off("mouse:move", handleMouseMove);
      fabricCanvas.off("mouse:up", handleMouseUp);
    };
  }, [fabricCanvas]); // Solo depende de fabricCanvas para no recrear listeners

  // Guardar plano
  const handleSave = useCallback(async () => {
    if (!fabricCanvas) return;

    // Recopilar elementos del canvas (excepto mesas que se guardan aparte)
    const elementosCanvas: any[] = [];
    fabricCanvas.getObjects().forEach((obj) => {
      const customData = (obj as any).customData;
      if (!customData || customData.tipo === "mesa") return;

      const base = {
        id: customData.id,
        tipo: customData.tipo,
        left: obj.left,
        top: obj.top,
      };

      if (obj instanceof Line) {
        // Para líneas, guardar las coordenadas absolutas calculando la posición real
        const line = obj as Line;
        const matrix = line.calcTransformMatrix();
        const x1Abs = (line.x1 || 0);
        const y1Abs = (line.y1 || 0);
        const x2Abs = (line.x2 || 0);
        const y2Abs = (line.y2 || 0);
        
        elementosCanvas.push({
          ...base,
          x1: x1Abs,
          y1: y1Abs,
          x2: x2Abs,
          y2: y2Abs,
        });
      } else if (obj instanceof Rect) {
        elementosCanvas.push({
          ...base,
          width: obj.width,
          height: obj.height,
          fill: obj.fill,
        });
      } else if (obj instanceof Circle) {
        elementosCanvas.push({
          ...base,
          radius: obj.radius,
          fill: obj.fill,
        });
      } else if (obj instanceof Polygon) {
        elementosCanvas.push({
          ...base,
          points: (obj as Polygon).points,
          fill: obj.fill,
        });
      }
    });

    // Guardar posiciones de mesas actualizadas
    const mesasActualizadas: Array<Partial<Mesa> & { id: string }> = [];
    fabricCanvas.getObjects().forEach((obj) => {
      const customData = (obj as any).customData;
      if (customData?.tipo === "mesa" && customData.mesaId) {
        mesasActualizadas.push({
          id: customData.mesaId,
          pos_x: Math.round(obj.left || 0),
          pos_y: Math.round(obj.top || 0),
          ancho: Math.round(obj instanceof Circle ? (obj.radius || 40) * 2 : (obj.width || 80)),
          alto: Math.round(obj instanceof Circle ? (obj.radius || 40) * 2 : (obj.height || 60)),
        });
      }
    });

    try {
      // Guardar plano con escala y dimensiones
      await guardarPlano.mutateAsync({
        espacio_id: espacioId,
        ancho: canvasSize.width,
        alto: canvasSize.height,
        configuracion: {
          elementos: elementosCanvas,
          pixelsPerMeterX,
          pixelsPerMeterY,
          pixelsPerMeter, // Mantener para compatibilidad
          realDimensions,
          version: 3,
        },
      });

      // Actualizar posiciones de mesas
      if (mesasActualizadas.length > 0) {
        await actualizarMesas.mutateAsync(mesasActualizadas);
      }

      toast.success("Plano guardado correctamente");
    } catch (error) {
      console.error("Error al guardar:", error);
      toast.error("Error al guardar el plano");
    }
  }, [fabricCanvas, espacioId, canvasSize, pixelsPerMeter, realDimensions, guardarPlano, actualizarMesas]);

  // Calcular dimensiones de mesa según forma
  const getMesaDimensions = useCallback(() => {
    if (newMesa.forma === "circular") {
      // Diámetro para circular - convertir a píxeles (cm a píxeles usando escala)
      const pixelSize = (newMesa.diametro / 100) * pixelsPerMeter;
      return { ancho: Math.round(pixelSize), alto: Math.round(pixelSize) };
    } else if (newMesa.forma === "cuadrada") {
      // Cuadrada usa solo ancho
      const pixelSize = (newMesa.ancho / 100) * pixelsPerMeter;
      return { ancho: Math.round(pixelSize), alto: Math.round(pixelSize) };
    } else {
      // Rectangular: largo x ancho
      const pixelLargo = (newMesa.largo / 100) * pixelsPerMeter;
      const pixelAncho = (newMesa.ancho / 100) * pixelsPerMeter;
      return { ancho: Math.round(pixelLargo), alto: Math.round(pixelAncho) };
    }
  }, [newMesa, pixelsPerMeter]);

  // Añadir nueva mesa
  const handleAddMesa = async () => {
    if (!newMesa.nombre.trim()) {
      toast.error("Introduce un nombre para la mesa");
      return;
    }

    const dimensions = getMesaDimensions();

    try {
      await crearMesa.mutateAsync({
        espacio_id: espacioId,
        nombre: newMesa.nombre,
        capacidad: newMesa.capacidad,
        forma: newMesa.forma,
        ancho: dimensions.ancho,
        alto: dimensions.alto,
        pos_x: 100,
        pos_y: 100,
      });

      setNewMesa({ nombre: "", capacidad: 4, forma: "rectangular", largo: 120, ancho: 80, diametro: 100 });
    } catch (error) {
      console.error("Error al crear mesa:", error);
    }
  };

  // Copiar mesa seleccionada
  const handleCopyMesa = useCallback(() => {
    if (!selectedObject) return;
    const customData = (selectedObject as any).customData;
    if (customData?.tipo !== "mesa") {
      toast.error("Selecciona una mesa para copiar");
      return;
    }

    setCopiedMesa({
      nombre: customData.nombre || "Mesa copiada",
      capacidad: customData.capacidad || 4,
      forma: selectedObject instanceof Circle ? "circular" : "rectangular",
      ancho: selectedObject instanceof Circle ? (selectedObject.radius || 40) * 2 : (selectedObject.width || 80),
      alto: selectedObject instanceof Circle ? (selectedObject.radius || 40) * 2 : (selectedObject.height || 60),
    });
    toast.success("Mesa copiada al portapapeles");
  }, [selectedObject]);

  // Pegar mesa copiada
  const handlePasteMesa = async () => {
    if (!copiedMesa) {
      toast.error("No hay mesa copiada");
      return;
    }

    // Generar nombre único
    const existingNames = mesas.map(m => m.nombre);
    let newName = copiedMesa.nombre;
    let counter = 1;
    while (existingNames.includes(newName)) {
      newName = `${copiedMesa.nombre} (${counter})`;
      counter++;
    }

    try {
      await crearMesa.mutateAsync({
        espacio_id: espacioId,
        nombre: newName,
        capacidad: copiedMesa.capacidad,
        forma: copiedMesa.forma,
        ancho: copiedMesa.ancho,
        alto: copiedMesa.alto,
        pos_x: 150 + Math.random() * 50,
        pos_y: 150 + Math.random() * 50,
      });
      toast.success(`Mesa "${newName}" pegada`);
    } catch (error) {
      console.error("Error al pegar mesa:", error);
    }
  };

  // Actualizar longitud de pared seleccionada
  const handleUpdateWallLength = useCallback(() => {
    if (!fabricCanvas || !selectedObject || !(selectedObject instanceof Line)) return;
    
    const currentLine = selectedObject as Line;
    const x1 = currentLine.x1 || 0;
    const y1 = currentLine.y1 || 0;
    const x2 = currentLine.x2 || 0;
    const y2 = currentLine.y2 || 0;
    
    // Calcular ángulo actual
    const angle = Math.atan2(y2 - y1, x2 - x1);
    
    // Nueva longitud en píxeles
    const newLengthPixels = wallLength * pixelsPerMeter;
    
    // Calcular nuevo punto final manteniendo el ángulo
    const newX2 = x1 + Math.cos(angle) * newLengthPixels;
    const newY2 = y1 + Math.sin(angle) * newLengthPixels;
    
    currentLine.set({
      x2: newX2,
      y2: newY2,
    });
    
    fabricCanvas.renderAll();
    toast.success(`Pared ajustada a ${wallLength}m`);
  }, [fabricCanvas, selectedObject, wallLength, pixelsPerMeter]);


  // Eliminar objeto seleccionado
  const handleDeleteSelected = useCallback(() => {
    if (!fabricCanvas || !selectedObject) return;

    const customData = (selectedObject as any).customData;
    
    // Si es una mesa, eliminar de la base de datos
    if (customData?.tipo === "mesa" && customData.mesaId) {
      eliminarMesa.mutate(customData.mesaId);
    }

    fabricCanvas.remove(selectedObject);
    setSelectedObject(null);
    fabricCanvas.renderAll();
  }, [fabricCanvas, selectedObject, eliminarMesa]);

  // Convertir píxeles a metros
  const pixelsToMeters = useCallback((pixels: number) => {
    return (pixels / pixelsPerMeter).toFixed(2);
  }, [pixelsPerMeter]);

  // Convertir metros a píxeles
  const metersToPixels = useCallback((meters: number) => {
    return Math.round(meters * pixelsPerMeter);
  }, [pixelsPerMeter]);

  // Calcular longitud de una línea/pared
  const getWallLength = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    const pixels = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    return { pixels, meters: (pixels / pixelsPerMeter).toFixed(2) };
  }, [pixelsPerMeter]);

  // Efecto para actualizar wallLength cuando se selecciona una pared
  useEffect(() => {
    if (selectedObject instanceof Line) {
      const length = getWallLength(
        (selectedObject as Line).x1 || 0,
        (selectedObject as Line).y1 || 0,
        (selectedObject as Line).x2 || 0,
        (selectedObject as Line).y2 || 0
      );
      setWallLength(parseFloat(length.meters));
    }
  }, [selectedObject, getWallLength]);

  const applyRealDimensions = useCallback(() => {
    // Calcular la escala para que el espacio ocupe todo el canvas en ambos ejes
    const newPixelsPerMeterX = CANVAS_WIDTH / realDimensions.width;
    const newPixelsPerMeterY = CANVAS_HEIGHT / realDimensions.height;
    
    setPixelsPerMeterX(newPixelsPerMeterX);
    setPixelsPerMeterY(newPixelsPerMeterY);
    toast.success(`Escala ajustada: ${realDimensions.width}m × ${realDimensions.height}m`);
  }, [realDimensions]);

  // Limpiar todo el canvas
  const handleClearCanvas = useCallback(() => {
    if (!fabricCanvas) return;
    
    // Eliminar todos los objetos excepto mesas (que se eliminan de la BD)
    const objects = fabricCanvas.getObjects();
    objects.forEach((obj) => {
      const customData = (obj as any).customData;
      if (customData?.tipo === "mesa" && customData.mesaId) {
        eliminarMesa.mutate(customData.mesaId);
      }
      fabricCanvas.remove(obj);
    });
    
    setElementos([]);
    setSelectedObject(null);
    fabricCanvas.renderAll();
    toast.success("Canvas limpiado");
  }, [fabricCanvas, eliminarMesa]);

  // Exportar imagen
  const handleExportImage = useCallback(() => {
    if (!fabricCanvas) return;

    const dataURL = fabricCanvas.toDataURL({
      format: "png",
      quality: 1,
      multiplier: 2,
    });

    const link = document.createElement("a");
    link.download = `plano-${espacioNombre}-${new Date().toISOString().split("T")[0]}.png`;
    link.href = dataURL;
    link.click();

    toast.success("Imagen exportada");
  }, [fabricCanvas, espacioNombre]);

  if (loadingPlano || loadingMesas) {
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
            <h3 className="text-xl font-bold">Configurar: {espacioNombre}</h3>
            <p className="text-sm text-muted-foreground">
              Dibuja paredes, añade mesas y elementos decorativos
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportImage}>
            <Download className="mr-2 h-4 w-4" />
            Exportar
          </Button>
          <Button onClick={handleSave} disabled={guardarPlano.isPending}>
            <Save className="mr-2 h-4 w-4" />
            Guardar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* Canvas principal */}
        <Card>
          <CardContent className="p-4">
            {/* Barra de herramientas */}
            <div className="flex flex-wrap gap-2 mb-4 p-2 bg-muted rounded-lg">
              <Button
                variant={activeTool === "select" ? "default" : "ghost"}
                size="sm"
                onClick={() => { setActiveTool("select"); setWallStart(null); }}
              >
                <MousePointer className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="h-8" />
              <Button
                variant={activeTool === "wall" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTool("wall")}
                title="Dibujar pared"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Button
                variant={activeTool === "rectangle" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTool("rectangle")}
                title="Rectángulo/Área"
              >
                <Square className="h-4 w-4" />
              </Button>
              <Button
                variant={activeTool === "circle" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTool("circle")}
                title="Círculo"
              >
                <CircleIcon className="h-4 w-4" />
              </Button>
              <Button
                variant={activeTool === "polygon" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTool("polygon")}
                title="Esquina/Triángulo"
              >
                <Triangle className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="h-8" />
              <Button
                variant={activeTool === "silla" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTool("silla")}
                title="Silla"
              >
                <Armchair className="h-4 w-4" />
              </Button>
              <Button
                variant={activeTool === "elemento" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTool("elemento")}
                title="Elemento decorativo"
              >
                <Move className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="h-8" />
              
              {/* Dibujo a mano alzada */}
              <Button
                variant={activeTool === "freehand" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTool("freehand")}
                title="Dibujar perímetro a mano alzada"
                className={activeTool === "freehand" ? "bg-orange-500 hover:bg-orange-600" : ""}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              {freehandPoints.length > 0 && (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={processWithAI}
                    disabled={isProcessingAI}
                    title="Convertir dibujo en paredes rectas con IA"
                    className="bg-purple-500 hover:bg-purple-600"
                  >
                    {isProcessingAI ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4" />
                    )}
                    <span className="ml-1 text-xs">IA</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFreehand}
                    title="Borrar dibujo"
                  >
                    <Trash2 className="h-4 w-4 text-orange-500" />
                  </Button>
                </>
              )}
              
              <Separator orientation="vertical" className="h-8" />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteSelected}
                disabled={!selectedObject}
                title="Eliminar seleccionado"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearCanvas}
                title="Limpiar todo"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="h-8" />
              <Button
                variant={showMeasurements ? "default" : "ghost"}
                size="sm"
                onClick={() => setShowMeasurements(!showMeasurements)}
                title="Mostrar/ocultar medidas"
              >
                <Ruler className="h-4 w-4" />
              </Button>
            </div>

            {/* Instrucciones */}
            {activeTool === "wall" && (
              <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
                Arrastra para dibujar una pared. Las medidas se mostrarán automáticamente.
              </div>
            )}
            
            {activeTool === "freehand" && (
              <div className="mb-2 p-2 bg-orange-50 border border-orange-200 rounded text-sm text-orange-800">
                <strong>Modo perímetro:</strong> Dibuja el contorno del espacio a mano alzada. 
                Luego pulsa el botón <Wand2 className="inline h-4 w-4" /> para convertirlo en paredes rectas con IA.
                {freehandPoints.length > 0 && (
                  <span className="ml-2 font-mono">({freehandPoints.length} puntos capturados)</span>
                )}
              </div>
            )}

            {/* Canvas con medidas - Tamaño fijo, escala ajustable */}
            <div 
              ref={canvasContainerRef}
              className="relative border-2 border-dashed border-border rounded-lg bg-white overflow-hidden"
            >
              {/* Contenedor con reglas externas al canvas */}
              <div className="flex flex-col">
                {/* Regla horizontal (superior) - fuera del canvas */}
                <div 
                  className="relative h-6 bg-muted/80 border-b flex items-end pointer-events-none" 
                  style={{ marginLeft: showMeasurements ? 24 : 0, visibility: showMeasurements ? 'visible' : 'hidden' }}
                >
                  {Array.from({ length: Math.ceil(realDimensions.width) + 1 }).map((_, i) => (
                    <div
                      key={i}
                      className="absolute flex flex-col items-center"
                      style={{ left: i * pixelsPerMeterX }}
                    >
                      <span className="text-[10px] text-muted-foreground font-mono">{i}m</span>
                      <div className="w-px h-2 bg-muted-foreground/50" />
                    </div>
                  ))}
                </div>
                
                <div className="flex">
                  {/* Regla vertical (izquierda) - fuera del canvas */}
                  <div 
                    className="relative w-6 bg-muted/80 border-r flex flex-col pointer-events-none" 
                    style={{ height: canvasSize.height, visibility: showMeasurements ? 'visible' : 'hidden' }}
                  >
                    {Array.from({ length: Math.ceil(realDimensions.height) + 1 }).map((_, i) => (
                      <div
                        key={i}
                        className="absolute flex items-center"
                        style={{ top: i * pixelsPerMeterY }}
                      >
                        <div className="h-px w-2 bg-muted-foreground/50" />
                        <span className="text-[10px] text-muted-foreground font-mono ml-1">{i}m</span>
                      </div>
                    ))}
                  </div>
                  
                  {/* Canvas de dibujo - dimensiones explícitas */}
                  <div className="relative" style={{ width: canvasSize.width, height: canvasSize.height }}>
                    <canvas ref={canvasRef} />
                    
                    {/* Indicador de dimensiones reales */}
                    {showMeasurements && (
                      <div className="absolute bottom-2 right-2 px-2 py-1 bg-background/90 border rounded text-xs font-mono">
                        {realDimensions.width}m × {realDimensions.height}m
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Configuración de escala y tamaño */}
            <div className="mt-4 p-3 bg-muted/50 rounded-lg space-y-3">
              <div className="flex items-center gap-2">
                <Ruler className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Escala y Dimensiones</span>
              </div>
              
              <div className="text-xs text-muted-foreground mb-3">
                Escala: {Math.round(pixelsPerMeterX)}px/m (ancho) × {Math.round(pixelsPerMeterY)}px/m (alto)
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Ancho (m)</Label>
                  <Input
                    type="number"
                    value={realDimensions.width}
                    onChange={(e) => setRealDimensions(prev => ({ ...prev, width: parseFloat(e.target.value) || 9 }))}
                    step={0.5}
                    min={1}
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Alto (m)</Label>
                  <Input
                    type="number"
                    value={realDimensions.height}
                    onChange={(e) => setRealDimensions(prev => ({ ...prev, height: parseFloat(e.target.value) || 6 }))}
                    step={0.5}
                    min={1}
                    className="h-8"
                  />
                </div>
                <div className="flex items-end">
                  <Button size="sm" variant="secondary" onClick={applyRealDimensions} className="w-full h-8">
                    Aplicar
                  </Button>
                </div>
              </div>

              <div className="text-xs text-muted-foreground mt-2">
                {realDimensions.width}m × {realDimensions.height}m representados en {canvasSize.width}px × {canvasSize.height}px
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Panel lateral */}
        <div className="space-y-4">
          {/* Escala rápida */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Ruler className="h-4 w-4" />
                Elemento Seleccionado
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {selectedObject ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-muted-foreground">Tipo:</span>
                      <p className="font-medium capitalize">{(selectedObject as any).customData?.tipo || "elemento"}</p>
                    </div>
                    {(selectedObject as any).customData?.nombre && (
                      <div>
                        <span className="text-muted-foreground">Nombre:</span>
                        <p className="font-medium">{(selectedObject as any).customData.nombre}</p>
                      </div>
                    )}
                  </div>
                  
                  {/* Editar dimensiones según tipo */}
                  {selectedObject instanceof Line ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Longitud de pared:</p>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          value={wallLength}
                          onChange={(e) => setWallLength(parseFloat(e.target.value) || 0)}
                          step={0.1}
                          min={0.1}
                          className="h-8"
                        />
                        <span className="flex items-center text-sm text-muted-foreground">m</span>
                        <Button size="sm" variant="secondary" onClick={handleUpdateWallLength} className="h-8">
                          Aplicar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2 bg-muted rounded">
                      <p className="text-xs text-muted-foreground mb-1">Dimensiones:</p>
                      <p className="font-mono text-sm">
                        {pixelsToMeters(selectedObject.width || 0)}m × {pixelsToMeters(selectedObject.height || 0)}m
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {/* Botón copiar si es mesa */}
                    {(selectedObject as any).customData?.tipo === "mesa" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyMesa}
                        className="flex-1"
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Copiar
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDeleteSelected}
                      className="flex-1"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Eliminar
                    </Button>
                  </div>
                </>
              ) : (
              <p className="text-muted-foreground">Selecciona un elemento para ver sus medidas</p>
              )}
            </CardContent>
          </Card>

          {/* Añadir mesa */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Añadir Mesa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Nombre</Label>
                <Input
                  value={newMesa.nombre}
                  onChange={(e) => setNewMesa({ ...newMesa, nombre: e.target.value })}
                  placeholder="Mesa 1"
                  className="h-8"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Capacidad</Label>
                  <Input
                    type="number"
                    value={newMesa.capacidad}
                    onChange={(e) => setNewMesa({ ...newMesa, capacidad: parseInt(e.target.value) || 4 })}
                    min={1}
                    max={20}
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Forma</Label>
                  <Select
                    value={newMesa.forma}
                    onValueChange={(v) => setNewMesa({ ...newMesa, forma: v as "rectangular" | "circular" | "cuadrada" })}
                  >
                    <SelectTrigger className="h-8">
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
              
              {/* Dimensiones según forma */}
              {newMesa.forma === "circular" ? (
                <div>
                  <Label className="text-xs">Diámetro (cm)</Label>
                  <Input
                    type="number"
                    value={newMesa.diametro}
                    onChange={(e) => setNewMesa({ ...newMesa, diametro: parseInt(e.target.value) || 100 })}
                    min={40}
                    className="h-8"
                  />
                </div>
              ) : newMesa.forma === "cuadrada" ? (
                <div>
                  <Label className="text-xs">Lado (cm)</Label>
                  <Input
                    type="number"
                    value={newMesa.ancho}
                    onChange={(e) => setNewMesa({ ...newMesa, ancho: parseInt(e.target.value) || 80 })}
                    min={40}
                    className="h-8"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Largo (cm)</Label>
                    <Input
                      type="number"
                      value={newMesa.largo}
                      onChange={(e) => setNewMesa({ ...newMesa, largo: parseInt(e.target.value) || 120 })}
                      min={40}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Ancho (cm)</Label>
                    <Input
                      type="number"
                      value={newMesa.ancho}
                      onChange={(e) => setNewMesa({ ...newMesa, ancho: parseInt(e.target.value) || 80 })}
                      min={40}
                      className="h-8"
                    />
                  </div>
                </div>
              )}
              
              <Button size="sm" onClick={handleAddMesa} className="w-full" disabled={crearMesa.isPending}>
                <Plus className="mr-2 h-4 w-4" />
                Añadir Mesa
              </Button>

              {/* Copiar/Pegar mesas */}
              {copiedMesa && (
                <Button size="sm" variant="outline" onClick={handlePasteMesa} className="w-full">
                  <Clipboard className="mr-2 h-4 w-4" />
                  Pegar "{copiedMesa.nombre}"
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Lista de mesas */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Mesas del espacio</CardTitle>
            </CardHeader>
            <CardContent>
              {mesas.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay mesas configuradas</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {mesas.map((mesa) => (
                    <div
                      key={mesa.id}
                      className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          <Users className="h-3 w-3 mr-1" />
                          {mesa.capacidad}
                        </Badge>
                        <span>{mesa.nombre}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => eliminarMesa.mutate(mesa.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Objeto seleccionado */}
          {selectedObject && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Elemento seleccionado</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Tipo:</span>{" "}
                  {(selectedObject as any).customData?.tipo || "elemento"}
                </p>
                {(selectedObject as any).customData?.nombre && (
                  <p>
                    <span className="text-muted-foreground">Nombre:</span>{" "}
                    {(selectedObject as any).customData.nombre}
                  </p>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteSelected}
                  className="w-full mt-2"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Leyenda */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Leyenda</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-blue-200 border-2 border-blue-500 rounded" />
                <span>Mesa</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-gray-700" />
                <span>Pared</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-yellow-200 border-2 border-amber-500 rounded-full" />
                <span>Silla</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-slate-400 border border-slate-600 rounded" />
                <span>Elemento</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
