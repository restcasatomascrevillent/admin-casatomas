import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { Canvas as FabricCanvas, Rect, Circle, Line, FabricObject } from "fabric";
import { ToolType } from "./ToolbarDibujo";
import { ElementoCanvas, MesaCanvas } from "./EditorPlanoEspacio";
import { Mesa } from "@/hooks/useMesas";

interface CanvasPlanoProps {
  width: number;
  height: number;
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
}

export const CanvasPlano = forwardRef<CanvasPlanoRef, CanvasPlanoProps>(({
  width,
  height,
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
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  
  // Refs para mantener valores actualizados en event handlers
  const activeToolRef = useRef(activeTool);
  const elementosRef = useRef(elementos);
  const mesasCanvasRef = useRef(mesasCanvas);
  const wallPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const tempLinesRef = useRef<Line[]>([]);
  const previewLineRef = useRef<Line | null>(null);

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
    }
  }), [fabricCanvas]);

  // Inicializar canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width,
      height,
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
  }, [width, height]);

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
      const x = i * pixelsPerMeterX;
      const isMajor = i % 5 === 0;
      const line = new Line([x, 0, x, height], {
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
      const y = i * pixelsPerMeterY;
      const isMajor = i % 5 === 0;
      const line = new Line([0, y, width, y], {
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
  }, [fabricCanvas, pixelsPerMeterX, pixelsPerMeterY, realDimensions, width, height]);

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
    const ancho = 80;
    const alto = forma === "circular" ? 80 : 60;

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
      capacidad: forma === "circular" ? 6 : 4,
      isNew: true,
    };

    fabricCanvas.add(obj);
    fabricCanvas.setActiveObject(obj);
    fabricCanvas.renderAll();

    const newMesa: MesaCanvas = {
      id,
      nombre: mesaName,
      capacidad: forma === "circular" ? 6 : 4,
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
    <div className="relative p-4">
      {/* Regla horizontal */}
      <div className="absolute top-0 left-12 right-4 h-8 bg-gradient-to-b from-muted/80 to-muted/40 backdrop-blur-sm rounded-t-lg flex items-end text-[10px] text-muted-foreground overflow-hidden border-b border-border/30">
        {Array.from({ length: Math.ceil(realDimensions.width) + 1 }).map((_, i) => (
          <div
            key={i}
            className="absolute flex flex-col items-center"
            style={{ left: i * pixelsPerMeterX }}
          >
            <span className="font-medium">{i}m</span>
            <div className="w-px h-2 bg-muted-foreground/40" />
          </div>
        ))}
      </div>

      {/* Regla vertical */}
      <div className="absolute top-8 left-0 bottom-4 w-10 bg-gradient-to-r from-muted/80 to-muted/40 backdrop-blur-sm rounded-l-lg flex flex-col text-[10px] text-muted-foreground overflow-hidden border-r border-border/30">
        {Array.from({ length: Math.ceil(realDimensions.height) + 1 }).map((_, i) => (
          <div
            key={i}
            className="absolute flex items-center gap-1"
            style={{ top: i * pixelsPerMeterY }}
          >
            <span className="w-7 text-right font-medium">{i}m</span>
            <div className="h-px w-2 bg-muted-foreground/40" />
          </div>
        ))}
      </div>

      {/* Canvas container con sombra */}
      <div className="ml-10 mt-8 rounded-lg overflow-hidden shadow-lg ring-1 ring-border/20">
        <canvas ref={canvasRef} id="plano-canvas" className="block" />
      </div>
    </div>
  );
});

CanvasPlano.displayName = "CanvasPlano";
