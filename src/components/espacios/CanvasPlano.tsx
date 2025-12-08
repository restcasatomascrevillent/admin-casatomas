import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Canvas as FabricCanvas, Rect, Circle, Line, FabricObject, FabricText } from "fabric";
import { ToolType } from "./ToolbarDibujo";
import { ElementoCanvas, MesaCanvas } from "./EditorPlanoEspacio";
import { Mesa } from "@/hooks/useMesas";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

interface CanvasPlanoProps {
  containerWidth: number;
  containerHeight: number;
  activeTool: ToolType;
  elementos: ElementoCanvas[];
  mesasCanvas: MesaCanvas[];
  mesasDB: Mesa[];
  pixelsPerMeterX: number;
  pixelsPerMeterY: number;
  realDimensions: { width: number; height: number };
  planoConfig: any;
  selectedElement: any;
  onElementosChange: (elementos: ElementoCanvas[]) => void;
  onMesasChange: (mesas: MesaCanvas[]) => void;
  onSelectionChange: (element: any) => void;
  onToolChange: (tool: ToolType) => void;
}

export interface CanvasPlanoRef {
  clearCanvas: () => void;
  removeElement: (id: string) => void;
  getCanvas: () => HTMLCanvasElement | null;
}

export const CanvasPlano = forwardRef<CanvasPlanoRef, CanvasPlanoProps>(({
  containerWidth,
  containerHeight,
  activeTool,
  elementos,
  mesasCanvas,
  mesasDB,
  pixelsPerMeterX,
  pixelsPerMeterY,
  realDimensions,
  planoConfig,
  selectedElement,
  onElementosChange,
  onMesasChange,
  onSelectionChange,
  onToolChange,
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  
  // Estado para medición en vivo
  const [liveWallMeasure, setLiveWallMeasure] = useState<{
    length: number;
    x: number;
    y: number;
    inputValue: string;
  } | null>(null);
  const measureTextRef = useRef<FabricText | null>(null);
  
  // Dimensiones calculadas del canvas
  const RULER_SIZE = 40;
  const PADDING = 16;
  const canvasWidth = Math.max(400, containerWidth - RULER_SIZE - PADDING * 2);
  const canvasHeight = Math.max(300, containerHeight - RULER_SIZE - PADDING * 2);
  
  // Recalcular pixels por metro basado en tamaño del canvas
  const effectivePixelsPerMeterX = canvasWidth / realDimensions.width;
  const effectivePixelsPerMeterY = canvasHeight / realDimensions.height;
  
  // Refs para mantener valores actualizados en event handlers
  const activeToolRef = useRef(activeTool);
  const elementosRef = useRef(elementos);
  const mesasCanvasRef = useRef(mesasCanvas);
  const wallPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const tempLinesRef = useRef<Line[]>([]);
  const previewLineRef = useRef<Line | null>(null);
  const pixelsPerMeterXRef = useRef(effectivePixelsPerMeterX);
  const pixelsPerMeterYRef = useRef(effectivePixelsPerMeterY);

  // Sincronizar refs
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    elementosRef.current = elementos;
  }, [elementos]);

  useEffect(() => {
    mesasCanvasRef.current = mesasCanvas;
  }, [mesasCanvas]);
  
  useEffect(() => {
    pixelsPerMeterXRef.current = effectivePixelsPerMeterX;
    pixelsPerMeterYRef.current = effectivePixelsPerMeterY;
  }, [effectivePixelsPerMeterX, effectivePixelsPerMeterY]);

  // Exponer métodos al padre
  useImperativeHandle(ref, () => ({
    clearCanvas: () => {
      if (!fabricCanvas) return;
      
      // Eliminar todo excepto el grid
      const objectsToRemove = fabricCanvas.getObjects().filter(obj => !(obj as any).isGrid);
      objectsToRemove.forEach(obj => fabricCanvas.remove(obj));
      fabricCanvas.renderAll();
    },
    removeElement: (id: string) => {
      if (!fabricCanvas) return;
      
      const obj = fabricCanvas.getObjects().find(o => (o as any).customData?.id === id);
      if (obj) {
        fabricCanvas.remove(obj);
        fabricCanvas.discardActiveObject();
        fabricCanvas.renderAll();
      }
    },
    getCanvas: () => canvasRef.current
  }), [fabricCanvas]);

  // Inicializar canvas - se recrea cuando cambian las dimensiones
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: canvasWidth,
      height: canvasHeight,
      backgroundColor: "#ffffff",
      selection: true,
    });

    // Event handlers
    canvas.on("selection:created", (e) => {
      const obj = e.selected?.[0];
      if (obj) {
        const customData = (obj as any).customData;
        onSelectionChange(customData || null);
      }
    });

    canvas.on("selection:updated", (e) => {
      const obj = e.selected?.[0];
      if (obj) {
        const customData = (obj as any).customData;
        onSelectionChange(customData || null);
      }
    });

    canvas.on("selection:cleared", () => {
      onSelectionChange(null);
    });

    canvas.on("object:modified", (e) => {
      const obj = e.target;
      if (!obj) return;
      
      const customData = (obj as any).customData;
      if (customData?.tipo === "mesa") {
        const currentMesas = mesasCanvasRef.current;
        onMesasChange(
          currentMesas.map((m) =>
            m.id === customData.id
              ? { ...m, posX: obj.left || 0, posY: obj.top || 0 }
              : m
          )
        );
      }
    });

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [canvasWidth, canvasHeight]);

  // Dibujar grid con estilo mejorado
  useEffect(() => {
    if (!fabricCanvas) return;

    // Limpiar grid anterior
    fabricCanvas.getObjects().forEach((obj) => {
      if ((obj as any).isGrid) {
        fabricCanvas.remove(obj);
      }
    });

    // Colores del grid
    const gridColorLight = "#f1f5f9";
    const gridColorMedium = "#e2e8f0";
    const gridColorStrong = "#cbd5e1";
    
    // Líneas verticales
    for (let i = 0; i <= realDimensions.width; i++) {
      const x = i * effectivePixelsPerMeterX;
      const isMajor = i % 5 === 0;
      const line = new Line([x, 0, x, canvasHeight], {
        stroke: isMajor ? gridColorStrong : (i % 1 === 0 ? gridColorMedium : gridColorLight),
        strokeWidth: isMajor ? 1.5 : 0.5,
        selectable: false,
        evented: false,
      });
      (line as any).isGrid = true;
      fabricCanvas.add(line);
      fabricCanvas.sendObjectToBack(line);
    }

    // Líneas horizontales
    for (let i = 0; i <= realDimensions.height; i++) {
      const y = i * effectivePixelsPerMeterY;
      const isMajor = i % 5 === 0;
      const line = new Line([0, y, canvasWidth, y], {
        stroke: isMajor ? gridColorStrong : (i % 1 === 0 ? gridColorMedium : gridColorLight),
        strokeWidth: isMajor ? 1.5 : 0.5,
        selectable: false,
        evented: false,
      });
      (line as any).isGrid = true;
      fabricCanvas.add(line);
      fabricCanvas.sendObjectToBack(line);
    }

    fabricCanvas.renderAll();
  }, [fabricCanvas, effectivePixelsPerMeterX, effectivePixelsPerMeterY, realDimensions, canvasWidth, canvasHeight]);

  // Cargar elementos guardados
  useEffect(() => {
    if (!fabricCanvas || !planoConfig?.elementos) return;

    // Cargar elementos
    planoConfig.elementos.forEach((elem: any) => {
      let obj: FabricObject | null = null;

      switch (elem.tipo) {
        case "wall":
          obj = new Line([elem.props?.x1 || elem.x1 || 0, elem.props?.y1 || elem.y1 || 0, elem.props?.x2 || elem.x2 || 0, elem.props?.y2 || elem.y2 || 0], {
            stroke: "#1f2937",
            strokeWidth: 10,
            strokeLineCap: "round",
            selectable: true,
            hasControls: true,
          });
          break;
        case "area":
          obj = new Rect({
            left: elem.props?.left || elem.left,
            top: elem.props?.top || elem.top,
            width: elem.props?.width || elem.width,
            height: elem.props?.height || elem.height,
            fill: "rgba(59, 130, 246, 0.08)",
            stroke: "#3b82f6",
            strokeWidth: 2,
            strokeDashArray: [8, 4],
            rx: 4,
            ry: 4,
          });
          break;
        case "door":
          obj = new Rect({
            left: elem.props?.left || elem.left,
            top: elem.props?.top || elem.top,
            width: elem.props?.width || elem.width || 60,
            height: elem.props?.height || elem.height || 12,
            fill: "#fef3c7",
            stroke: "#d97706",
            strokeWidth: 2,
            rx: 2,
            ry: 2,
          });
          break;
      }

      if (obj) {
        (obj as any).customData = { tipo: elem.tipo, id: elem.id };
        fabricCanvas.add(obj);
      }
    });

    onElementosChange(planoConfig.elementos.map((e: any) => ({ id: e.id, tipo: e.tipo, props: e.props || e })));
    fabricCanvas.renderAll();
  }, [fabricCanvas, planoConfig]);

  // Cargar mesas de la BD
  useEffect(() => {
    if (!fabricCanvas || !mesasDB) return;

    const mesasEnCanvas = new Set<string>();
    fabricCanvas.getObjects().forEach((obj) => {
      const customData = (obj as any).customData;
      if (customData?.tipo === "mesa") {
        mesasEnCanvas.add(customData.id);
      }
    });

    const newMesasCanvas: MesaCanvas[] = [];

    mesasDB.forEach((mesa) => {
      if (mesasEnCanvas.has(mesa.id)) return;

      let obj: FabricObject;

      if (mesa.forma === "circular") {
        obj = new Circle({
          left: mesa.pos_x || 50,
          top: mesa.pos_y || 50,
          radius: Math.min(mesa.ancho || 60, mesa.alto || 60) / 2,
          fill: "#dbeafe",
          stroke: "#2563eb",
          strokeWidth: 2,
          originX: "left",
          originY: "top",
          shadow: {
            color: "rgba(0,0,0,0.1)",
            blur: 8,
            offsetX: 2,
            offsetY: 2,
          } as any,
        });
      } else {
        obj = new Rect({
          left: mesa.pos_x || 50,
          top: mesa.pos_y || 50,
          width: mesa.ancho || 80,
          height: mesa.alto || 60,
          fill: "#dbeafe",
          stroke: "#2563eb",
          strokeWidth: 2,
          rx: 6,
          ry: 6,
          originX: "left",
          originY: "top",
          shadow: {
            color: "rgba(0,0,0,0.1)",
            blur: 8,
            offsetX: 2,
            offsetY: 2,
          } as any,
        });
      }

      (obj as any).customData = {
        tipo: "mesa",
        id: mesa.id,
        nombre: mesa.nombre,
        capacidad: mesa.capacidad,
      };

      fabricCanvas.add(obj);

      newMesasCanvas.push({
        id: mesa.id,
        nombre: mesa.nombre,
        capacidad: mesa.capacidad,
        forma: mesa.forma as "rectangular" | "circular",
        ancho: mesa.ancho || 80,
        alto: mesa.alto || 60,
        posX: mesa.pos_x || 50,
        posY: mesa.pos_y || 50,
      });
    });

    if (newMesasCanvas.length > 0) {
      onMesasChange([...mesasCanvasRef.current, ...newMesasCanvas]);
    }

    fabricCanvas.renderAll();
  }, [fabricCanvas, mesasDB]);

  // Manejar clics según la herramienta activa
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleMouseDown = (opt: any) => {
      const pointer = fabricCanvas.getViewportPoint(opt.e);
      const tool = activeToolRef.current;

      if (tool === "wall") {
        handleWallClick(pointer.x, pointer.y);
      } else if (tool === "area") {
        handleAreaClick(pointer.x, pointer.y);
      } else if (tool === "mesa-rect") {
        handleMesaClick(pointer.x, pointer.y, "rectangular");
      } else if (tool === "mesa-circular") {
        handleMesaClick(pointer.x, pointer.y, "circular");
      } else if (tool === "door") {
        handleDoorClick(pointer.x, pointer.y);
      }
    };

    const handleMouseMove = (opt: any) => {
      if (activeToolRef.current !== "wall" || wallPointsRef.current.length === 0) return;
      
      const pointer = fabricCanvas.getViewportPoint(opt.e);
      updatePreviewLine(pointer.x, pointer.y);
    };

    const handleDblClick = () => {
      if (activeToolRef.current === "wall") {
        finishWallDrawing();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelWallDrawing();
      }
    };

    fabricCanvas.on("mouse:down", handleMouseDown);
    fabricCanvas.on("mouse:move", handleMouseMove);
    fabricCanvas.on("mouse:dblclick", handleDblClick);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      fabricCanvas.off("mouse:down", handleMouseDown);
      fabricCanvas.off("mouse:move", handleMouseMove);
      fabricCanvas.off("mouse:dblclick", handleDblClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fabricCanvas]);

  // Funciones de dibujo
  const handleWallClick = (x: number, y: number) => {
    if (!fabricCanvas) return;

    const points = wallPointsRef.current;
    
    if (points.length > 0) {
      const lastPoint = points[points.length - 1];
      const line = new Line([lastPoint.x, lastPoint.y, x, y], {
        stroke: "#1f2937",
        strokeWidth: 10,
        strokeLineCap: "round",
        selectable: false,
        evented: false,
      });
      (line as any).isTemp = true;
      tempLinesRef.current.push(line);
      fabricCanvas.add(line);
    }

    wallPointsRef.current = [...points, { x, y }];
    fabricCanvas.renderAll();
  };

  const updatePreviewLine = (x: number, y: number) => {
    if (!fabricCanvas) return;
    
    const points = wallPointsRef.current;
    if (points.length === 0) return;

    const lastPoint = points[points.length - 1];

    if (previewLineRef.current) {
      fabricCanvas.remove(previewLineRef.current);
    }
    
    // Limpiar texto de medida anterior
    if (measureTextRef.current) {
      fabricCanvas.remove(measureTextRef.current);
    }

    const preview = new Line([lastPoint.x, lastPoint.y, x, y], {
      stroke: "#6b7280",
      strokeWidth: 6,
      strokeDashArray: [8, 4],
      strokeLineCap: "round",
      selectable: false,
      evented: false,
    });

    previewLineRef.current = preview;
    fabricCanvas.add(preview);
    
    // Calcular longitud en metros
    const dx = x - lastPoint.x;
    const dy = y - lastPoint.y;
    const lengthPx = Math.sqrt(dx * dx + dy * dy);
    const lengthM = lengthPx / ((pixelsPerMeterXRef.current + pixelsPerMeterYRef.current) / 2);
    
    // Posición del texto (punto medio de la línea)
    const midX = (lastPoint.x + x) / 2;
    const midY = (lastPoint.y + y) / 2;
    
    // Crear texto con la medida
    const measureText = new FabricText(`${lengthM.toFixed(2)}m`, {
      left: midX,
      top: midY - 20,
      fontSize: 14,
      fontFamily: "system-ui, sans-serif",
      fontWeight: "bold",
      fill: "#1f2937",
      backgroundColor: "rgba(255,255,255,0.9)",
      padding: 4,
      selectable: false,
      evented: false,
      originX: "center",
      originY: "center",
    });
    
    measureTextRef.current = measureText;
    fabricCanvas.add(measureText);
    
    // Actualizar estado para mostrar input
    setLiveWallMeasure({
      length: lengthM,
      x: midX,
      y: midY,
      inputValue: lengthM.toFixed(2),
    });
    
    fabricCanvas.renderAll();
  };

  const finishWallDrawing = () => {
    if (!fabricCanvas) return;

    const points = wallPointsRef.current;
    if (points.length < 2) {
      cancelWallDrawing();
      return;
    }

    // Convertir líneas temporales en permanentes
    tempLinesRef.current.forEach((line) => {
      fabricCanvas.remove(line);
    });

    // Crear paredes permanentes
    const currentElementos = elementosRef.current;
    const newElementos: ElementoCanvas[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const id = `wall-${Date.now()}-${i}`;
      const wall = new Line([points[i].x, points[i].y, points[i + 1].x, points[i + 1].y], {
        stroke: "#1f2937",
        strokeWidth: 10,
        strokeLineCap: "round",
        selectable: true,
        hasControls: true,
      });
      (wall as any).customData = { tipo: "wall", id };
      fabricCanvas.add(wall);
      
      newElementos.push({
        id,
        tipo: "wall",
        props: {
          x1: points[i].x,
          y1: points[i].y,
          x2: points[i + 1].x,
          y2: points[i + 1].y,
        },
      });
    }

    onElementosChange([...currentElementos, ...newElementos]);

    // Limpiar
    if (previewLineRef.current) {
      fabricCanvas.remove(previewLineRef.current);
      previewLineRef.current = null;
    }
    if (measureTextRef.current) {
      fabricCanvas.remove(measureTextRef.current);
      measureTextRef.current = null;
    }
    tempLinesRef.current = [];
    wallPointsRef.current = [];
    setLiveWallMeasure(null);

    fabricCanvas.renderAll();
    onToolChange("select");
  };
  
  // Aplicar medida personalizada desde input
  const applyCustomMeasure = (newLengthM: number) => {
    if (!fabricCanvas || !liveWallMeasure) return;
    
    const points = wallPointsRef.current;
    if (points.length === 0) return;
    
    const lastPoint = points[points.length - 1];
    const avgPixelsPerMeter = (pixelsPerMeterXRef.current + pixelsPerMeterYRef.current) / 2;
    const newLengthPx = newLengthM * avgPixelsPerMeter;
    
    // Obtener el ángulo actual de la línea preview
    if (previewLineRef.current) {
      const x2 = previewLineRef.current.x2 || 0;
      const y2 = previewLineRef.current.y2 || 0;
      const dx = x2 - lastPoint.x;
      const dy = y2 - lastPoint.y;
      const angle = Math.atan2(dy, dx);
      
      // Calcular nuevo punto final
      const newX = lastPoint.x + Math.cos(angle) * newLengthPx;
      const newY = lastPoint.y + Math.sin(angle) * newLengthPx;
      
      // Actualizar preview
      updatePreviewLine(newX, newY);
    }
  };

  const cancelWallDrawing = () => {
    if (!fabricCanvas) return;

    tempLinesRef.current.forEach((line) => fabricCanvas.remove(line));
    if (previewLineRef.current) {
      fabricCanvas.remove(previewLineRef.current);
      previewLineRef.current = null;
    }
    if (measureTextRef.current) {
      fabricCanvas.remove(measureTextRef.current);
      measureTextRef.current = null;
    }
    tempLinesRef.current = [];
    wallPointsRef.current = [];
    setLiveWallMeasure(null);
    fabricCanvas.renderAll();
  };

  const handleAreaClick = (x: number, y: number) => {
    if (!fabricCanvas) return;

    const id = `area-${Date.now()}`;
    const area = new Rect({
      left: x - 60,
      top: y - 60,
      width: 120,
      height: 120,
      fill: "rgba(59, 130, 246, 0.08)",
      stroke: "#3b82f6",
      strokeWidth: 2,
      strokeDashArray: [8, 4],
      rx: 4,
      ry: 4,
    });

    (area as any).customData = { tipo: "area", id };
    fabricCanvas.add(area);
    fabricCanvas.setActiveObject(area);
    fabricCanvas.renderAll();

    const currentElementos = elementosRef.current;
    onElementosChange([...currentElementos, { id, tipo: "area", props: { left: x - 60, top: y - 60, width: 120, height: 120 } }]);
    onToolChange("select");
  };

  const handleMesaClick = (x: number, y: number, forma: "rectangular" | "circular") => {
    if (!fabricCanvas) return;

    const id = `mesa-temp-${Date.now()}`;
    // Dimensiones estándar: 80x80cm rectangular, 150cm diámetro circular
    const ancho = forma === "circular" ? 150 : 80;
    const alto = forma === "circular" ? 150 : 80;
    const capacidad = forma === "circular" ? 6 : 2;

    let obj: FabricObject;

    if (forma === "circular") {
      obj = new Circle({
        left: x - ancho / 2,
        top: y - alto / 2,
        radius: ancho / 2,
        fill: "#dbeafe",
        stroke: "#2563eb",
        strokeWidth: 2,
        originX: "left",
        originY: "top",
        shadow: {
          color: "rgba(0,0,0,0.1)",
          blur: 8,
          offsetX: 2,
          offsetY: 2,
        } as any,
      });
    } else {
      obj = new Rect({
        left: x - ancho / 2,
        top: y - alto / 2,
        width: ancho,
        height: alto,
        fill: "#dbeafe",
        stroke: "#2563eb",
        strokeWidth: 2,
        rx: 6,
        ry: 6,
        originX: "left",
        originY: "top",
        shadow: {
          color: "rgba(0,0,0,0.1)",
          blur: 8,
          offsetX: 2,
          offsetY: 2,
        } as any,
      });
    }

    const currentMesas = mesasCanvasRef.current;
    const mesaName = `Mesa ${currentMesas.length + 1}`;

    (obj as any).customData = {
      tipo: "mesa",
      id,
      nombre: mesaName,
      capacidad,
      isNew: true,
    };

    fabricCanvas.add(obj);
    fabricCanvas.setActiveObject(obj);
    fabricCanvas.renderAll();

    const newMesa: MesaCanvas = {
      id,
      nombre: mesaName,
      capacidad,
      forma,
      ancho,
      alto,
      posX: x - ancho / 2,
      posY: y - alto / 2,
    };

    onMesasChange([...currentMesas, newMesa]);
    onToolChange("select");
  };

  const handleDoorClick = (x: number, y: number) => {
    if (!fabricCanvas) return;

    const id = `door-${Date.now()}`;
    const door = new Rect({
      left: x - 35,
      top: y - 6,
      width: 70,
      height: 12,
      fill: "#fef3c7",
      stroke: "#d97706",
      strokeWidth: 2,
      rx: 2,
      ry: 2,
    });

    (door as any).customData = { tipo: "door", id };
    fabricCanvas.add(door);
    fabricCanvas.setActiveObject(door);
    fabricCanvas.renderAll();

    const currentElementos = elementosRef.current;
    onElementosChange([...currentElementos, { id, tipo: "door", props: { left: x - 35, top: y - 6, width: 70, height: 12 } }]);
    onToolChange("select");
  };

  return (
    <div ref={containerRef} className="relative w-full h-full flex flex-col">
      {/* Regla horizontal */}
      <div 
        className="relative h-8 bg-gradient-to-b from-muted/80 to-muted/40 backdrop-blur-sm text-[10px] text-muted-foreground overflow-hidden border-b border-border/30 rounded-t-lg"
        style={{ marginLeft: RULER_SIZE }}
      >
        {Array.from({ length: Math.ceil(realDimensions.width) + 1 }).map((_, i) => (
          <div
            key={i}
            className="absolute flex flex-col items-center"
            style={{ left: i * effectivePixelsPerMeterX, transform: 'translateX(-50%)' }}
          >
            <span className="font-medium">{i}m</span>
            <div className="w-px h-2 bg-muted-foreground/40" />
          </div>
        ))}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Regla vertical */}
        <div 
          className="relative bg-gradient-to-r from-muted/80 to-muted/40 backdrop-blur-sm text-[10px] text-muted-foreground overflow-hidden border-r border-border/30 rounded-l-lg"
          style={{ width: RULER_SIZE }}
        >
          {Array.from({ length: Math.ceil(realDimensions.height) + 1 }).map((_, i) => (
            <div
              key={i}
              className="absolute flex items-center gap-1"
              style={{ top: i * effectivePixelsPerMeterY, transform: 'translateY(-50%)' }}
            >
              <span className="w-7 text-right font-medium">{i}m</span>
              <div className="h-px w-2 bg-muted-foreground/40" />
            </div>
          ))}
        </div>

        {/* Canvas container */}
        <div className="flex-1 relative rounded-br-lg overflow-hidden shadow-lg ring-1 ring-border/20 bg-white">
          <canvas ref={canvasRef} id="plano-canvas" className="block" />
          
          {/* Input de medida en vivo para paredes */}
          {liveWallMeasure && activeTool === "wall" && (
            <div 
              className="absolute z-10 flex items-center gap-1 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border p-1.5"
              style={{ 
                left: Math.min(liveWallMeasure.x, canvasWidth - 150), 
                top: Math.max(liveWallMeasure.y - 50, 10) 
              }}
            >
              <Input
                type="number"
                step="0.01"
                min="0.1"
                value={liveWallMeasure.inputValue}
                onChange={(e) => setLiveWallMeasure({ ...liveWallMeasure, inputValue: e.target.value })}
                className="w-20 h-7 text-sm text-center"
                placeholder="m"
              />
              <span className="text-xs text-muted-foreground">m</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => {
                  const val = parseFloat(liveWallMeasure.inputValue);
                  if (!isNaN(val) && val > 0) {
                    applyCustomMeasure(val);
                  }
                }}
              >
                <Check className="h-3 w-3 text-green-600" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setLiveWallMeasure(null)}
              >
                <X className="h-3 w-3 text-red-500" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

CanvasPlano.displayName = "CanvasPlano";
