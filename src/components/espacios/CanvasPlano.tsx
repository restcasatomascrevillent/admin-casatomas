import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import * as fabric from "fabric";
import { Canvas as FabricCanvas, Rect, Circle, Line, FabricObject, FabricText, Point } from "fabric";
import { ToolType } from "./ToolbarDibujo";
import { ElementoCanvas, MesaCanvas } from "./EditorPlanoEspacio";
import { Mesa } from "@/hooks/useMesas";

interface CanvasPlanoProps {
  pixelsPerMeter: number;
  activeTool: ToolType;
  elementos: ElementoCanvas[];
  mesasCanvas: MesaCanvas[];
  mesasDB: Mesa[];
  realDimensions: { width: number; height: number };
  containerSize: { width: number; height: number };
  planoConfig: any;
  selectedElement: any;
  initialZoom?: number;
  showMeasurements?: boolean;
  onElementosChange: (elementos: ElementoCanvas[]) => void;
  onMesasChange: (mesas: MesaCanvas[]) => void;
  onSelectionChange: (element: any) => void;
  onToolChange: (tool: ToolType) => void;
  onZoomChange?: (zoom: number) => void;
}

export interface CanvasPlanoRef {
  clearCanvas: () => void;
  removeElement: (id: string) => void;
  getCanvas: () => HTMLCanvasElement | null;
  setZoom: (zoom: number) => void;
  resetView: () => void;
  unmergeMesa: (mesaId: string) => void;
  autoFit: () => void;
}

export const CanvasPlano = forwardRef<CanvasPlanoRef, CanvasPlanoProps>(({
  pixelsPerMeter,
  activeTool,
  elementos,
  mesasCanvas,
  mesasDB,
  realDimensions,
  containerSize,
  planoConfig,
  selectedElement,
  initialZoom = 1,
  showMeasurements = true,
  onElementosChange,
  onMesasChange,
  onSelectionChange,
  onToolChange,
  onZoomChange,
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const spacePressed = useRef(false);
  const lastPanPos = useRef({ x: 0, y: 0 });
  
  const measureTextRef = useRef<FabricText | null>(null);
  
  // Función para redondear a 5cm (0.05m)
  const roundTo5cm = (meters: number) => Math.round(meters * 20) / 20;
  
  // Dimensiones lógicas del plano (para el grid y los objetos)
  const logicalWidth = realDimensions.width * pixelsPerMeter;
  const logicalHeight = realDimensions.height * pixelsPerMeter;
  
  // Estado interno para el tamaño real del canvas basado en el contenedor
  const [internalSize, setInternalSize] = useState({ width: 800, height: 500 });
  
  // El canvas usa el tamaño interno del contenedor para llenar todo el espacio
  const canvasWidth = internalSize.width > 0 ? internalSize.width : (containerSize.width > 0 ? containerSize.width : logicalWidth);
  const canvasHeight = internalSize.height > 0 ? internalSize.height : (containerSize.height > 0 ? containerSize.height : logicalHeight);
  
  // Refs para mantener valores actualizados en event handlers
  const activeToolRef = useRef(activeTool);
  const elementosRef = useRef(elementos);
  const mesasCanvasRef = useRef(mesasCanvas);
  const wallPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const tempLinesRef = useRef<Line[]>([]);
  const previewLineRef = useRef<Line | null>(null);
  const pixelsPerMeterRef = useRef(pixelsPerMeter);
  const alignmentGuidesRef = useRef<Line[]>([]); // Guías de alineación
  const mesasInitializedRef = useRef(false); // Para controlar si las mesas ya fueron cargadas inicialmente

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
    pixelsPerMeterRef.current = pixelsPerMeter;
  }, [pixelsPerMeter]);

  // ResizeObserver para que el canvas ocupe todo el contenedor
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        if (width > 50 && height > 50) {
          setInternalSize({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });
    
    resizeObserver.observe(containerRef.current);
    
    // Medir inmediatamente
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 50 && rect.height > 50) {
      setInternalSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    }
    
    return () => resizeObserver.disconnect();
  }, []);

  // Mostrar/ocultar cotas (medidas de paredes) cuando cambie showMeasurements
  useEffect(() => {
    if (!fabricCanvas) return;
    
    fabricCanvas.getObjects().forEach((obj) => {
      if ((obj as any).isCota) {
        obj.visible = showMeasurements;
      }
    });
    
    fabricCanvas.renderAll();
  }, [showMeasurements, fabricCanvas]);

  // Exponer métodos al padre
  useImperativeHandle(ref, () => ({
    clearCanvas: () => {
      if (!fabricCanvas) return;
      
      // Eliminar TODO excepto el grid - paredes, mesas, puertas, áreas, cotas, etiquetas
      const objectsToRemove = fabricCanvas.getObjects().filter(obj => !(obj as any).isGrid);
      objectsToRemove.forEach(obj => fabricCanvas.remove(obj));
      
      // Limpiar refs internos
      tempLinesRef.current = [];
      wallPointsRef.current = [];
      if (previewLineRef.current) {
        previewLineRef.current = null;
      }
      if (measureTextRef.current) {
        measureTextRef.current = null;
      }
      
      // Limpiar estados
      elementosRef.current = [];
      mesasCanvasRef.current = [];
      onElementosChange([]);
      onMesasChange([]);
      
      fabricCanvas.renderAll();
    },
    removeElement: (id: string) => {
      if (!fabricCanvas) return;
      
      // Eliminar el objeto y sus etiquetas asociadas
      const objectsToRemove = fabricCanvas.getObjects().filter(o => {
        const customData = (o as any).customData;
        return customData?.id === id || customData?.parentId === id;
      });
      objectsToRemove.forEach(obj => fabricCanvas.remove(obj));
      fabricCanvas.discardActiveObject();
      fabricCanvas.renderAll();
    },
    getCanvas: () => canvasRef.current,
    setZoom: (zoom: number) => {
      if (!fabricCanvas) return;
      const clampedZoom = Math.max(0.25, Math.min(3, zoom));
      fabricCanvas.setZoom(clampedZoom);
      fabricCanvas.renderAll();
      onZoomChange?.(clampedZoom);
    },
    resetView: () => {
      if (!fabricCanvas) return;
      fabricCanvas.setViewportTransform([initialZoom, 0, 0, initialZoom, 0, 0]);
      fabricCanvas.renderAll();
      onZoomChange?.(initialZoom);
    },
    unmergeMesa: (mesaId: string) => {
      if (!fabricCanvas) return;
      
      const mesaAgrupada = mesasCanvasRef.current.find(m => m.id === mesaId);
      if (!mesaAgrupada || !mesaAgrupada.isMerged || !mesaAgrupada.originalMesas) return;
      
      // Eliminar la mesa agrupada del canvas
      const objectsToRemove = fabricCanvas.getObjects().filter(o => {
        const customData = (o as any).customData;
        return customData?.id === mesaId || customData?.parentId === mesaId;
      });
      objectsToRemove.forEach(obj => fabricCanvas.remove(obj));
      
      // Recrear las mesas originales
      const baseX = mesaAgrupada.posX * pixelsPerMeterRef.current;
      const baseY = mesaAgrupada.posY * pixelsPerMeterRef.current;
      
      const newMesas: typeof mesasCanvasRef.current = [];
      let offsetX = 0;
      
      mesaAgrupada.originalMesas.forEach((originalMesa, index) => {
        const anchoPixels = originalMesa.ancho / 100 * pixelsPerMeterRef.current;
        const altoPixels = originalMesa.alto / 100 * pixelsPerMeterRef.current;
        
        const posXPixels = baseX + offsetX;
        const posYPixels = baseY;
        
        let obj: FabricObject;
        
        if (originalMesa.forma === "circular") {
          const radiusPixels = Math.min(anchoPixels, altoPixels) / 2;
          obj = new Circle({
            left: posXPixels,
            top: posYPixels,
            radius: radiusPixels,
            fill: "#dbeafe",
            stroke: "#2563eb",
            strokeWidth: 2,
            originX: "left",
            originY: "top",
            hasControls: false,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            shadow: {
              color: "rgba(0,0,0,0.1)",
              blur: 8,
              offsetX: 2,
              offsetY: 2,
            } as any,
          });
        } else {
          obj = new Rect({
            left: posXPixels,
            top: posYPixels,
            width: anchoPixels,
            height: altoPixels,
            fill: "#dbeafe",
            stroke: "#2563eb",
            strokeWidth: 2,
            rx: 6,
            ry: 6,
            originX: "left",
            originY: "top",
            hasControls: false,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            shadow: {
              color: "rgba(0,0,0,0.1)",
              blur: 8,
              offsetX: 2,
              offsetY: 2,
            } as any,
          });
        }
        
        const newId = `mesa-temp-${Date.now()}-${index}`;
        
        (obj as any).customData = {
          tipo: "mesa",
          id: newId,
          nombre: originalMesa.nombre,
          capacidad: originalMesa.capacidad,
        };
        
        fabricCanvas.add(obj);
        
        // Crear etiqueta
        const anchoM = (originalMesa.ancho / 100).toFixed(2);
        const altoM = (originalMesa.alto / 100).toFixed(2);
        const dimensionText = originalMesa.forma === "circular" ? `Ø${anchoM}m` : `${anchoM}x${altoM}m`;
        
        const centerX = posXPixels + anchoPixels / 2;
        const centerY = posYPixels + altoPixels / 2;
        
        const minDimension = Math.min(anchoPixels, altoPixels);
        const fontSize = Math.max(5, Math.min(10, minDimension / 8));
        
        const label = new FabricText(`${originalMesa.nombre}\n${dimensionText}`, {
          left: centerX,
          top: centerY,
          fontSize: fontSize,
          fontFamily: "system-ui, sans-serif",
          fontWeight: "600",
          fill: "#1e40af",
          textAlign: "center",
          selectable: false,
          evented: false,
          originX: "center",
          originY: "center",
        });
        
        (label as any).customData = { tipo: "mesa-label", parentId: newId };
        (label as any).isMesaLabel = true;
        fabricCanvas.add(label);
        
        // Añadir al array de nuevas mesas
        newMesas.push({
          id: newId,
          nombre: originalMesa.nombre,
          capacidad: originalMesa.capacidad,
          forma: originalMesa.forma,
          ancho: originalMesa.ancho,
          alto: originalMesa.alto,
          posX: posXPixels / pixelsPerMeterRef.current,
          posY: posYPixels / pixelsPerMeterRef.current,
        });
        
        offsetX += anchoPixels + 20; // Separar las mesas un poco
      });
      
      // Actualizar estado
      const updatedMesas = mesasCanvasRef.current
        .filter(m => m.id !== mesaId)
        .concat(newMesas);
      
      onMesasChange(updatedMesas);
      fabricCanvas.discardActiveObject();
      fabricCanvas.renderAll();
    },
    autoFit: () => {
      if (!fabricCanvas) return;
      
      // Obtener todos los objetos dibujados (excepto grid, guías, labels y cotas)
      const objects = fabricCanvas.getObjects().filter(obj => 
        !(obj as any).isGrid && 
        !(obj as any).isAlignmentGuide &&
        !(obj as any).isMesaLabel &&
        !(obj as any).isCota
      );
      
      if (objects.length === 0) {
        // Si no hay objetos, resetear vista
        fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        fabricCanvas.renderAll();
        onZoomChange?.(1);
        return;
      }
      
      // Primero resetear el viewport para obtener coordenadas absolutas
      const currentVpt = fabricCanvas.viewportTransform?.slice() || [1, 0, 0, 1, 0, 0];
      fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      
      // Calcular bounding box de todos los objetos usando coordenadas absolutas
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      
      objects.forEach(obj => {
        // Usar las propiedades directas del objeto para coordenadas absolutas
        const left = obj.left || 0;
        const top = obj.top || 0;
        
        // Para líneas (paredes), usar x1, y1, x2, y2
        if ((obj as any).x1 !== undefined) {
          const line = obj as any;
          minX = Math.min(minX, line.x1, line.x2);
          minY = Math.min(minY, line.y1, line.y2);
          maxX = Math.max(maxX, line.x1, line.x2);
          maxY = Math.max(maxY, line.y1, line.y2);
        } else {
          // Para rectángulos y círculos
          const width = (obj as any).width || (obj as any).radius * 2 || 0;
          const height = (obj as any).height || (obj as any).radius * 2 || 0;
          
          minX = Math.min(minX, left);
          minY = Math.min(minY, top);
          maxX = Math.max(maxX, left + width);
          maxY = Math.max(maxY, top + height);
        }
      });
      
      // Verificar que tenemos bounds válidos
      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
        // Restaurar viewport anterior si no hay bounds válidos
        fabricCanvas.setViewportTransform(currentVpt as any);
        fabricCanvas.renderAll();
        return;
      }
      
      // Añadir padding
      const padding = 60;
      minX -= padding;
      minY -= padding;
      maxX += padding;
      maxY += padding;
      
      const contentWidth = maxX - minX;
      const contentHeight = maxY - minY;
      const contentCenterX = minX + contentWidth / 2;
      const contentCenterY = minY + contentHeight / 2;
      
      // Calcular zoom para que quepa todo
      const zoomX = canvasWidth / contentWidth;
      const zoomY = canvasHeight / contentHeight;
      const zoom = Math.min(zoomX, zoomY, 3); // Limitar a 3x máximo
      const clampedZoom = Math.max(0.25, zoom);
      
      // Calcular offset para centrar
      const canvasCenterX = canvasWidth / 2;
      const canvasCenterY = canvasHeight / 2;
      const offsetX = canvasCenterX - contentCenterX * clampedZoom;
      const offsetY = canvasCenterY - contentCenterY * clampedZoom;
      
      // Aplicar transformación
      fabricCanvas.setViewportTransform([clampedZoom, 0, 0, clampedZoom, offsetX, offsetY]);
      fabricCanvas.renderAll();
      onZoomChange?.(clampedZoom);
    }
  }), [fabricCanvas, onElementosChange, onMesasChange, initialZoom, onZoomChange, canvasWidth, canvasHeight]);

  // Función para obtener color de nivel según ángulo de pared
  const getWallLevelColor = (angle: number): string => {
    // Normalizar ángulo a 0-90 (considerando simetría)
    const normalizedAngle = Math.abs(angle % 90);
    const deviation = Math.min(normalizedAngle, 90 - normalizedAngle);
    
    // Verde: exactamente 0°, Amarillo: <1°, Naranja: 1-3°, Rojo: > 3°
    if (deviation === 0) return "#22c55e"; // Verde - exactamente recto
    if (deviation < 1) return "#eab308"; // Amarillo - casi recto
    if (deviation < 3) return "#f97316"; // Naranja - desviado
    return "#ef4444"; // Rojo - muy desviado
  };

  // Función para limpiar guías de alineación
  const clearAlignmentGuides = (canvas: FabricCanvas) => {
    alignmentGuidesRef.current.forEach(guide => canvas.remove(guide));
    alignmentGuidesRef.current = [];
  };

  // Función para detectar y agrupar mesas cercanas
  const checkAndMergeTables = (canvas: FabricCanvas, movedMesa: FabricObject) => {
    const movedData = (movedMesa as any).customData;
    if (movedData?.tipo !== "mesa") return;

    const MERGE_THRESHOLD = 15; // píxeles de proximidad para fusionar

    const movedLeft = movedMesa.left || 0;
    const movedTop = movedMesa.top || 0;
    const movedWidth = (movedMesa as any).width || (movedMesa as any).radius * 2 || 0;
    const movedHeight = (movedMesa as any).height || (movedMesa as any).radius * 2 || 0;
    const movedRight = movedLeft + movedWidth;
    const movedBottom = movedTop + movedHeight;

    // Buscar mesa cercana con la que fusionar
    let mesaToMerge: FabricObject | null = null;
    let mergeDirection: "horizontal" | "vertical" | null = null;

    canvas.getObjects().forEach(obj => {
      const objData = (obj as any).customData;
      if (!objData || objData.tipo !== "mesa" || objData.id === movedData.id) return;

      const objLeft = obj.left || 0;
      const objTop = obj.top || 0;
      const objWidth = (obj as any).width || (obj as any).radius * 2 || 0;
      const objHeight = (obj as any).height || (obj as any).radius * 2 || 0;
      const objRight = objLeft + objWidth;
      const objBottom = objTop + objHeight;

      // Verificar si están adyacentes horizontalmente (lado a lado)
      const horizontallyAdjacent = 
        Math.abs(movedRight - objLeft) < MERGE_THRESHOLD || 
        Math.abs(movedLeft - objRight) < MERGE_THRESHOLD;
      
      const verticalOverlap = 
        (movedTop < objBottom && movedBottom > objTop);

      // Verificar si están adyacentes verticalmente (uno encima del otro)
      const verticallyAdjacent = 
        Math.abs(movedBottom - objTop) < MERGE_THRESHOLD || 
        Math.abs(movedTop - objBottom) < MERGE_THRESHOLD;
      
      const horizontalOverlap = 
        (movedLeft < objRight && movedRight > objLeft);

      if (horizontallyAdjacent && verticalOverlap) {
        mesaToMerge = obj;
        mergeDirection = "horizontal";
      } else if (verticallyAdjacent && horizontalOverlap) {
        mesaToMerge = obj;
        mergeDirection = "vertical";
      }
    });

    if (!mesaToMerge || !mergeDirection) return;

    const mergeData = (mesaToMerge as any).customData;
    
    // Obtener datos de ambas mesas
    const mesa1 = mesasCanvasRef.current.find(m => m.id === movedData.id);
    const mesa2 = mesasCanvasRef.current.find(m => m.id === mergeData.id);
    
    if (!mesa1 || !mesa2) return;

    // Calcular nuevas dimensiones y capacidad
    const newCapacidad = mesa1.capacidad + mesa2.capacidad;
    let newAncho = mesa1.ancho;
    let newAlto = mesa1.alto;
    
    if (mergeDirection === "horizontal") {
      newAncho = mesa1.ancho + mesa2.ancho;
      newAlto = Math.max(mesa1.alto, mesa2.alto);
    } else {
      newAncho = Math.max(mesa1.ancho, mesa2.ancho);
      newAlto = mesa1.alto + mesa2.alto;
    }

    // Calcular nueva posición (esquina superior izquierda del grupo)
    const mergedLeft = mesaToMerge.left || 0;
    const mergedTop = mesaToMerge.top || 0;
    
    const newPosX = Math.min(movedLeft, mergedLeft);
    const newPosY = Math.min(movedTop, mergedTop);

    // Nuevo nombre combinado
    const newNombre = `${mesa1.nombre}+${mesa2.nombre}`;
    const newId = `mesa-grupo-${Date.now()}`;

    // Eliminar ambas mesas del canvas
    canvas.remove(movedMesa);
    canvas.remove(mesaToMerge);

    // Eliminar etiquetas asociadas
    canvas.getObjects().forEach(obj => {
      const labelData = (obj as any).customData;
      if (labelData?.tipo === "mesa-label" && 
          (labelData?.parentId === movedData.id || labelData?.parentId === mergeData.id)) {
        canvas.remove(obj);
      }
    });

    // Crear nueva mesa fusionada
    const newAnchoPixels = newAncho / 100 * pixelsPerMeterRef.current;
    const newAltoPixels = newAlto / 100 * pixelsPerMeterRef.current;

    const newMesa = new Rect({
      left: newPosX,
      top: newPosY,
      width: newAnchoPixels,
      height: newAltoPixels,
      fill: "#bbf7d0", // Verde claro para indicar mesa agrupada
      stroke: "#16a34a",
      strokeWidth: 2,
      rx: 6,
      ry: 6,
      originX: "left",
      originY: "top",
      hasControls: false,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      shadow: {
        color: "rgba(0,0,0,0.1)",
        blur: 8,
        offsetX: 2,
        offsetY: 2,
      } as any,
    });

    (newMesa as any).customData = {
      tipo: "mesa",
      id: newId,
      nombre: newNombre,
      capacidad: newCapacidad,
      isMerged: true,
      originalMesas: [movedData.id, mergeData.id],
    };

    canvas.add(newMesa);

    // Crear etiqueta para la nueva mesa
    const anchoM = (newAncho / 100).toFixed(2);
    const altoM = (newAlto / 100).toFixed(2);
    const dimensionText = `${anchoM}x${altoM}m`;
    
    const centerX = newPosX + newAnchoPixels / 2;
    const centerY = newPosY + newAltoPixels / 2;
    
    const minDimension = Math.min(newAnchoPixels, newAltoPixels);
    const fontSize = Math.max(5, Math.min(10, minDimension / 8));

    const label = new FabricText(`${newNombre} (${newCapacidad}p)\n${dimensionText}`, {
      left: centerX,
      top: centerY,
      fontSize: fontSize,
      fontFamily: "system-ui, sans-serif",
      fontWeight: "600",
      fill: "#166534",
      textAlign: "center",
      selectable: false,
      evented: false,
      originX: "center",
      originY: "center",
    });
    
    (label as any).customData = { tipo: "mesa-label", parentId: newId };
    (label as any).isMesaLabel = true;
    canvas.add(label);

    // Actualizar estado - eliminar las dos mesas antiguas y añadir la nueva
    const newPosXMeters = newPosX / pixelsPerMeterRef.current;
    const newPosYMeters = newPosY / pixelsPerMeterRef.current;

    // Guardar datos originales de las mesas para poder desagrupar
    const originalMesasData = [
      { id: mesa1.id, nombre: mesa1.nombre, capacidad: mesa1.capacidad, forma: mesa1.forma, ancho: mesa1.ancho, alto: mesa1.alto },
      { id: mesa2.id, nombre: mesa2.nombre, capacidad: mesa2.capacidad, forma: mesa2.forma, ancho: mesa2.ancho, alto: mesa2.alto },
    ];

    const updatedMesas = mesasCanvasRef.current
      .filter(m => m.id !== movedData.id && m.id !== mergeData.id)
      .concat({
        id: newId,
        nombre: newNombre,
        capacidad: newCapacidad,
        forma: "rectangular" as const,
        ancho: newAncho,
        alto: newAlto,
        posX: newPosXMeters,
        posY: newPosYMeters,
        isMerged: true,
        originalMesas: originalMesasData,
      });

    onMesasChange(updatedMesas);
    canvas.setActiveObject(newMesa);
    canvas.renderAll();
  };

  // Función para mostrar guías de alineación y hacer auto-snap
  const showAlignmentGuides = (canvas: FabricCanvas, movingObj: FabricObject, applySnap: boolean = false) => {
    clearAlignmentGuides(canvas);
    
    const customData = (movingObj as any).customData;
    if (customData?.tipo !== "mesa") return;
    
    const movingLeft = movingObj.left || 0;
    const movingTop = movingObj.top || 0;
    const movingWidth = (movingObj as any).width || (movingObj as any).radius * 2 || 0;
    const movingHeight = (movingObj as any).height || (movingObj as any).radius * 2 || 0;
    
    const movingRight = movingLeft + movingWidth;
    const movingBottom = movingTop + movingHeight;
    const movingCenterX = movingLeft + movingWidth / 2;
    const movingCenterY = movingTop + movingHeight / 2;
    
    const SNAP_THRESHOLD = 12; // píxeles de tolerancia para snapping
    
    let snapX: number | null = null;
    let snapY: number | null = null;
    let snapXOffset = 0;
    let snapYOffset = 0;
    
    canvas.getObjects().forEach(obj => {
      const objData = (obj as any).customData;
      if (!objData || objData.tipo !== "mesa" || objData.id === customData.id) return;
      
      const objLeft = obj.left || 0;
      const objTop = obj.top || 0;
      const objWidth = (obj as any).width || (obj as any).radius * 2 || 0;
      const objHeight = (obj as any).height || (obj as any).radius * 2 || 0;
      
      const objRight = objLeft + objWidth;
      const objBottom = objTop + objHeight;
      const objCenterX = objLeft + objWidth / 2;
      const objCenterY = objTop + objHeight / 2;
      
      // Alineación vertical (bordes izquierdo, derecho, centro)
      const verticalAlignments = [
        { moving: movingLeft, target: objLeft, offset: objLeft - movingLeft },
        { moving: movingLeft, target: objRight, offset: objRight - movingLeft },
        { moving: movingRight, target: objLeft, offset: objLeft - movingRight },
        { moving: movingRight, target: objRight, offset: objRight - movingRight },
        { moving: movingCenterX, target: objCenterX, offset: objCenterX - movingCenterX },
      ];
      
      verticalAlignments.forEach(({ moving, target, offset }) => {
        if (Math.abs(moving - target) < SNAP_THRESHOLD) {
          // Guardar el snap más cercano
          if (snapX === null || Math.abs(offset) < Math.abs(snapXOffset)) {
            snapX = target;
            snapXOffset = offset;
          }
          
          const guide = new Line([target, 0, target, logicalHeight], {
            stroke: "#3b82f6",
            strokeWidth: 1,
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false,
          });
          (guide as any).isAlignmentGuide = true;
          alignmentGuidesRef.current.push(guide);
          canvas.add(guide);
        }
      });
      
      // Alineación horizontal (bordes superior, inferior, centro)
      const horizontalAlignments = [
        { moving: movingTop, target: objTop, offset: objTop - movingTop },
        { moving: movingTop, target: objBottom, offset: objBottom - movingTop },
        { moving: movingBottom, target: objTop, offset: objTop - movingBottom },
        { moving: movingBottom, target: objBottom, offset: objBottom - movingBottom },
        { moving: movingCenterY, target: objCenterY, offset: objCenterY - movingCenterY },
      ];
      
      horizontalAlignments.forEach(({ moving, target, offset }) => {
        if (Math.abs(moving - target) < SNAP_THRESHOLD) {
          // Guardar el snap más cercano
          if (snapY === null || Math.abs(offset) < Math.abs(snapYOffset)) {
            snapY = target;
            snapYOffset = offset;
          }
          
          const guide = new Line([0, target, logicalWidth, target], {
            stroke: "#3b82f6",
            strokeWidth: 1,
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false,
          });
          (guide as any).isAlignmentGuide = true;
          alignmentGuidesRef.current.push(guide);
          canvas.add(guide);
        }
      });
    });
    
    // Aplicar auto-snap si está habilitado
    if (applySnap) {
      let newLeft = movingLeft;
      let newTop = movingTop;
      
      if (snapXOffset !== 0 && Math.abs(snapXOffset) < SNAP_THRESHOLD) {
        newLeft = movingLeft + snapXOffset;
      }
      if (snapYOffset !== 0 && Math.abs(snapYOffset) < SNAP_THRESHOLD) {
        newTop = movingTop + snapYOffset;
      }
      
      if (newLeft !== movingLeft || newTop !== movingTop) {
        movingObj.set({ left: newLeft, top: newTop });
      }
    }
    
    canvas.renderAll();
  };

  // Inicializar canvas - se recrea cuando cambian las dimensiones
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: canvasWidth,
      height: canvasHeight,
      backgroundColor: "#ffffff",
      selection: true,
    });

    // Event handlers - Limitar selección a máximo 2 elementos
    const limitSelection = (selected: FabricObject[]) => {
      // Filtrar solo mesas de la selección
      const mesas = selected.filter(obj => (obj as any).customData?.tipo === "mesa");
      
      if (mesas.length > 2) {
        // Mantener solo las 2 primeras mesas seleccionadas
        const mesasToKeep = mesas.slice(0, 2);
        canvas.discardActiveObject();
        
        if (mesasToKeep.length === 1) {
          canvas.setActiveObject(mesasToKeep[0]);
        } else if (mesasToKeep.length === 2) {
          const sel = new (fabric as any).ActiveSelection(mesasToKeep, { canvas });
          canvas.setActiveObject(sel);
        }
        canvas.renderAll();
        return true; // Indica que se modificó la selección
      }
      return false;
    };
    
    canvas.on("selection:created", (e) => {
      const selected = e.selected || [];
      if (limitSelection(selected)) return;
      
      const obj = selected[0];
      if (obj) {
        const customData = (obj as any).customData;
        onSelectionChange(customData || null);
      }
    });

    canvas.on("selection:updated", (e) => {
      const selected = e.selected || [];
      if (limitSelection(selected)) return;
      
      const obj = selected[0];
      if (obj) {
        const customData = (obj as any).customData;
        onSelectionChange(customData || null);
      }
    });

    canvas.on("selection:cleared", () => {
      onSelectionChange(null);
      clearAlignmentGuides(canvas);
    });

    // Función helper para actualizar posición de una mesa y su etiqueta durante el movimiento
    const updateMesaPositionDuringMove = (mesaObj: FabricObject) => {
      const customData = (mesaObj as any).customData;
      if (customData?.tipo !== "mesa") return;
      
      // Limitar posición dentro del canvas
      const objWidth = (mesaObj as any).width || (mesaObj as any).radius * 2 || 0;
      const objHeight = (mesaObj as any).height || (mesaObj as any).radius * 2 || 0;
      
      let newPosX = mesaObj.left || 0;
      let newPosY = mesaObj.top || 0;
      
      // Mantener dentro de los límites del canvas
      if (newPosX < 0) newPosX = 0;
      if (newPosY < 0) newPosY = 0;
      if (newPosX + objWidth > logicalWidth) newPosX = logicalWidth - objWidth;
      if (newPosY + objHeight > logicalHeight) newPosY = logicalHeight - objHeight;
      
      mesaObj.set({ left: newPosX, top: newPosY });
      
      // Actualizar etiqueta asociada
      canvas.getObjects().forEach((labelObj) => {
        const labelData = (labelObj as any).customData;
        if (labelData?.tipo === "mesa-label" && labelData?.parentId === customData.id) {
          const mesa = mesasCanvasRef.current.find(m => m.id === customData.id);
          if (mesa) {
            const anchoPixels = mesa.ancho / 100 * pixelsPerMeterRef.current;
            const altoPixels = mesa.alto / 100 * pixelsPerMeterRef.current;
            labelObj.set({
              left: newPosX + anchoPixels / 2,
              top: newPosY + altoPixels / 2,
            });
          }
        }
      });
    };

    // Mostrar guías y mover etiquetas mientras se mueven las mesas
    canvas.on("object:moving", (e) => {
      const target = e.target;
      if (!target) return;
      
      showAlignmentGuides(canvas, target);
      
      // Verificar si es una selección múltiple (ActiveSelection)
      if ((target as any).type === "activeSelection" || (target as any)._objects) {
        // Es una selección múltiple - iterar sobre todos los objetos
        const activeSelection = target as any;
        const objects = activeSelection._objects || [];
        
        // Obtener la posición del grupo
        const groupLeft = activeSelection.left || 0;
        const groupTop = activeSelection.top || 0;
        
        objects.forEach((obj: FabricObject) => {
          const customData = (obj as any).customData;
          if (customData?.tipo === "mesa") {
            // Calcular posición absoluta: posición del grupo + offset del objeto dentro del grupo
            // Los objetos dentro del grupo tienen posiciones relativas a su centro
            const objLeft = obj.left || 0;
            const objTop = obj.top || 0;
            const objWidth = (obj as any).width || (obj as any).radius * 2 || 0;
            const objHeight = (obj as any).height || (obj as any).radius * 2 || 0;
            
            // La posición absoluta es: centro del grupo + offset del objeto
            const absoluteLeft = groupLeft + objLeft;
            const absoluteTop = groupTop + objTop;
            
            const mesa = mesasCanvasRef.current.find(m => m.id === customData.id);
            if (mesa) {
              const anchoPixels = mesa.ancho / 100 * pixelsPerMeterRef.current;
              const altoPixels = mesa.alto / 100 * pixelsPerMeterRef.current;
              
              // Calcular centro de la mesa para la etiqueta
              let centerX: number;
              let centerY: number;
              
              if (mesa.forma === "circular") {
                centerX = absoluteLeft + anchoPixels / 2;
                centerY = absoluteTop + altoPixels / 2;
              } else {
                centerX = absoluteLeft + anchoPixels / 2;
                centerY = absoluteTop + altoPixels / 2;
              }
              
              canvas.getObjects().forEach((labelObj) => {
                const labelData = (labelObj as any).customData;
                if (labelData?.tipo === "mesa-label" && labelData?.parentId === customData.id) {
                  labelObj.set({
                    left: centerX,
                    top: centerY,
                  });
                }
              });
            }
          }
        });
        canvas.renderAll();
      } else {
        // Es un objeto individual
        updateMesaPositionDuringMove(target);
      }
    });

    canvas.on("object:modified", (e) => {
      const target = e.target;
      if (!target) return;
      
      // Limpiar guías de alineación
      clearAlignmentGuides(canvas);
      
      // Verificar si es una selección múltiple (ActiveSelection)
      if ((target as any).type === "activeSelection" || (target as any)._objects) {
        const activeSelection = target as any;
        const objects = activeSelection._objects || [];
        
        // Obtener la posición del grupo
        const groupLeft = activeSelection.left || 0;
        const groupTop = activeSelection.top || 0;
        
        // Recopilar actualizaciones de todas las mesas
        const updates: Array<{ id: string; posX: number; posY: number }> = [];
        
        objects.forEach((obj: FabricObject) => {
          const customData = (obj as any).customData;
          if (customData?.tipo === "mesa") {
            // Calcular posición absoluta usando el offset del grupo
            const objLeft = obj.left || 0;
            const objTop = obj.top || 0;
            
            const absoluteLeft = groupLeft + objLeft;
            const absoluteTop = groupTop + objTop;
            
            // Convertir de píxeles a metros para guardar
            const newPosXMeters = absoluteLeft / pixelsPerMeterRef.current;
            const newPosYMeters = absoluteTop / pixelsPerMeterRef.current;
            
            updates.push({ id: customData.id, posX: newPosXMeters, posY: newPosYMeters });
            
            // Actualizar etiqueta
            const mesa = mesasCanvasRef.current.find(m => m.id === customData.id);
            if (mesa) {
              const anchoPixels = mesa.ancho / 100 * pixelsPerMeterRef.current;
              const altoPixels = mesa.alto / 100 * pixelsPerMeterRef.current;
              
              const centerX = absoluteLeft + anchoPixels / 2;
              const centerY = absoluteTop + altoPixels / 2;
              
              canvas.getObjects().forEach((labelObj) => {
                const labelData = (labelObj as any).customData;
                if (labelData?.tipo === "mesa-label" && labelData?.parentId === customData.id) {
                  labelObj.set({
                    left: centerX,
                    top: centerY,
                  });
                }
              });
            }
          }
        });
        
        // Aplicar todas las actualizaciones al estado
        if (updates.length > 0) {
          const currentMesas = mesasCanvasRef.current;
          onMesasChange(
            currentMesas.map((m) => {
              const update = updates.find(u => u.id === m.id);
              return update ? { ...m, posX: update.posX, posY: update.posY } : m;
            })
          );
        }
        
        canvas.renderAll();
      } else {
        // Es un objeto individual - aplicar auto-snap antes de guardar
        const customData = (target as any).customData;
        if (customData?.tipo === "mesa") {
          // Aplicar auto-snap al soltar
          showAlignmentGuides(canvas, target, true);
          clearAlignmentGuides(canvas);
          
          const newPosXPixels = target.left || 0;
          const newPosYPixels = target.top || 0;
          
          // Convertir de píxeles a metros para guardar
          const newPosXMeters = newPosXPixels / pixelsPerMeterRef.current;
          const newPosYMeters = newPosYPixels / pixelsPerMeterRef.current;
          
          // Actualizar la etiqueta asociada a esta mesa
          canvas.getObjects().forEach((labelObj) => {
            const labelData = (labelObj as any).customData;
            if (labelData?.tipo === "mesa-label" && labelData?.parentId === customData.id) {
              const mesa = mesasCanvasRef.current.find(m => m.id === customData.id);
              if (mesa) {
                const anchoPixels = mesa.ancho / 100 * pixelsPerMeterRef.current;
                const altoPixels = mesa.alto / 100 * pixelsPerMeterRef.current;
                labelObj.set({
                  left: newPosXPixels + anchoPixels / 2,
                  top: newPosYPixels + altoPixels / 2,
                });
              }
            }
          });
          canvas.renderAll();
          
          // Actualizar estado guardando posición en METROS
          const currentMesas = mesasCanvasRef.current;
          onMesasChange(
            currentMesas.map((m) =>
              m.id === customData.id
                ? { ...m, posX: newPosXMeters, posY: newPosYMeters }
                : m
            )
          );
          
          // Verificar si se puede fusionar con otra mesa cercana
          setTimeout(() => checkAndMergeTables(canvas, target), 50);
        }
      }
    });

    setFabricCanvas(canvas);

    // Aplicar zoom inicial
    if (initialZoom !== 1) {
      canvas.setZoom(initialZoom);
    }

    return () => {
      canvas.dispose();
    };
  }, [canvasWidth, canvasHeight]);


  // Zoom con rueda del ratón
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleWheel = (opt: any) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY;
      let zoom = fabricCanvas.getZoom();
      zoom *= 0.999 ** delta;
      
      // Limitar zoom entre 0.25x y 3x
      if (zoom > 3) zoom = 3;
      if (zoom < 0.25) zoom = 0.25;
      
      // Zoom hacia el punto del cursor
      fabricCanvas.zoomToPoint(new Point(e.offsetX, e.offsetY), zoom);
      onZoomChange?.(zoom);
    };

    fabricCanvas.on('mouse:wheel', handleWheel);
    return () => {
      fabricCanvas.off('mouse:wheel', handleWheel);
    };
  }, [fabricCanvas, onZoomChange]);

  // Pan con Espacio + click
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spacePressed.current) {
        e.preventDefault();
        spacePressed.current = true;
        fabricCanvas.defaultCursor = 'grab';
        fabricCanvas.hoverCursor = 'grab';
        fabricCanvas.selection = false;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressed.current = false;
        setIsPanning(false);
        fabricCanvas.defaultCursor = 'default';
        fabricCanvas.hoverCursor = 'move';
        fabricCanvas.selection = true;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [fabricCanvas]);

  // Eventos de mouse para pan
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleMouseDownPan = (opt: any) => {
      if (spacePressed.current) {
        setIsPanning(true);
        fabricCanvas.defaultCursor = 'grabbing';
        lastPanPos.current = { x: opt.e.clientX, y: opt.e.clientY };
      }
    };

    const handleMouseMovePan = (opt: any) => {
      if (isPanning && spacePressed.current) {
        const vpt = fabricCanvas.viewportTransform;
        if (vpt) {
          vpt[4] += opt.e.clientX - lastPanPos.current.x;
          vpt[5] += opt.e.clientY - lastPanPos.current.y;
          fabricCanvas.requestRenderAll();
          lastPanPos.current = { x: opt.e.clientX, y: opt.e.clientY };
        }
      }
    };

    const handleMouseUpPan = () => {
      if (isPanning) {
        setIsPanning(false);
        if (spacePressed.current) {
          fabricCanvas.defaultCursor = 'grab';
        }
      }
    };

    fabricCanvas.on('mouse:down', handleMouseDownPan);
    fabricCanvas.on('mouse:move', handleMouseMovePan);
    fabricCanvas.on('mouse:up', handleMouseUpPan);
    
    return () => {
      fabricCanvas.off('mouse:down', handleMouseDownPan);
      fabricCanvas.off('mouse:move', handleMouseMovePan);
      fabricCanvas.off('mouse:up', handleMouseUpPan);
    };
  }, [fabricCanvas, isPanning]);

  // Dibujar grid que cubre todo el espacio visible del canvas
  useEffect(() => {
    if (!fabricCanvas) return;

    // Limpiar grid anterior
    fabricCanvas.getObjects().forEach((obj) => {
      if ((obj as any).isGrid) {
        fabricCanvas.remove(obj);
      }
    });

    // Extensión del grid más allá del área visible (para pan sin bordes)
    const gridExtension = 5000; // píxeles de extensión en cada dirección
    const gridStartX = -gridExtension;
    const gridStartY = -gridExtension;
    const gridEndX = canvasWidth + gridExtension;
    const gridEndY = canvasHeight + gridExtension;

    // Colores del grid - uniformes para todo el canvas
    const gridColorMedium = "#e2e8f0";
    const gridColorStrong = "#cbd5e1";
    
    // Calcular líneas desde el inicio negativo hasta el final extendido
    const startMeterX = Math.floor(gridStartX / pixelsPerMeter);
    const endMeterX = Math.ceil(gridEndX / pixelsPerMeter);
    const startMeterY = Math.floor(gridStartY / pixelsPerMeter);
    const endMeterY = Math.ceil(gridEndY / pixelsPerMeter);
    
    // Líneas verticales - grid uniforme
    for (let i = startMeterX; i <= endMeterX; i++) {
      const x = i * pixelsPerMeter;
      const isMajor = i % 5 === 0;
      const line = new Line([x, gridStartY, x, gridEndY], {
        stroke: isMajor ? gridColorStrong : gridColorMedium,
        strokeWidth: isMajor ? 1.5 : 0.5,
        selectable: false,
        evented: false,
      });
      (line as any).isGrid = true;
      fabricCanvas.add(line);
      fabricCanvas.sendObjectToBack(line);
    }

    // Líneas horizontales - grid uniforme
    for (let i = startMeterY; i <= endMeterY; i++) {
      const y = i * pixelsPerMeter;
      const isMajor = i % 5 === 0;
      const line = new Line([gridStartX, y, gridEndX, y], {
        stroke: isMajor ? gridColorStrong : gridColorMedium,
        strokeWidth: isMajor ? 1.5 : 0.5,
        selectable: false,
        evented: false,
      });
      (line as any).isGrid = true;
      fabricCanvas.add(line);
      fabricCanvas.sendObjectToBack(line);
    }

    fabricCanvas.renderAll();
  }, [fabricCanvas, pixelsPerMeter, canvasWidth, canvasHeight]);

  // Cargar elementos (de planoConfig al inicio, o del estado local cuando el canvas se recrea)
  useEffect(() => {
    if (!fabricCanvas) return;

    // Verificar qué elementos ya están en el canvas
    const elementosEnCanvas = new Set<string>();
    fabricCanvas.getObjects().forEach((obj) => {
      const customData = (obj as any).customData;
      if (customData?.id && customData?.tipo !== "mesa") {
        elementosEnCanvas.add(customData.id);
      }
    });

    // Priorizar elementos del estado local, si no hay, usar planoConfig
    const elementosACargar = elementosRef.current.length > 0 
      ? elementosRef.current 
      : (planoConfig?.elementos || []);

    elementosACargar.forEach((elem: any) => {
      // Saltar si ya está en el canvas
      if (elementosEnCanvas.has(elem.id)) return;
      
      let obj: FabricObject | null = null;
      const x1 = elem.props?.x1 || elem.x1 || 0;
      const y1 = elem.props?.y1 || elem.y1 || 0;
      const x2 = elem.props?.x2 || elem.x2 || 0;
      const y2 = elem.props?.y2 || elem.y2 || 0;

      switch (elem.tipo) {
        case "wall": {
          // Calcular ángulo para determinar color de nivel
          const dx = x2 - x1;
          const dy = y2 - y1;
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          const levelColor = getWallLevelColor(angle);
          
          obj = new Line([x1, y1, x2, y2], {
            stroke: levelColor, // Color según nivel
            strokeWidth: 10,
            strokeLineCap: "round",
            selectable: true,
            hasControls: true,
          });
          break;
        }
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
        
        // Añadir cota para paredes
        if (elem.tipo === "wall") {
          const dx = x2 - x1;
          const dy = y2 - y1;
          const lengthPx = Math.sqrt(dx * dx + dy * dy);
          const lengthM = roundTo5cm(lengthPx / pixelsPerMeter);
          
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          
          const offsetDistance = 18;
          const perpAngle = (angle + 90) * (Math.PI / 180);
          const offsetX = Math.cos(perpAngle) * offsetDistance;
          const offsetY = Math.sin(perpAngle) * offsetDistance;
          
          const cotaText = new FabricText(`${lengthM.toFixed(2)}m`, {
            left: midX + offsetX,
            top: midY + offsetY,
            fontSize: 11,
            fontFamily: "system-ui, sans-serif",
            fontWeight: "600",
            fill: "#374151",
            backgroundColor: "rgba(255,255,255,0.85)",
            padding: 3,
            selectable: false,
            evented: false,
            originX: "center",
            originY: "center",
            angle: angle > 90 || angle < -90 ? angle + 180 : angle,
          });
          
          (cotaText as any).customData = { tipo: "cota", parentId: elem.id };
          (cotaText as any).isCota = true;
          fabricCanvas.add(cotaText);
        }
      }
    });

    // Solo actualizar estado si cargamos desde planoConfig y el estado está vacío
    if (elementosRef.current.length === 0 && planoConfig?.elementos?.length > 0) {
      onElementosChange(planoConfig.elementos.map((e: any) => ({ id: e.id, tipo: e.tipo, props: e.props || e })));
    }
    
    fabricCanvas.renderAll();
  }, [fabricCanvas, planoConfig, pixelsPerMeter]);

  // Cargar mesas (de BD o del estado local cuando el canvas se recrea)
  useEffect(() => {
    if (!fabricCanvas) return;

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

    // Función para añadir etiqueta de mesa
    // NOTA: ancho/alto vienen en cm, posX/posY en PÍXELES (ya convertidos)
    const addMesaLabel = (mesaId: string, nombre: string, anchoCm: number, altoCm: number, forma: string, posXPixels: number, posYPixels: number) => {
      const anchoM = (anchoCm / 100).toFixed(2);
      const altoM = (altoCm / 100).toFixed(2);
      const dimensionText = forma === "circular" ? `Ø${anchoM}m` : `${anchoM}x${altoM}m`;
      
      // Calcular dimensiones en píxeles para el label
      const anchoPixels = anchoCm / 100 * pixelsPerMeter;
      const altoPixels = altoCm / 100 * pixelsPerMeter;
      
      // Calcular tamaño de fuente que quepa dentro de la mesa
      const minDimension = Math.min(anchoPixels, altoPixels);
      const fontSize = Math.max(6, Math.min(10, minDimension / 8));
      
      // Crear texto temporal para medir
      const tempLabel = new FabricText(`${nombre}\n${dimensionText}`, {
        fontSize: fontSize,
        fontFamily: "system-ui, sans-serif",
        fontWeight: "600",
      });
      
      // Si el texto es más ancho que la mesa, reducir más el tamaño
      let finalFontSize = fontSize;
      const maxWidth = anchoPixels * 0.85;
      const maxHeight = altoPixels * 0.85;
      
      if (tempLabel.width && tempLabel.width > maxWidth) {
        finalFontSize = finalFontSize * (maxWidth / tempLabel.width);
      }
      if (tempLabel.height && tempLabel.height > maxHeight) {
        finalFontSize = Math.min(finalFontSize, finalFontSize * (maxHeight / tempLabel.height));
      }
      
      finalFontSize = Math.max(5, finalFontSize);
      
      // Calcular centro según tipo de forma
      let centerX: number;
      let centerY: number;
      
      if (forma === "circular") {
        const radiusPixels = Math.min(anchoPixels, altoPixels) / 2;
        centerX = posXPixels + radiusPixels;
        centerY = posYPixels + radiusPixels;
      } else {
        centerX = posXPixels + anchoPixels / 2;
        centerY = posYPixels + altoPixels / 2;
      }
      
      const label = new FabricText(`${nombre}\n${dimensionText}`, {
        left: centerX,
        top: centerY,
        fontSize: finalFontSize,
        fontFamily: "system-ui, sans-serif",
        fontWeight: "600",
        fill: "#1e40af",
        textAlign: "center",
        selectable: false,
        evented: false,
        originX: "center",
        originY: "center",
      });
      
      (label as any).customData = { tipo: "mesa-label", parentId: mesaId };
      (label as any).isMesaLabel = true;
      fabricCanvas.add(label);
    };

    // Primero cargar mesas del estado local (tienen prioridad)
    // NOTA: mesa.posX/posY están en METROS, hay que convertir a píxeles
    mesasLocales.forEach((mesa) => {
      if (mesasEnCanvas.has(mesa.id)) return;

      // Convertir posición de metros a píxeles
      const posXPixels = mesa.posX * pixelsPerMeter;
      const posYPixels = mesa.posY * pixelsPerMeter;
      
      // Convertir cm a píxeles para dimensiones
      const anchoPixels = mesa.ancho / 100 * pixelsPerMeter;
      const altoPixels = mesa.alto / 100 * pixelsPerMeter;

      let obj: FabricObject;
      
      // Colores según si es mesa agrupada o normal
      const fillColor = mesa.isMerged ? "#bbf7d0" : "#dbeafe";
      const strokeColor = mesa.isMerged ? "#16a34a" : "#2563eb";
      const labelColor = mesa.isMerged ? "#166534" : "#1e40af";

      if (mesa.forma === "circular") {
        const radiusPixels = Math.min(anchoPixels, altoPixels) / 2;
        obj = new Circle({
          left: posXPixels,
          top: posYPixels,
          radius: radiusPixels,
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: 2,
          originX: "left",
          originY: "top",
          hasControls: false,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
          shadow: {
            color: "rgba(0,0,0,0.1)",
            blur: 8,
            offsetX: 2,
            offsetY: 2,
          } as any,
        });
      } else {
        obj = new Rect({
          left: posXPixels,
          top: posYPixels,
          width: anchoPixels,
          height: altoPixels,
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: 2,
          rx: 6,
          ry: 6,
          originX: "left",
          originY: "top",
          hasControls: false,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
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
        isMerged: mesa.isMerged || false,
        originalMesas: mesa.originalMesas || null,
      };

      fabricCanvas.add(obj);
      
      // Etiqueta con estilo diferente para mesas agrupadas
      if (mesa.isMerged) {
        const anchoM = (mesa.ancho / 100).toFixed(2);
        const altoM = (mesa.alto / 100).toFixed(2);
        const dimensionText = `${anchoM}x${altoM}m`;
        const centerX = posXPixels + anchoPixels / 2;
        const centerY = posYPixels + altoPixels / 2;
        const minDimension = Math.min(anchoPixels, altoPixels);
        const fontSize = Math.max(5, Math.min(10, minDimension / 8));
        
        const label = new FabricText(`${mesa.nombre} (${mesa.capacidad}p)\n${dimensionText}`, {
          left: centerX,
          top: centerY,
          fontSize: fontSize,
          fontFamily: "system-ui, sans-serif",
          fontWeight: "600",
          fill: labelColor,
          textAlign: "center",
          selectable: false,
          evented: false,
          originX: "center",
          originY: "center",
        });
        (label as any).customData = { tipo: "mesa-label", parentId: mesa.id };
        (label as any).isMesaLabel = true;
        fabricCanvas.add(label);
      } else {
        addMesaLabel(mesa.id, mesa.nombre, mesa.ancho, mesa.alto, mesa.forma, posXPixels, posYPixels);
      }
      
      mesasEnCanvas.add(mesa.id);
    });

    // Cargar mesas de BD SOLO en la inicialización (primera carga)
    // NOTA: pos_x/pos_y en BBDD están en METROS, ancho/alto en CM
    const shouldLoadFromDB = !mesasInitializedRef.current;
    
    if (shouldLoadFromDB) {
      const mesasLocalesIds = new Set(mesasLocales.map(m => m.id));
      mesasDB?.forEach((mesa) => {
        // Saltar si ya está en el canvas o en el estado local
        if (mesasEnCanvas.has(mesa.id) || mesasLocalesIds.has(mesa.id)) return;

      // Las posiciones vienen en metros desde la BD
      const posXMeters = mesa.pos_x || 0.5;
      const posYMeters = mesa.pos_y || 0.5;
      const anchoCm = mesa.ancho || 80;
      const altoCm = mesa.alto || 80;

      // Convertir posición de metros a píxeles
      const posXPixels = posXMeters * pixelsPerMeter;
      const posYPixels = posYMeters * pixelsPerMeter;
      
      // Convertir cm a píxeles para dimensiones
      const anchoPixels = anchoCm / 100 * pixelsPerMeter;
      const altoPixels = altoCm / 100 * pixelsPerMeter;

      // Colores según si es mesa agrupada o normal
      const isMerged = mesa.is_merged || false;
      const fillColor = isMerged ? "#bbf7d0" : "#dbeafe";
      const strokeColor = isMerged ? "#16a34a" : "#2563eb";
      const labelColor = isMerged ? "#166534" : "#1e40af";

      let obj: FabricObject;

      if (mesa.forma === "circular") {
        const radiusPixels = Math.min(anchoPixels, altoPixels) / 2;
        obj = new Circle({
          left: posXPixels,
          top: posYPixels,
          radius: radiusPixels,
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: 2,
          originX: "left",
          originY: "top",
          hasControls: false,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
          shadow: {
            color: "rgba(0,0,0,0.1)",
            blur: 8,
            offsetX: 2,
            offsetY: 2,
          } as any,
        });
      } else {
        obj = new Rect({
          left: posXPixels,
          top: posYPixels,
          width: anchoPixels,
          height: altoPixels,
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: 2,
          rx: 6,
          ry: 6,
          originX: "left",
          originY: "top",
          hasControls: false,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
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
        isMerged: isMerged,
        originalMesas: mesa.original_mesas || null,
      };

      fabricCanvas.add(obj);
      
      // Etiqueta con estilo diferente para mesas agrupadas
      if (isMerged) {
        const anchoM = (anchoCm / 100).toFixed(2);
        const altoM = (altoCm / 100).toFixed(2);
        const dimensionText = `${anchoM}x${altoM}m`;
        const centerX = posXPixels + anchoPixels / 2;
        const centerY = posYPixels + altoPixels / 2;
        const minDimension = Math.min(anchoPixels, altoPixels);
        const fontSize = Math.max(5, Math.min(10, minDimension / 8));
        
        const label = new FabricText(`${mesa.nombre} (${mesa.capacidad}p)\n${dimensionText}`, {
          left: centerX,
          top: centerY,
          fontSize: fontSize,
          fontFamily: "system-ui, sans-serif",
          fontWeight: "600",
          fill: labelColor,
          textAlign: "center",
          selectable: false,
          evented: false,
          originX: "center",
          originY: "center",
        });
        (label as any).customData = { tipo: "mesa-label", parentId: mesa.id };
        (label as any).isMesaLabel = true;
        fabricCanvas.add(label);
      } else {
        addMesaLabel(mesa.id, mesa.nombre, anchoCm, altoCm, mesa.forma, posXPixels, posYPixels);
      }

      // Guardar en estado local en METROS
      newMesasCanvas.push({
        id: mesa.id,
        nombre: mesa.nombre,
        capacidad: mesa.capacidad,
        forma: mesa.forma as "rectangular" | "circular",
        ancho: anchoCm,
        alto: altoCm,
        posX: posXMeters,
        posY: posYMeters,
        isMerged: isMerged,
        originalMesas: mesa.original_mesas || undefined,
      });
      });
    
      mesasInitializedRef.current = true;
    }

    if (newMesasCanvas.length > 0) {
      onMesasChange([...mesasCanvasRef.current, ...newMesasCanvas]);
    }

    fabricCanvas.renderAll();
  }, [fabricCanvas, mesasDB, pixelsPerMeter]);

  // Manejar clics según la herramienta activa
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleMouseDown = (opt: any) => {
      // Usar getScenePoint para obtener coordenadas correctas del canvas (con zoom/pan)
      const pointer = fabricCanvas.getScenePoint(opt.e);
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
      
      // Usar getScenePoint para obtener coordenadas correctas del canvas (con zoom/pan)
      const pointer = fabricCanvas.getScenePoint(opt.e);
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
      
      // Calcular ángulo para color de nivel
      const dx = x - lastPoint.x;
      const dy = y - lastPoint.y;
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const levelColor = getWallLevelColor(angle);
      
      const line = new Line([lastPoint.x, lastPoint.y, x, y], {
        stroke: levelColor, // Color según nivel de la pared
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

    // Calcular ángulo para color de nivel en tiempo real
    const dx = x - lastPoint.x;
    const dy = y - lastPoint.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const levelColor = getWallLevelColor(angle);

    const preview = new Line([lastPoint.x, lastPoint.y, x, y], {
      stroke: levelColor, // Color dinámico según nivel
      strokeWidth: 6,
      strokeDashArray: [8, 4],
      strokeLineCap: "round",
      selectable: false,
      evented: false,
    });

    previewLineRef.current = preview;
    fabricCanvas.add(preview);
    
    // Calcular longitud en metros (redondeada a 5cm) - reutilizar dx/dy calculados arriba
    const lengthPx = Math.sqrt(dx * dx + dy * dy);
    const lengthM = roundTo5cm(lengthPx / pixelsPerMeterRef.current);
    
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

  // Función para crear cota (anotación de medida) en una pared
  const createWallCota = (x1: number, y1: number, x2: number, y2: number, wallId: string) => {
    if (!fabricCanvas) return;
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthPx = Math.sqrt(dx * dx + dy * dy);
    const lengthM = roundTo5cm(lengthPx / pixelsPerMeterRef.current);
    
    // Punto medio de la pared
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    
    // Calcular ángulo de la pared
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    // Offset perpendicular para la cota
    const offsetDistance = 18;
    const perpAngle = (angle + 90) * (Math.PI / 180);
    const offsetX = Math.cos(perpAngle) * offsetDistance;
    const offsetY = Math.sin(perpAngle) * offsetDistance;
    
    const cotaText = new FabricText(`${lengthM.toFixed(2)}m`, {
      left: midX + offsetX,
      top: midY + offsetY,
      fontSize: 11,
      fontFamily: "system-ui, sans-serif",
      fontWeight: "600",
      fill: "#374151",
      backgroundColor: "rgba(255,255,255,0.85)",
      padding: 3,
      selectable: false,
      evented: false,
      originX: "center",
      originY: "center",
      angle: angle > 90 || angle < -90 ? angle + 180 : angle,
    });
    
    (cotaText as any).customData = { tipo: "cota", parentId: wallId };
    (cotaText as any).isCota = true;
    fabricCanvas.add(cotaText);
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

    // Crear paredes permanentes con cotas y color de nivel - filtrar paredes de longitud 0
    const currentElementos = elementosRef.current;
    const newElementos: ElementoCanvas[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const x1 = points[i].x;
      const y1 = points[i].y;
      const x2 = points[i + 1].x;
      const y2 = points[i + 1].y;
      
      // Calcular longitud de la pared
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      // Solo crear paredes con longitud significativa (más de 5 píxeles)
      if (length < 5) {
        console.log('[SKIP] Pared muy corta ignorada:', length, 'px');
        continue;
      }
      
      const id = `wall-${Date.now()}-${i}`;
      
      // Calcular ángulo para determinar color de nivel
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const levelColor = getWallLevelColor(angle);
      
      const wall = new Line([x1, y1, x2, y2], {
        stroke: levelColor, // Color según nivel
        strokeWidth: 10,
        strokeLineCap: "round",
        selectable: true,
        hasControls: true,
      });
      (wall as any).customData = { tipo: "wall", id };
      fabricCanvas.add(wall);
      
      // Añadir cota a la pared
      createWallCota(x1, y1, x2, y2, id);
      
      newElementos.push({
        id,
        tipo: "wall",
        props: { x1, y1, x2, y2 },
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

  // Función para crear etiqueta de mesa (anchoCm/altoCm en cm, posXPixels/posYPixels en píxeles)
  const createMesaLabel = (mesaId: string, nombre: string, anchoCm: number, altoCm: number, forma: string, posXPixels: number, posYPixels: number) => {
    if (!fabricCanvas) return;
    
    // Calcular dimensiones en metros para mostrar
    const anchoM = (anchoCm / 100).toFixed(2);
    const altoM = (altoCm / 100).toFixed(2);
    const dimensionText = forma === "circular" ? `Ø${anchoM}m` : `${anchoM}x${altoM}m`;
    
    // Calcular dimensiones en píxeles
    const anchoPixels = anchoCm / 100 * pixelsPerMeterRef.current;
    const altoPixels = altoCm / 100 * pixelsPerMeterRef.current;
    
    // Calcular tamaño de fuente que quepa
    const minDimension = Math.min(anchoPixels, altoPixels);
    const finalFontSize = Math.max(5, Math.min(10, minDimension / 8));
    
    // Centro de la mesa
    let centerX: number;
    let centerY: number;
    
    if (forma === "circular") {
      const radiusPixels = Math.min(anchoPixels, altoPixels) / 2;
      centerX = posXPixels + radiusPixels;
      centerY = posYPixels + radiusPixels;
    } else {
      centerX = posXPixels + anchoPixels / 2;
      centerY = posYPixels + altoPixels / 2;
    }
    
    const label = new FabricText(`${nombre}\n${dimensionText}`, {
      left: centerX,
      top: centerY,
      fontSize: finalFontSize,
      fontFamily: "system-ui, sans-serif",
      fontWeight: "600",
      fill: "#1e40af",
      textAlign: "center",
      selectable: false,
      evented: false,
      originX: "center",
      originY: "center",
    });
    
    (label as any).customData = { tipo: "mesa-label", parentId: mesaId };
    (label as any).isMesaLabel = true;
    fabricCanvas.add(label);
  };

  const handleMesaClick = (x: number, y: number, forma: "rectangular" | "circular") => {
    if (!fabricCanvas) return;

    const id = `mesa-temp-${Date.now()}`;
    // Dimensiones estándar en CM: 80x80cm rectangular, 150cm diámetro circular
    const anchoCm = forma === "circular" ? 150 : 80;
    const altoCm = forma === "circular" ? 150 : 80;
    const capacidad = forma === "circular" ? 6 : 2;

    // Convertir cm a píxeles para renderizar
    const anchoPixels = anchoCm / 100 * pixelsPerMeterRef.current;
    const altoPixels = altoCm / 100 * pixelsPerMeterRef.current;
    
    // Posición en píxeles (centrado en el clic)
    const posXPixels = x - anchoPixels / 2;
    const posYPixels = y - altoPixels / 2;
    
    // Posición en metros para guardar
    const posXMeters = posXPixels / pixelsPerMeterRef.current;
    const posYMeters = posYPixels / pixelsPerMeterRef.current;

    let obj: FabricObject;

    if (forma === "circular") {
      const radiusPixels = Math.min(anchoPixels, altoPixels) / 2;
      obj = new Circle({
        left: posXPixels,
        top: posYPixels,
        radius: radiusPixels,
        fill: "#dbeafe",
        stroke: "#2563eb",
        strokeWidth: 2,
        originX: "left",
        originY: "top",
        hasControls: false,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        shadow: {
          color: "rgba(0,0,0,0.1)",
          blur: 8,
          offsetX: 2,
          offsetY: 2,
        } as any,
      });
    } else {
      obj = new Rect({
        left: posXPixels,
        top: posYPixels,
        width: anchoPixels,
        height: altoPixels,
        fill: "#dbeafe",
        stroke: "#2563eb",
        strokeWidth: 2,
        rx: 6,
        ry: 6,
        originX: "left",
        originY: "top",
        hasControls: false,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
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
    
    // Añadir etiqueta de la mesa (pasando cm y píxeles)
    createMesaLabel(id, mesaName, anchoCm, altoCm, forma, posXPixels, posYPixels);
    
    fabricCanvas.setActiveObject(obj);
    fabricCanvas.renderAll();

    // Guardar en estado con posición en METROS y dimensiones en CM
    const newMesa: MesaCanvas = {
      id,
      nombre: mesaName,
      capacidad,
      forma,
      ancho: anchoCm,
      alto: altoCm,
      posX: posXMeters,
      posY: posYMeters,
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
    <div ref={containerRef} className="absolute inset-0 w-full h-full overflow-hidden">
      <canvas ref={canvasRef} id="plano-canvas" className="block" />
    </div>
  );
});

CanvasPlano.displayName = "CanvasPlano";
