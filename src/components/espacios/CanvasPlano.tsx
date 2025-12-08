import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Canvas as FabricCanvas, Rect, Circle, Line, FabricObject, FabricText, Group } from "fabric";
import { ToolType } from "./ToolbarDibujo";
import { ElementoCanvas, MesaCanvas } from "./EditorPlanoEspacio";
import { Mesa } from "@/hooks/useMesas";
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
  
  const measureTextRef = useRef<FabricText | null>(null);
  
  // Función para redondear a 5cm (0.05m)
  const roundTo5cm = (meters: number) => Math.round(meters * 20) / 20;
  
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
  const wasCleared = useRef(false); // Flag para evitar recargar después de limpiar
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
      
      // Marcar que fue limpiado para evitar recargar mesas de BD
      wasCleared.current = true;
      
      // Limpiar refs internos para evitar que se recarguen
      elementosRef.current = [];
      mesasCanvasRef.current = [];
      wallPointsRef.current = [];
      tempLinesRef.current = [];
      
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

  // Resetear flag de limpieza cuando cambia el planoConfig (cambio de espacio)
  useEffect(() => {
    wasCleared.current = false;
  }, [planoConfig]);

  // Cargar elementos (de planoConfig al inicio, o del estado local cuando el canvas se recrea)
  useEffect(() => {
    if (!fabricCanvas) return;
    
    // Si fue limpiado, no cargar elementos de planoConfig
    if (wasCleared.current && elementosRef.current.length === 0) {
      return;
    }

    // Verificar qué elementos ya están en el canvas
    const elementosEnCanvas = new Set<string>();
    fabricCanvas.getObjects().forEach((obj) => {
      const customData = (obj as any).customData;
      if (customData?.id && customData?.tipo !== "mesa") {
        elementosEnCanvas.add(customData.id);
      }
    });

    // Priorizar elementos del estado local, si no hay y no fue limpiado, usar planoConfig
    const elementosACargar = elementosRef.current.length > 0 
      ? elementosRef.current 
      : (wasCleared.current ? [] : (planoConfig?.elementos || []));

    elementosACargar.forEach((elem: any) => {
      // Saltar si ya está en el canvas
      if (elementosEnCanvas.has(elem.id)) return;
      
      switch (elem.tipo) {
        case "wall":
          createWallWithDimension(fabricCanvas, elem, effectivePixelsPerMeterX, effectivePixelsPerMeterY);
          break;
        case "area":
          const area = new Rect({
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
          (area as any).customData = { tipo: elem.tipo, id: elem.id };
          fabricCanvas.add(area);
          break;
        case "door":
          const door = new Rect({
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
          (door as any).customData = { tipo: elem.tipo, id: elem.id };
          fabricCanvas.add(door);
          break;
      }
    });

    // Solo actualizar estado si cargamos desde planoConfig y el estado está vacío
    if (!wasCleared.current && elementosRef.current.length === 0 && planoConfig?.elementos?.length > 0) {
      onElementosChange(planoConfig.elementos.map((e: any) => ({ id: e.id, tipo: e.tipo, props: e.props || e })));
    }
    
    fabricCanvas.renderAll();
  }, [fabricCanvas, planoConfig]);

  // Función helper para crear mesa con etiqueta
  const createMesaWithLabel = (
    canvas: FabricCanvas,
    mesa: { id: string; nombre: string; capacidad: number; forma: string; ancho: number; alto: number; posX: number; posY: number },
    pxPerMeterX: number,
    pxPerMeterY: number
  ) => {
    // Convertir dimensiones de cm a metros para mostrar
    const anchoM = (mesa.ancho / 100).toFixed(2);
    const altoM = (mesa.alto / 100).toFixed(2);
    const dimensionText = mesa.forma === "circular" 
      ? `Ø${anchoM}m` 
      : `${anchoM}x${altoM}m`;

    let shape: FabricObject;

    if (mesa.forma === "circular") {
      shape = new Circle({
        left: 0,
        top: 0,
        radius: mesa.ancho / 2,
        fill: "#dbeafe",
        stroke: "#2563eb",
        strokeWidth: 2,
        originX: "center",
        originY: "center",
      });
    } else {
      shape = new Rect({
        left: -mesa.ancho / 2,
        top: -mesa.alto / 2,
        width: mesa.ancho,
        height: mesa.alto,
        fill: "#dbeafe",
        stroke: "#2563eb",
        strokeWidth: 2,
        rx: 6,
        ry: 6,
        originX: "left",
        originY: "top",
      });
    }

    const nameLabel = new FabricText(mesa.nombre, {
      left: 0,
      top: -8,
      fontSize: 11,
      fontFamily: "system-ui, sans-serif",
      fontWeight: "bold",
      fill: "#1e40af",
      originX: "center",
      originY: "center",
    });

    const dimLabel = new FabricText(dimensionText, {
      left: 0,
      top: 8,
      fontSize: 9,
      fontFamily: "system-ui, sans-serif",
      fill: "#64748b",
      originX: "center",
      originY: "center",
    });

    const group = new Group([shape, nameLabel, dimLabel], {
      left: mesa.posX + mesa.ancho / 2,
      top: mesa.posY + mesa.alto / 2,
      originX: "center",
      originY: "center",
      shadow: {
        color: "rgba(0,0,0,0.1)",
        blur: 8,
        offsetX: 2,
        offsetY: 2,
      } as any,
    });

    (group as any).customData = {
      tipo: "mesa",
      id: mesa.id,
      nombre: mesa.nombre,
      capacidad: mesa.capacidad,
    };

    canvas.add(group);
  };

  // Función helper para crear pared con cota
  const createWallWithDimension = (
    canvas: FabricCanvas,
    elem: any,
    pxPerMeterX: number,
    pxPerMeterY: number
  ) => {
    const x1 = elem.props?.x1 || elem.x1 || 0;
    const y1 = elem.props?.y1 || elem.y1 || 0;
    const x2 = elem.props?.x2 || elem.x2 || 0;
    const y2 = elem.props?.y2 || elem.y2 || 0;

    const wall = new Line([x1, y1, x2, y2], {
      stroke: "#1f2937",
      strokeWidth: 10,
      strokeLineCap: "round",
      selectable: true,
      hasControls: true,
    });

    // Calcular longitud en metros
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthPx = Math.sqrt(dx * dx + dy * dy);
    const avgPxPerMeter = (pxPerMeterX + pxPerMeterY) / 2;
    const lengthM = roundTo5cm(lengthPx / avgPxPerMeter);

    // Punto medio para la cota
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    // Calcular ángulo para orientar el texto
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    // Offset perpendicular a la pared para la cota
    const offsetDist = 18;
    const perpAngle = (angle + 90) * (Math.PI / 180);
    const offsetX = Math.cos(perpAngle) * offsetDist;
    const offsetY = Math.sin(perpAngle) * offsetDist;

    const dimText = new FabricText(`${lengthM.toFixed(2)}m`, {
      left: midX + offsetX,
      top: midY + offsetY,
      fontSize: 10,
      fontFamily: "system-ui, sans-serif",
      fontWeight: "600",
      fill: "#374151",
      backgroundColor: "rgba(255,255,255,0.85)",
      padding: 2,
      originX: "center",
      originY: "center",
      angle: angle > 90 || angle < -90 ? angle + 180 : angle,
      selectable: false,
      evented: false,
    });

    (wall as any).customData = { tipo: "wall", id: elem.id };
    (dimText as any).customData = { tipo: "wall-dim", wallId: elem.id };
    (dimText as any).isWallDimension = true;

    canvas.add(wall);
    canvas.add(dimText);
  };

  // Cargar mesas (de BD o del estado local cuando el canvas se recrea)
  useEffect(() => {
    if (!fabricCanvas) return;
    
    // Si fue limpiado manualmente, no recargar mesas de BD, pero sí permitir el canvas
    const skipDBMesas = wasCleared.current;

    const mesasEnCanvas = new Set<string>();
    fabricCanvas.getObjects().forEach((obj) => {
      const customData = (obj as any).customData;
      if (customData?.tipo === "mesa") {
        mesasEnCanvas.add(customData.id);
      }
    });

    // Combinar mesas de BD y del estado local
    const mesasLocales = mesasCanvasRef.current;
    const newMesasCanvas: MesaCanvas[] = [];

    // Primero cargar mesas del estado local (tienen prioridad)
    mesasLocales.forEach((mesa) => {
      if (mesasEnCanvas.has(mesa.id)) return;
      createMesaWithLabel(fabricCanvas, mesa, effectivePixelsPerMeterX, effectivePixelsPerMeterY);
      mesasEnCanvas.add(mesa.id);
    });

    // Luego cargar mesas de BD que no estén ya en el estado local (solo si no fue limpiado)
    if (!skipDBMesas) {
      mesasDB?.forEach((mesa) => {
        // Verificar si ya existe en el canvas O en el estado local
        if (mesasEnCanvas.has(mesa.id)) return;
        if (mesasLocales.some(m => m.id === mesa.id)) return;

        const mesaData = {
          id: mesa.id,
          nombre: mesa.nombre,
          capacidad: mesa.capacidad,
          forma: mesa.forma as "rectangular" | "circular",
          ancho: mesa.ancho || 80,
          alto: mesa.alto || 60,
          posX: mesa.pos_x || 50,
          posY: mesa.pos_y || 50,
        };

        createMesaWithLabel(fabricCanvas, mesaData, effectivePixelsPerMeterX, effectivePixelsPerMeterY);
        mesasEnCanvas.add(mesa.id);

        newMesasCanvas.push(mesaData);
      });

      if (newMesasCanvas.length > 0) {
        onMesasChange([...mesasCanvasRef.current, ...newMesasCanvas]);
      }
    }

    fabricCanvas.renderAll();
  }, [fabricCanvas, mesasDB, effectivePixelsPerMeterX, effectivePixelsPerMeterY]);

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
    
    // Calcular longitud en metros (redondeada a 5cm)
    const dx = x - lastPoint.x;
    const dy = y - lastPoint.y;
    const lengthPx = Math.sqrt(dx * dx + dy * dy);
    const lengthM = roundTo5cm(lengthPx / ((pixelsPerMeterXRef.current + pixelsPerMeterYRef.current) / 2));
    
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

    // Crear paredes permanentes con cotas
    const currentElementos = elementosRef.current;
    const newElementos: ElementoCanvas[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const id = `wall-${Date.now()}-${i}`;
      const elem: ElementoCanvas = {
        id,
        tipo: "wall" as const,
        props: {
          x1: points[i].x,
          y1: points[i].y,
          x2: points[i + 1].x,
          y2: points[i + 1].y,
        },
      };
      
      createWallWithDimension(fabricCanvas, elem, effectivePixelsPerMeterX, effectivePixelsPerMeterY);
      newElementos.push(elem);
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

    fabricCanvas.renderAll();
    onToolChange("select");
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

    const currentMesas = mesasCanvasRef.current;
    const mesaName = `Mesa ${currentMesas.length + 1}`;

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

    createMesaWithLabel(fabricCanvas, newMesa, effectivePixelsPerMeterX, effectivePixelsPerMeterY);
    fabricCanvas.renderAll();

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
          
        </div>
      </div>
    </div>
  );
});

CanvasPlano.displayName = "CanvasPlano";
