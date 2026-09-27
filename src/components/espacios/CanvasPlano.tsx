import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import * as fabric from "fabric";
import { Canvas as FabricCanvas, Rect, Circle, Line, FabricObject, FabricText, Point } from "fabric";
import type { TextStyle } from "fabric";
import { toast } from "sonner";
import { ToolType } from "./ToolbarDibujo";
import { ElementoCanvas, MesaCanvas } from "./EditorPlanoEspacio";
import { Mesa } from "@/hooks/useMesas";
import {
  mensajeChoquesResueltos,
  mesasCanvasParaNombre,
  resolverChoquesNombresMesa,
  siguienteNumeroMesaLibre,
} from "./nombresMesa";
import {
  calcularPuntosAbsolutosPared,
  calcularGeometriaRect,
  snapPointToGrid,
  snapWallAngle,
  snapToWallEndpoint,
  snapRotationDeg,
  distribuirSillasRectangular,
  distribuirSillasCirculo,
  type Matrix2D,
  type SegmentoPared,
} from "./planoUtils";

// Estilo arquitectónico de paredes: gris carbón uniforme (antes se coloreaban
// en verde/amarillo/naranja/rojo según la desviación respecto a 0°, pero sin
// ningún snapping era casi imposible dibujar una pared "verde" — la escala de
// "nivel" no aportaba nada útil). Grosor ~15cm a escala real.
const WALL_COLOR = "#1f2937";
const WALL_COLOR_SELECTED = "#2563eb";
const WALL_THICKNESS_METERS = 0.15;
const GRID_SNAP_METERS = 0.1;
const ENDPOINT_SNAP_PX = 10;
const ANGLE_SNAP_STEP_DEG = 15;
const DOOR_WIDTH_METERS = 0.8;
const DOOR_LEAF_THICKNESS_PX = 6;
// Umbral en píxeles de PANTALLA (como ENDPOINT_SNAP_PX): hay que dividirlo
// por canvas.getZoom() antes de compararlo contra distancias en coordenadas
// de escena — si no, con zoom alejado el imán "se encoge" y con zoom
// acercado "se agranda" en términos de lo que el usuario percibe en pantalla.
const DOOR_WALL_SNAP_PX = 25;

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
  /**
   * Se acaba de dibujar una mesa con la herramienta del lienzo, con `nombre`
   * como PRIMER número libre del espacio (una propuesta, no un dato real): el
   * padre lo usa para llevar el foco al campo del número en el panel lateral,
   * de modo que el dueño pueda corregirlo al momento por el número que esa
   * mesa tiene de verdad en la sala.
   */
  onMesaCreada?: (mesaId: string, nombre: string) => void;
}

export interface CanvasPlanoRef {
  clearCanvas: () => void;
  removeElement: (id: string) => void;
  getCanvas: () => HTMLCanvasElement | null;
  /** PNG (dataURL) del contenido del plano a 2x, sin grid, encuadrado a los límites del contenido dibujado. */
  exportImage: () => string | null;
  setZoom: (zoom: number) => void;
  /** Desagrupa una mesa fusionada y devuelve las mesas resultantes (o null si no había nada que desagrupar). */
  unmergeMesa: (mesaId: string) => MesaCanvas[] | null;
  /**
   * Cambia el número de una mesa ya dibujada: actualiza su `customData.nombre`
   * y redibuja su etiqueta con el número nuevo. El estado de React
   * (`mesasCanvas`) y la BBDD los actualiza el llamador (`PanelLateral`).
   */
  updateMesaNombre: (mesaId: string, nombre: string) => void;
  updateMesaBocadillo: (mesaId: string, etiqueta: string | null) => void;
  centerOnContent: () => void;
  /** Renombra el id (temporal -> real de BBDD) de una mesa ya presente en el canvas, en su objeto y en su etiqueta/bocadillo asociados. */
  renameMesaId: (oldId: string, newId: string) => void;
  /**
   * Vacía el canvas (igual que clearCanvas, sin tocar el grid) y lo
   * reconstruye por completo a partir de un snapshot arbitrario de
   * `elementos`/`mesasCanvas` — la operación que necesita undo/redo, que NO
   * puede resolverse con el efecto de "cargar elementos" (ese solo AÑADE lo
   * que falta, nunca reconcilia quitando lo que ya no debería estar). NO
   * actualiza el estado de React (elementos/mesasCanvas): eso lo hace el
   * llamador. Preserva el viewport (zoom/pan) actual y descarta la selección
   * activa.
   */
  reloadFromSnapshot: (snapshot: { elementos: ElementoCanvas[]; mesasCanvas: MesaCanvas[] }) => void;
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
  onMesaCreada,
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
  const snapIndicatorRef = useRef<InstanceType<typeof Circle> | null>(null);
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
    exportImage: () => {
      if (!fabricCanvas) return null;

      fabricCanvas.discardActiveObject();

      const prevVpt = fabricCanvas.viewportTransform
        ? [...fabricCanvas.viewportTransform]
        : ([1, 0, 0, 1, 0, 0] as any);

      // Ocultar temporalmente el grid y los indicadores de snap/guías: no
      // deben salir en la imagen exportada (antes el export era un toDataURL
      // literal del viewport, con zoom, pan y grid incluidos).
      const hidden: FabricObject[] = [];
      fabricCanvas.getObjects().forEach((obj) => {
        if ((obj as any).isGrid || (obj as any).isSnapIndicator || (obj as any).isAlignmentGuide) {
          if (obj.visible !== false) {
            hidden.push(obj);
            obj.visible = false;
          }
        }
      });

      try {
        // Medir en coordenadas de mundo (viewport identidad) para exportar el
        // contenido real, no lo que se ve encuadrado en pantalla.
        fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0] as any);

        const relevantTypes = ["wall", "area", "door", "mesa"];
        const objects = fabricCanvas.getObjects().filter((obj) => {
          const customData = (obj as any).customData;
          return customData?.tipo && relevantTypes.includes(customData.tipo);
        });

        let left = 0, top = 0, width = fabricCanvas.getWidth(), height = fabricCanvas.getHeight();

        if (objects.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          objects.forEach((obj) => {
            obj.setCoords();
            obj.getCoords().forEach((p) => {
              minX = Math.min(minX, p.x);
              minY = Math.min(minY, p.y);
              maxX = Math.max(maxX, p.x);
              maxY = Math.max(maxY, p.y);
            });
          });
          if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
            const padding = 40;
            left = minX - padding;
            top = minY - padding;
            width = maxX - minX + padding * 2;
            height = maxY - minY + padding * 2;
          }
        }

        fabricCanvas.renderAll();

        return fabricCanvas.toDataURL({
          format: "png",
          left,
          top,
          width,
          height,
          multiplier: 2,
        });
      } finally {
        hidden.forEach((obj) => { obj.visible = true; });
        fabricCanvas.setViewportTransform(prevVpt as any);
        fabricCanvas.renderAll();
      }
    },
    setZoom: (zoom: number) => {
      if (!fabricCanvas) return;
      const clampedZoom = Math.max(0.25, Math.min(3, zoom));
      fabricCanvas.setZoom(clampedZoom);
      fabricCanvas.renderAll();
      onZoomChange?.(clampedZoom);
    },
    unmergeMesa: (mesaId: string) => {
      if (!fabricCanvas) return null;

      const mesaAgrupada = mesasCanvasRef.current.find(m => m.id === mesaId);
      if (!mesaAgrupada || !mesaAgrupada.isMerged || !mesaAgrupada.originalMesas) return null;
      
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

      // NÚMEROS AL DESAGRUPAR: los nombres salen de `original_mesas` y pueden
      // chocar con mesas que YA existan con ese número — el caso del Salón de
      // producción, donde al fusionar nunca se borraron las filas originales
      // (ver el comentario del borrado silencioso en EditorPlanoEspacio) y
      // conviven con las fusionadas. El choque se resuelve con sufijo "-bis" y
      // se avisa con un toast: nunca en silencio, porque este es el camino por
      // el que se recuperan las mesas reales de un espacio roto y el dueño
      // tiene que saber qué números revisar. La propia mesa fusionada no
      // estorba: `is_merged` la excluye de la comprobación.
      const nombresResueltos = resolverChoquesNombresMesa(
        mesaAgrupada.originalMesas.map((o) => o.nombre),
        mesasCanvasParaNombre(mesasCanvasRef.current),
      );

      mesaAgrupada.originalMesas.forEach((originalMesa, index) => {
        const anchoPixels = originalMesa.ancho / 100 * pixelsPerMeterRef.current;
        const altoPixels = originalMesa.alto / 100 * pixelsPerMeterRef.current;

        const posXPixels = baseX + offsetX;
        const posYPixels = baseY;
        const newId = `mesa-temp-${Date.now()}-${index}`;
        const nombreAsignado = nombresResueltos[index]?.asignado ?? originalMesa.nombre;

        const obj = createMesaTableObject({
          id: newId,
          nombre: nombreAsignado,
          capacidad: originalMesa.capacidad,
          forma: originalMesa.forma,
          anchoCm: originalMesa.ancho,
          altoCm: originalMesa.alto,
          posXPixels,
          posYPixels,
        });
        fabricCanvas.add(obj);
        renderSillasMesa(fabricCanvas, obj);

        crearMesaLabelEnCentro(fabricCanvas, {
          mesaId: newId,
          nombre: nombreAsignado,
          capacidad: originalMesa.capacidad,
          forma: originalMesa.forma,
          anchoCm: originalMesa.ancho,
          altoCm: originalMesa.alto,
          centerX: posXPixels + anchoPixels / 2,
          centerY: posYPixels + altoPixels / 2,
        });

        // Añadir al array de nuevas mesas
        newMesas.push({
          id: newId,
          nombre: nombreAsignado,
          capacidad: originalMesa.capacidad,
          forma: originalMesa.forma,
          ancho: originalMesa.ancho,
          alto: originalMesa.alto,
          posX: posXPixels / pixelsPerMeterRef.current,
          posY: posYPixels / pixelsPerMeterRef.current,
        });

        offsetX += anchoPixels + 20; // Separar las mesas un poco
      });

      const avisoNombres = mensajeChoquesResueltos(nombresResueltos);
      if (avisoNombres) toast.warning(avisoNombres, { duration: 10000 });

      // Actualizar estado
      const updatedMesas = mesasCanvasRef.current
        .filter(m => m.id !== mesaId)
        .concat(newMesas);
      
      onMesasChange(updatedMesas);
      fabricCanvas.discardActiveObject();
      fabricCanvas.renderAll();

      // Devolver las mesas nuevas: el llamador (EditorPlanoEspacio) necesita
      // saber si `mesaId` estaba persistida en BBDD para, al guardar, repuntar
      // sus asignaciones_mesa a la primera mesa resultante y borrar su fila.
      return newMesas;
    },
    renameMesaId: (oldId: string, newId: string) => {
      if (!fabricCanvas) return;
      fabricCanvas.getObjects().forEach((obj) => {
        const customData = (obj as any).customData;
        if (!customData) return;
        if (customData.tipo === "mesa" && customData.id === oldId) {
          customData.id = newId;
        } else if (customData.parentId === oldId) {
          customData.parentId = newId;
        }
      });
    },
    reloadFromSnapshot: (snapshot: { elementos: ElementoCanvas[]; mesasCanvas: MesaCanvas[] }) => {
      if (!fabricCanvas) return;

      // Los objetos que pudiera referenciar la selección activa van a
      // desaparecer con el clear de abajo.
      fabricCanvas.discardActiveObject();

      // Quitar TODO excepto el grid (misma lógica que clearCanvas, pero sin
      // notificar al padre — el estado de React lo gestiona el llamador).
      fabricCanvas.getObjects()
        .filter((obj) => !(obj as any).isGrid)
        .forEach((obj) => fabricCanvas.remove(obj));

      // Cancelar cualquier dibujo en curso (pared a medio trazar, etc.): un
      // undo/redo a media acción de dibujo la descarta sin dejar basura.
      tempLinesRef.current = [];
      wallPointsRef.current = [];
      previewLineRef.current = null;
      measureTextRef.current = null;
      setSnapIndicator(fabricCanvas, null);
      clearAlignmentGuides(fabricCanvas);

      // Adelantar los refs antes de reconstruir: si el usuario interactúa con
      // el canvas antes de que React re-renderice con el nuevo estado, estos
      // refs (que leen los handlers de mouse) ya deben reflejar el snapshot
      // recién aplicado. También evita que el efecto de carga de mesas desde
      // BD (mesasInitializedRef) vuelva a intentar cargar mesasDB por encima.
      elementosRef.current = snapshot.elementos;
      mesasCanvasRef.current = snapshot.mesasCanvas;
      mesasInitializedRef.current = true;

      // --- Reconstruir elementos (paredes/áreas/puertas), reusando el mismo
      // switch que el efecto de carga inicial (líneas "Cargar elementos"). ---
      snapshot.elementos.forEach((elem: any) => {
        let obj: FabricObject | null = null;
        const x1 = elem.props?.x1 ?? elem.x1 ?? 0;
        const y1 = elem.props?.y1 ?? elem.y1 ?? 0;
        const x2 = elem.props?.x2 ?? elem.x2 ?? 0;
        const y2 = elem.props?.y2 ?? elem.y2 ?? 0;
        const anguloGuardado = elem.props?.angle ?? elem.angle ?? 0;

        switch (elem.tipo) {
          case "wall":
            obj = new Line([x1, y1, x2, y2], {
              stroke: WALL_COLOR,
              strokeWidth: getWallStrokeWidth(),
              strokeLineCap: "square",
              selectable: true,
              hasControls: true,
            });
            break;
          case "area":
            obj = new Rect({
              left: elem.props?.left ?? elem.left ?? 0,
              top: elem.props?.top ?? elem.top ?? 0,
              width: elem.props?.width ?? elem.width,
              height: elem.props?.height ?? elem.height,
              angle: anguloGuardado,
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
              left: elem.props?.left ?? elem.left ?? 0,
              top: elem.props?.top ?? elem.top ?? 0,
              width: elem.props?.width ?? elem.width ?? DOOR_WIDTH_METERS * pixelsPerMeterRef.current,
              height: elem.props?.height ?? elem.height ?? DOOR_LEAF_THICKNESS_PX,
              angle: anguloGuardado,
              fill: "#fef3c7",
              stroke: "#d97706",
              strokeWidth: 2,
              rx: 2,
              ry: 2,
            });
            break;
        }

        if (!obj) return;
        (obj as any).customData = { tipo: elem.tipo, id: elem.id };
        fabricCanvas.add(obj);

        if (elem.tipo === "wall") {
          createWallCota(fabricCanvas, x1, y1, x2, y2, elem.id);
        }

        if (elem.tipo === "door") {
          const doorRect = obj as InstanceType<typeof Rect>;
          createDoorSwing(
            fabricCanvas,
            elem.id,
            doorRect.left ?? 0,
            doorRect.top ?? 0,
            doorRect.width ?? DOOR_WIDTH_METERS * pixelsPerMeterRef.current,
            doorRect.height ?? DOOR_LEAF_THICKNESS_PX,
            anguloGuardado
          );
        }
      });

      // --- Reconstruir mesas, reusando exactamente los mismos helpers que
      // usa el resto del componente para crear/etiquetar mesas. ---
      snapshot.mesasCanvas.forEach((mesa) => {
        const ppm = pixelsPerMeterRef.current;
        const posXPixels = mesa.posX * ppm;
        const posYPixels = mesa.posY * ppm;
        const anchoPixels = (mesa.ancho / 100) * ppm;
        const altoPixels = (mesa.alto / 100) * ppm;

        const obj = createMesaTableObject({
          id: mesa.id,
          nombre: mesa.nombre,
          capacidad: mesa.capacidad,
          forma: mesa.forma,
          anchoCm: mesa.ancho,
          altoCm: mesa.alto,
          posXPixels,
          posYPixels,
          rotacion: mesa.rotacion ?? 0,
          isMerged: mesa.isMerged,
          originalMesas: mesa.originalMesas,
        });
        fabricCanvas.add(obj);
        renderSillasMesa(fabricCanvas, obj);

        createMesaLabel(mesa.id, mesa.nombre, mesa.ancho, mesa.alto, mesa.forma, posXPixels, posYPixels, {
          capacidad: mesa.capacidad,
          isMerged: mesa.isMerged,
        });

        if (mesa.etiqueta) {
          createMesaBocadillo(mesa.id, mesa.etiqueta, posXPixels, posYPixels, anchoPixels, altoPixels);
        }
      });

      // Respetar el toggle de "mostrar medidas" tal como estaba (las cotas se
      // acaban de recrear siempre visibles).
      if (!showMeasurements) {
        fabricCanvas.getObjects().forEach((obj) => {
          if ((obj as any).isCota) obj.visible = false;
        });
      }

      // El viewport (zoom/pan) no se toca en ningún punto de arriba: se
      // preserva tal cual estaba.
      fabricCanvas.renderAll();
    },
    updateMesaNombre: (mesaId: string, nombre: string) => {
      if (!fabricCanvas) return;

      const mesaObj = fabricCanvas.getObjects().find((o) => {
        const customData = (o as any).customData;
        return customData?.tipo === "mesa" && customData?.id === mesaId;
      });
      if (!mesaObj) return;

      const customData = (mesaObj as any).customData;
      customData.nombre = nombre;

      // La etiqueta se rehace en vez de reescribir su texto: el tamaño de la
      // fuente depende de lo que mida el texto (un "12" no ocupa lo mismo que
      // un "3"), así que hay que recalcularlo con el helper de siempre.
      fabricCanvas
        .getObjects()
        .filter((o) => {
          const data = (o as any).customData;
          return data?.tipo === "mesa-label" && data?.parentId === mesaId;
        })
        .forEach((o) => fabricCanvas.remove(o));

      // getCenterPoint() vale esté la mesa rotada o no (con origen left/top,
      // left/top ya no es la esquina visible en cuanto hay ángulo).
      const centro = mesaObj.getCenterPoint();
      crearMesaLabelEnCentro(fabricCanvas, {
        mesaId,
        nombre,
        capacidad: customData.capacidad,
        forma: customData.forma ?? "rectangular",
        anchoCm: customData.ancho ?? 80,
        altoCm: customData.alto ?? 80,
        centerX: centro.x,
        centerY: centro.y,
        isMerged: customData.isMerged === true,
      });

      fabricCanvas.renderAll();
    },
    updateMesaBocadillo: (mesaId: string, etiqueta: string | null) => {
      if (!fabricCanvas) return;

      // Primero eliminar el bocadillo existente si lo hay
      const existingBocadillo = fabricCanvas.getObjects().filter(o => {
        const customData = (o as any).customData;
        return customData?.tipo === "mesa-bocadillo" && customData?.parentId === mesaId;
      });
      existingBocadillo.forEach(obj => fabricCanvas.remove(obj));
      
      // Si no hay etiqueta, solo eliminamos y salimos
      if (!etiqueta) {
        fabricCanvas.renderAll();
        return;
      }
      
      // Buscar la mesa para obtener su posición
      const mesaObj = fabricCanvas.getObjects().find(o => {
        const customData = (o as any).customData;
        return customData?.tipo === "mesa" && customData?.id === mesaId;
      });
      
      if (!mesaObj) {
        fabricCanvas.renderAll();
        return;
      }
      
      const objWidth = (mesaObj as any).width || (mesaObj as any).radius * 2 || 0;
      const objHeight = (mesaObj as any).height || (mesaObj as any).radius * 2 || 0;
      const posX = mesaObj.left || 0;
      const posY = mesaObj.top || 0;
      
      // Crear el bocadillo debajo de la mesa
      createMesaBocadillo(mesaId, etiqueta, posX, posY, objWidth, objHeight);
      fabricCanvas.renderAll();
    },
    centerOnContent: () => {
      if (!fabricCanvas) return;

      const debug =
        import.meta.env.DEV &&
        typeof window !== "undefined" &&
        ((window as any).__DEBUG_PLANO__ === true || localStorage.getItem("debug-plano") === "1");

      const log = (...args: any[]) => {
        if (!debug) return;
        // eslint-disable-next-line no-console
        console.log(...args);
      };

      const warn = (...args: any[]) => {
        if (!debug) return;
        // eslint-disable-next-line no-console
        console.warn(...args);
      };

      if (debug) {
        // eslint-disable-next-line no-console
        console.groupCollapsed("[Plano] centerOnContent");
      }

      try {
        // Descartar selección activa para evitar interferencias
        fabricCanvas.discardActiveObject();

        // Guardar viewport actual
        const prevVpt = fabricCanvas.viewportTransform
          ? [...fabricCanvas.viewportTransform]
          : ([1, 0, 0, 1, 0, 0] as any);

        log("prevVpt:", prevVpt);

        // Resetear viewport a identidad para medir en coordenadas de mundo
        fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0] as any);

        // Filtrar solo objetos relevantes: paredes, áreas, puertas y mesas
        const relevantTypes = ["wall", "area", "door", "mesa"];
        const objects = fabricCanvas.getObjects().filter((obj) => {
          const customData = (obj as any).customData;
          return customData?.tipo && relevantTypes.includes(customData.tipo);
        });

        if (debug) {
          const counts = objects.reduce<Record<string, number>>((acc, obj) => {
            const t = (obj as any).customData?.tipo ?? "(sin-tipo)";
            acc[t] = (acc[t] ?? 0) + 1;
            return acc;
          }, {});
          log("relevant objects:", objects.length, counts);
        }

        // Si no hay objetos relevantes, restaurar viewport y salir
        if (objects.length === 0) {
          warn("ABORT: no relevant objects");
          fabricCanvas.setViewportTransform(prevVpt as any);
          fabricCanvas.requestRenderAll();
          return;
        }

        // Calcular bounds en coordenadas de mundo (viewport es identidad ahora)
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        objects.forEach((obj) => {
          obj.setCoords();
          const coords = obj.getCoords();
          coords.forEach((p) => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          });
        });

        log("bounds:", { minX, minY, maxX, maxY });

        // Validar bounds
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
          warn("ABORT: bounds not finite");
          fabricCanvas.setViewportTransform(prevVpt as any);
          fabricCanvas.requestRenderAll();
          return;
        }

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        log("content size:", { contentWidth, contentHeight });

        if (contentWidth <= 0 || contentHeight <= 0) {
          warn("ABORT: contentWidth/contentHeight <= 0");
          fabricCanvas.setViewportTransform(prevVpt as any);
          fabricCanvas.requestRenderAll();
          return;
        }

        const contentCenterX = (minX + maxX) / 2;
        const contentCenterY = (minY + maxY) / 2;

        const cW = fabricCanvas.getWidth();
        const cH = fabricCanvas.getHeight();

        log("canvas size:", { cW, cH });

        const padding = 80;
        const availableWidth = cW - padding * 2;
        const availableHeight = cH - padding * 2;

        log("available:", { availableWidth, availableHeight, padding });

        if (availableWidth <= 0 || availableHeight <= 0) {
          warn("ABORT: availableWidth/availableHeight <= 0");
          fabricCanvas.setViewportTransform(prevVpt as any);
          fabricCanvas.requestRenderAll();
          return;
        }

        const zoomX = availableWidth / contentWidth;
        const zoomY = availableHeight / contentHeight;
        const unclampedZoom = Math.min(zoomX, zoomY);
        const zoom = Math.max(0.3, Math.min(2.5, unclampedZoom));

        const canvasCenterX = cW / 2;
        const canvasCenterY = cH / 2;

        const tx = canvasCenterX - contentCenterX * zoom;
        const ty = canvasCenterY - contentCenterY * zoom;

        log("computed:", {
          zoomX,
          zoomY,
          unclampedZoom,
          zoom,
          contentCenterX,
          contentCenterY,
          tx,
          ty,
        });

        // Validar que los valores son finitos antes de aplicar
        if (!isFinite(zoom) || !isFinite(tx) || !isFinite(ty)) {
          warn("ABORT: zoom/tx/ty not finite");
          fabricCanvas.setViewportTransform(prevVpt as any);
          fabricCanvas.requestRenderAll();
          return;
        }

        // Aplicar nuevo viewport
        fabricCanvas.setViewportTransform([zoom, 0, 0, zoom, tx, ty] as any);
        fabricCanvas.requestRenderAll();
        onZoomChange?.(zoom);

        log("applied viewport:", fabricCanvas.viewportTransform);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[Plano] centerOnContent ERROR", e);
      } finally {
        if (debug) {
          // eslint-disable-next-line no-console
          console.groupEnd();
        }
      }
    }
  }), [fabricCanvas, onElementosChange, onMesasChange, initialZoom, onZoomChange, canvasWidth, canvasHeight, showMeasurements]);

  // Grosor de pared a escala real (~15cm), constante para todas.
  const getWallStrokeWidth = () => WALL_THICKNESS_METERS * pixelsPerMeterRef.current;

  // Recoge los segmentos de pared actualmente en el canvas (para el snapping
  // magnético a esquinas mientras se dibuja una nueva pared).
  const getWallSegments = (canvas: FabricCanvas): SegmentoPared[] => {
    const segmentos: SegmentoPared[] = [];
    canvas.getObjects().forEach((obj) => {
      const cd = (obj as any).customData;
      if (cd?.tipo !== "wall") return;
      const line = obj as InstanceType<typeof Line>;
      segmentos.push({
        x1: line.x1 ?? 0,
        y1: line.y1 ?? 0,
        x2: line.x2 ?? 0,
        y2: line.y2 ?? 0,
      });
    });
    // Incluir también los puntos ya colocados de la pared en curso.
    const puntosEnCurso = wallPointsRef.current;
    for (let i = 0; i < puntosEnCurso.length - 1; i++) {
      segmentos.push({
        x1: puntosEnCurso[i].x,
        y1: puntosEnCurso[i].y,
        x2: puntosEnCurso[i + 1].x,
        y2: puntosEnCurso[i + 1].y,
      });
    }
    return segmentos;
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

    // OJO: usar getBoundingRect() (axis-aligned, en coordenadas de escena) y no
    // left/top/width/height a pelo — con una mesa rotada (control mtr), left/top
    // siguen siendo la esquina "antes de rotar" (Fabric rota siempre alrededor
    // del centro), así que left+width ya no es el borde derecho real y la
    // detección de adyacencia salía mal en cuanto la mesa tenía algo de ángulo.
    movedMesa.setCoords();
    const movedBox = movedMesa.getBoundingRect();
    const movedLeft = movedBox.left;
    const movedTop = movedBox.top;
    const movedRight = movedBox.left + movedBox.width;
    const movedBottom = movedBox.top + movedBox.height;

    // Buscar mesa cercana con la que fusionar
    let mesaToMerge: FabricObject | null = null;
    let mergeDirection: "horizontal" | "vertical" | null = null;

    canvas.getObjects().forEach(obj => {
      const objData = (obj as any).customData;
      if (!objData || objData.tipo !== "mesa" || objData.id === movedData.id) return;

      obj.setCoords();
      const objBox = obj.getBoundingRect();
      const objLeft = objBox.left;
      const objTop = objBox.top;
      const objRight = objBox.left + objBox.width;
      const objBottom = objBox.top + objBox.height;

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

    // Calcular nueva posición (esquina superior izquierda del grupo) — misma
    // bbox axis-aligned que arriba, por si `mesaToMerge` también está rotada.
    const mergedBox = mesaToMerge.getBoundingRect();
    const mergedLeft = mergedBox.left;
    const mergedTop = mergedBox.top;

    const newPosX = Math.min(movedLeft, mergedLeft);
    const newPosY = Math.min(movedTop, mergedTop);

    // Nuevo nombre combinado
    const newNombre = `${mesa1.nombre}+${mesa2.nombre}`;
    const newId = `mesa-grupo-${Date.now()}`;

    // Eliminar ambas mesas del canvas
    canvas.remove(movedMesa);
    canvas.remove(mesaToMerge);

    // Eliminar TODO lo asociado a ambas mesas: etiqueta, sillas y bocadillo
    // (antes solo se quitaba la mesa-label; las sillas y el bocadillo de las
    // dos mesas absorbidas quedaban huérfanos en el canvas — se veían
    // duplicados junto a las sillas de la nueva mesa fusionada).
    canvas.getObjects().forEach(obj => {
      const childData = (obj as any).customData;
      if (childData?.parentId === movedData.id || childData?.parentId === mergeData.id) {
        canvas.remove(obj);
      }
    });

    // Crear nueva mesa fusionada
    const newAnchoPixels = newAncho / 100 * pixelsPerMeterRef.current;
    const newAltoPixels = newAlto / 100 * pixelsPerMeterRef.current;

    const newMesa = createMesaTableObject({
      id: newId,
      nombre: newNombre,
      capacidad: newCapacidad,
      forma: "rectangular",
      anchoCm: newAncho,
      altoCm: newAlto,
      posXPixels: newPosX,
      posYPixels: newPosY,
      isMerged: true,
    });
    // originalMesas aquí guarda solo los IDs de las dos mesas absorbidas (no
    // el objeto completo que espera MesaCanvas["originalMesas"] — es una
    // pieza interna del objeto Fabric, no del estado persistido).
    (newMesa as any).customData.originalMesas = [movedData.id, mergeData.id];

    canvas.add(newMesa);
    renderSillasMesa(canvas, newMesa);

    // Crear etiqueta para la nueva mesa (nombre compuesto "7+8" en verde)
    crearMesaLabelEnCentro(canvas, {
      mesaId: newId,
      nombre: newNombre,
      capacidad: newCapacidad,
      forma: "rectangular",
      anchoCm: newAncho,
      altoCm: newAlto,
      centerX: newPosX + newAnchoPixels / 2,
      centerY: newPosY + newAltoPixels / 2,
      isMerged: true,
    });

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

    // OJO: usar getBoundingRect() (axis-aligned, en coordenadas de escena) para
    // los bordes — con una mesa rotada left/top+width/height ya no describen
    // el rectángulo visible (Fabric rota alrededor del centro, no de left/top),
    // así que las guías/snap salían desalineadas en cuanto había algo de ángulo.
    // Sí es correcto seguir aplicando el offset resultante a movingObj.left/top
    // (el "pivote"): trasladar el objeto desplaza igual al pivote y a su bbox.
    movingObj.setCoords();
    const movingBox = movingObj.getBoundingRect();
    // Bordes/centro para DETECTAR alineación: bbox axis-aligned real.
    const movingLeft = movingBox.left;
    const movingTop = movingBox.top;
    const movingRight = movingBox.left + movingBox.width;
    const movingBottom = movingBox.top + movingBox.height;
    const movingCenterX = movingBox.left + movingBox.width / 2;
    const movingCenterY = movingBox.top + movingBox.height / 2;
    // Pivote real (movingObj.left/top) para APLICAR el snap: trasladar el
    // objeto desplaza igual al pivote y a su bbox, así que el mismo offset
    // calculado sobre los bordes de la bbox es válido aplicado aquí.
    const movingPivotLeft = movingObj.left || 0;
    const movingPivotTop = movingObj.top || 0;

    const SNAP_THRESHOLD = 8; // píxeles de tolerancia para snapping (reducido para movimiento más natural)

    let snapX: number | null = null;
    let snapY: number | null = null;
    let snapXOffset = 0;
    let snapYOffset = 0;

    canvas.getObjects().forEach(obj => {
      const objData = (obj as any).customData;
      if (!objData || objData.tipo !== "mesa" || objData.id === customData.id) return;

      obj.setCoords();
      const objBox = obj.getBoundingRect();
      const objLeft = objBox.left;
      const objTop = objBox.top;
      const objRight = objBox.left + objBox.width;
      const objBottom = objBox.top + objBox.height;
      const objCenterX = objBox.left + objBox.width / 2;
      const objCenterY = objBox.top + objBox.height / 2;

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
      let newLeft = movingPivotLeft;
      let newTop = movingPivotTop;

      if (snapXOffset !== 0 && Math.abs(snapXOffset) < SNAP_THRESHOLD) {
        newLeft = movingPivotLeft + snapXOffset;
      }
      if (snapYOffset !== 0 && Math.abs(snapYOffset) < SNAP_THRESHOLD) {
        newTop = movingPivotTop + snapYOffset;
      }

      if (newLeft !== movingPivotLeft || newTop !== movingPivotTop) {
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
      // Selección con el color de acento (antes usaba el azul por defecto de
      // Fabric, que coincidía "por casualidad" con el de las mesas).
      selectionColor: "rgba(37, 99, 235, 0.08)",
      selectionBorderColor: WALL_COLOR_SELECTED,
      selectionLineWidth: 1,
    });
    fabric.FabricObject.ownDefaults.borderColor = WALL_COLOR_SELECTED;
    fabric.FabricObject.ownDefaults.cornerColor = WALL_COLOR_SELECTED;
    fabric.FabricObject.ownDefaults.cornerStyle = "circle";
    fabric.FabricObject.ownDefaults.transparentCorners = false;

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
      
      const objWidth = (mesaObj as any).width || (mesaObj as any).radius * 2 || 0;
      const objHeight = (mesaObj as any).height || (mesaObj as any).radius * 2 || 0;
      
      const currentX = mesaObj.left || 0;
      const currentY = mesaObj.top || 0;
      
      // Actualizar etiqueta y bocadillo asociados
      canvas.getObjects().forEach((labelObj) => {
        const labelData = (labelObj as any).customData;
        // Actualizar etiqueta interior (mesa-label)
        if (labelData?.tipo === "mesa-label" && labelData?.parentId === customData.id) {
          labelObj.set({
            left: currentX + objWidth / 2,
            top: currentY + objHeight / 2,
          });
        }
        // Actualizar bocadillo (mesa-bocadillo)
        if (labelData?.tipo === "mesa-bocadillo" && labelData?.parentId === customData.id) {
          const centerX = currentX + objWidth / 2;
          const bocadilloY = currentY + objHeight + 8;
          
          if (labelData.subType === "bg") {
            const bgWidth = (labelObj as any).width || 30;
            labelObj.set({
              left: centerX - bgWidth / 2,
              top: bocadilloY,
            });
          } else if (labelData.subType === "pointer") {
            const pointerSize = 5;
            (labelObj as any).set({
              left: centerX - pointerSize,
              top: bocadilloY - pointerSize,
            });
            // Recalcular puntos del triángulo
            const points = [
              { x: centerX - pointerSize, y: bocadilloY },
              { x: centerX + pointerSize, y: bocadilloY },
              { x: centerX, y: bocadilloY - pointerSize },
            ];
            (labelObj as any).points = points;
            (labelObj as any).setCoords();
          } else if (labelData.subType === "text") {
            labelObj.set({
              left: centerX,
              top: bocadilloY + 8, // bgHeight / 2
            });
          }
        }
      });

      // Las sillas siguen a la mesa mientras se arrastra (no solo al soltar).
      renderSillasMesa(canvas, mesaObj);
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

              // Las sillas también deben seguir a la mesa durante el arrastre
              // en selección múltiple (antes solo se movían en el caso de un
              // objeto individual y se quedaban "atrás", desincronizadas).
              renderSillasMesa(canvas, obj, { x: centerX, y: centerY });
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

              // Recolocar las sillas en la posición final (igual que en
              // object:moving) — si no, tras soltar quedaban ancladas a la
              // posición previa al arrastre en selección múltiple.
              renderSillasMesa(canvas, obj, { x: centerX, y: centerY });
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

          const mesa = mesasCanvasRef.current.find(m => m.id === customData.id);
          const anchoPixels = (mesa?.ancho ?? customData.ancho ?? 80) / 100 * pixelsPerMeterRef.current;
          const altoPixels = (mesa?.alto ?? customData.alto ?? 80) / 100 * pixelsPerMeterRef.current;

          // Ajustar la rotación a pasos de 15° al soltar el control de giro.
          // Con origen left/top, cambiar `angle` directamente desplaza el
          // centro visual (Fabric solo compensa left/top automáticamente
          // durante el arrastre interactivo del control) — por eso se
          // recoloca explícitamente con setPositionByOrigin para que el
          // centro no "salte" al redondear el ángulo.
          const anguloActual = target.angle ?? 0;
          const anguloAjustado = snapRotationDeg(anguloActual, ANGLE_SNAP_STEP_DEG);
          if (Math.abs(anguloActual - anguloAjustado) > 0.01) {
            const centroAntes = target.getCenterPoint();
            target.set({ angle: anguloAjustado });
            target.setPositionByOrigin(centroAntes, target.originX as any, target.originY as any);
            target.setCoords();
          }
          customData.rotacion = anguloAjustado;

          // Centro real del objeto (válido esté rotado o no) para derivar la
          // posición "top-left sin rotar" que se persiste — igual que la que
          // ya usaba PlanoEspacio2D (rota por CSS alrededor del centro).
          const centro = target.getCenterPoint();
          const newPosXPixels = centro.x - anchoPixels / 2;
          const newPosYPixels = centro.y - altoPixels / 2;
          const newPosXMeters = newPosXPixels / pixelsPerMeterRef.current;
          const newPosYMeters = newPosYPixels / pixelsPerMeterRef.current;

          // Actualizar la etiqueta asociada a esta mesa (siempre centrada, angle 0)
          canvas.getObjects().forEach((labelObj) => {
            const labelData = (labelObj as any).customData;
            if (labelData?.tipo === "mesa-label" && labelData?.parentId === customData.id) {
              labelObj.set({ left: centro.x, top: centro.y });
            }
          });

          // Sillas: recalculadas según la posición/ángulo finales
          renderSillasMesa(canvas, target);
          canvas.renderAll();

          // Actualizar estado guardando posición en METROS y la rotación
          const currentMesas = mesasCanvasRef.current;
          onMesasChange(
            currentMesas.map((m) =>
              m.id === customData.id
                ? { ...m, posX: newPosXMeters, posY: newPosYMeters, rotacion: anguloAjustado }
                : m
            )
          );

          // Verificar si se puede fusionar con otra mesa cercana
          setTimeout(() => checkAndMergeTables(canvas, target), 50);
        } else if (customData?.tipo === "wall") {
          // Pared: al mover/rotar/estirar sus controles, Fabric solo actualiza
          // left/top/scaleX/scaleY/angle — x1..y2 originales quedan igual en
          // el objeto. Hay que recalcular los extremos absolutos con la
          // matriz de transformación para poder persistirlos (si no, "Guardar"
          // nunca reflejaba el movimiento de una pared).
          const line = target as InstanceType<typeof Line>;
          const puntosLocales = line.calcLinePoints();
          const matriz = line.calcTransformMatrix() as unknown as Matrix2D;
          const { x1, y1, x2, y2 } = calcularPuntosAbsolutosPared(matriz, puntosLocales);

          const currentElementos = elementosRef.current;
          onElementosChange(
            currentElementos.map((e) =>
              e.id === customData.id ? { ...e, props: { ...e.props, x1, y1, x2, y2 } } : e
            )
          );

          // Mover/regenerar su cota tras el cambio de posición/ángulo
          canvas.getObjects().forEach((obj) => {
            const cd = (obj as any).customData;
            if (cd?.tipo === "cota" && cd?.parentId === customData.id) {
              canvas.remove(obj);
            }
          });
          createWallCota(canvas, x1, y1, x2, y2, customData.id);

          canvas.renderAll();
        } else if (customData?.tipo === "area" || customData?.tipo === "door") {
          // Área o puerta: hornear la escala del resize en width/height reales
          // para que "Guardar" persista el nuevo tamaño/posición/rotación
          // (antes no se hacía nada y el cambio se perdía al recargar el plano).
          const rectObj = target as InstanceType<typeof Rect>;
          const geometria = calcularGeometriaRect({
            left: rectObj.left,
            top: rectObj.top,
            width: rectObj.width,
            height: rectObj.height,
            scaleX: rectObj.scaleX,
            scaleY: rectObj.scaleY,
            angle: rectObj.angle,
          });

          // Hornear la escala en el objeto para que no se acumule en futuros resizes
          rectObj.set({
            width: geometria.width,
            height: geometria.height,
            scaleX: 1,
            scaleY: 1,
          });

          // Puerta: re-anclarla a la pared más cercana a su centro (mismo
          // criterio/umbral que al crearla en handleDoorClick) — si no, al
          // arrastrar una puerta ya anclada se quedaba "flotando" separada de
          // la pared en vez de deslizarse pegada a ella.
          if (customData?.tipo === "door") {
            const centerX = geometria.left + geometria.width / 2;
            const centerY = geometria.top + geometria.height / 2;
            // Umbral en unidades de escena equivalente a DOOR_WALL_SNAP_PX de
            // pantalla, igual que el imán de extremos de pared (ENDPOINT_SNAP_PX
            // / zoom) — usa el `canvas` local del closure, no `fabricCanvas`
            // (este handler vive en el useEffect con deps [canvasWidth,
            // canvasHeight], que no se re-ejecuta cuando solo cambia el zoom).
            const zoomActual = canvas.getZoom() || 1;
            let mejorDist = DOOR_WALL_SNAP_PX / zoomActual;
            let anclaje: { left: number; top: number; angle: number } | null = null;

            getWallSegments(canvas).forEach((seg) => {
              const proyeccion = proyectarPuntoEnSegmento({ x: centerX, y: centerY }, seg);
              const dist = Math.hypot(proyeccion.x - centerX, proyeccion.y - centerY);
              if (dist <= mejorDist) {
                mejorDist = dist;
                anclaje = {
                  left: proyeccion.x - geometria.width / 2,
                  top: proyeccion.y - geometria.height / 2,
                  angle: Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1) * (180 / Math.PI),
                };
              }
            });

            if (anclaje) {
              rectObj.set(anclaje);
              rectObj.setCoords();
              geometria.left = anclaje.left;
              geometria.top = anclaje.top;
              geometria.angle = anclaje.angle;
            }
          }

          const currentElementos = elementosRef.current;
          onElementosChange(
            currentElementos.map((e) =>
              e.id === customData.id ? { ...e, props: { ...e.props, ...geometria } } : e
            )
          );

          // La puerta movida/rotada: regenerar su arco de barrido en la nueva posición/ángulo
          if (customData?.tipo === "door") {
            createDoorSwing(canvas, customData.id, geometria.left, geometria.top, geometria.width, geometria.height, geometria.angle);
          }

          canvas.renderAll();
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
      // Ignorar si el foco está en un input o textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      
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

    // Extensión del grid más allá del área visible, solo para poder panear un
    // poco sin ver el borde — antes eran ±5000px fijos (~440 líneas siempre,
    // sin importar el tamaño del canvas); ahora se limita a un margen
    // razonable relativo al propio canvas.
    const gridExtension = Math.max(canvasWidth, canvasHeight, 400) * 0.6;
    const gridStartX = -gridExtension;
    const gridStartY = -gridExtension;
    const gridEndX = canvasWidth + gridExtension;
    const gridEndY = canvasHeight + gridExtension;

    // Colores del grid — más claros que antes (líneas de referencia, no protagonistas)
    const gridColorMinor = "#eef1f5";
    const gridColorMajor = "#e1e6ec";

    const minorStepPx = 0.5 * pixelsPerMeter; // rejilla menor cada 0.5m
    const majorStepPx = 1 * pixelsPerMeter; // rejilla mayor cada 1m

    const startX = Math.floor(gridStartX / minorStepPx) * minorStepPx;
    const startY = Math.floor(gridStartY / minorStepPx) * minorStepPx;

    const addGridLine = (points: [number, number, number, number], isMajor: boolean) => {
      const line = new Line(points, {
        stroke: isMajor ? gridColorMajor : gridColorMinor,
        strokeWidth: isMajor ? 1 : 0.5,
        selectable: false,
        evented: false,
        hoverCursor: "default",
      });
      (line as any).isGrid = true;
      (line as any).excludeFromExport = true;
      (line as any).customData = { tipo: "grid" };
      fabricCanvas.add(line);
      fabricCanvas.sendObjectToBack(line);
    };

    // Líneas verticales
    for (let x = startX; x <= gridEndX; x += minorStepPx) {
      const isMajor = Math.abs(Math.round(x / majorStepPx) * majorStepPx - x) < 0.5;
      addGridLine([x, gridStartY, x, gridEndY], isMajor);
    }

    // Líneas horizontales
    for (let y = startY; y <= gridEndY; y += minorStepPx) {
      const isMajor = Math.abs(Math.round(y / majorStepPx) * majorStepPx - y) < 0.5;
      addGridLine([gridStartX, y, gridEndX, y], isMajor);
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
      // OJO: usar ?? y no || — una pared/área en x=0 o y=0 es una posición
      // válida, no "sin valor" (con || se perdía y se colapsaba a 0/undefined
      // de forma casual, o se leía el campo equivocado si props.x1 era 0).
      const x1 = elem.props?.x1 ?? elem.x1 ?? 0;
      const y1 = elem.props?.y1 ?? elem.y1 ?? 0;
      const x2 = elem.props?.x2 ?? elem.x2 ?? 0;
      const y2 = elem.props?.y2 ?? elem.y2 ?? 0;
      const anguloGuardado = elem.props?.angle ?? elem.angle ?? 0;

      switch (elem.tipo) {
        case "wall": {
          obj = new Line([x1, y1, x2, y2], {
            stroke: WALL_COLOR,
            strokeWidth: getWallStrokeWidth(),
            strokeLineCap: "square",
            selectable: true,
            hasControls: true,
          });
          break;
        }
        case "area":
          obj = new Rect({
            left: elem.props?.left ?? elem.left ?? 0,
            top: elem.props?.top ?? elem.top ?? 0,
            width: elem.props?.width ?? elem.width,
            height: elem.props?.height ?? elem.height,
            angle: anguloGuardado,
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
            left: elem.props?.left ?? elem.left ?? 0,
            top: elem.props?.top ?? elem.top ?? 0,
            width: elem.props?.width ?? elem.width ?? DOOR_WIDTH_METERS * pixelsPerMeter,
            height: elem.props?.height ?? elem.height ?? DOOR_LEAF_THICKNESS_PX,
            angle: anguloGuardado,
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

        // Añadir cota para paredes (mismo estilo — con ticks — que al dibujar/mover)
        if (elem.tipo === "wall") {
          createWallCota(fabricCanvas, x1, y1, x2, y2, elem.id);
        }

        // Arco de barrido para puertas (mismo estilo que al crearlas nuevas)
        if (elem.tipo === "door") {
          const doorRect = obj as InstanceType<typeof Rect>;
          createDoorSwing(
            fabricCanvas,
            elem.id,
            doorRect.left ?? 0,
            doorRect.top ?? 0,
            doorRect.width ?? 40,
            doorRect.height ?? 6,
            anguloGuardado
          );
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

      const obj = createMesaTableObject({
        id: mesa.id,
        nombre: mesa.nombre,
        capacidad: mesa.capacidad,
        forma: mesa.forma,
        anchoCm: mesa.ancho,
        altoCm: mesa.alto,
        posXPixels,
        posYPixels,
        rotacion: mesa.rotacion ?? 0,
        isMerged: mesa.isMerged,
        originalMesas: mesa.originalMesas,
      });
      fabricCanvas.add(obj);
      renderSillasMesa(fabricCanvas, obj);

      // Etiqueta (verde y con el nombre compuesto si es una mesa agrupada)
      createMesaLabel(mesa.id, mesa.nombre, mesa.ancho, mesa.alto, mesa.forma, posXPixels, posYPixels, {
        capacidad: mesa.capacidad,
        isMerged: mesa.isMerged,
      });

      // Si la mesa tiene etiqueta bocadillo, crearla
      if (mesa.etiqueta) {
        createMesaBocadillo(mesa.id, mesa.etiqueta, posXPixels, posYPixels, anchoPixels, altoPixels);
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

      // Las posiciones vienen en metros desde la BD. OJO: usar ?? y no || —
      // una mesa guardada en x=0 o y=0 (pegada al borde) es una posición
      // válida, no "sin posición".
      const posXMeters = mesa.pos_x ?? 0.5;
      const posYMeters = mesa.pos_y ?? 0.5;
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

      const obj = createMesaTableObject({
        id: mesa.id,
        nombre: mesa.nombre,
        capacidad: mesa.capacidad,
        forma: mesa.forma as "rectangular" | "circular",
        anchoCm,
        altoCm,
        posXPixels,
        posYPixels,
        rotacion: mesa.rotacion ?? 0,
        isMerged,
        originalMesas: (mesa.original_mesas as MesaCanvas["originalMesas"]) || undefined,
      });
      fabricCanvas.add(obj);
      renderSillasMesa(fabricCanvas, obj);

      // Etiqueta (verde y con el nombre compuesto si es una mesa agrupada)
      createMesaLabel(mesa.id, mesa.nombre, anchoCm, altoCm, mesa.forma, posXPixels, posYPixels, {
        capacidad: mesa.capacidad,
        isMerged,
      });

      // Si la mesa tiene etiqueta bocadillo, crearla
      if (mesa.etiqueta) {
        createMesaBocadillo(mesa.id, mesa.etiqueta, posXPixels, posYPixels, anchoPixels, altoPixels);
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
        rotacion: mesa.rotacion ?? 0,
        isMerged: isMerged,
        originalMesas: mesa.original_mesas || undefined,
        etiqueta: mesa.etiqueta || null,
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
      // Ignorar clics de dibujo mientras se está paneando con Espacio+arrastrar
      // (antes handleMouseDown no comprobaba spacePressed y cada click con
      // Espacio pulsado añadía un punto de pared/mesa/etc. de todos modos).
      if (spacePressed.current) return;

      const e = opt.e as MouseEvent | undefined;
      // e.detail > 1 es el 2º/3er click de un doble/triple clic: ya lo procesa
      // handleDblClick (finishWallDrawing). Sin este filtro, terminar una
      // pared con doble clic añadía también un punto duplicado en el mismo sitio.
      if (e && e.detail > 1) return;

      // Usar getScenePoint para obtener coordenadas correctas del canvas (con zoom/pan)
      const pointer = fabricCanvas.getScenePoint(opt.e);
      const tool = activeToolRef.current;

      if (tool === "wall") {
        handleWallClick(pointer.x, pointer.y, !!e?.shiftKey);
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
      const e = opt.e as MouseEvent | undefined;
      updatePreviewLine(pointer.x, pointer.y, !!e?.shiftKey);
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

  // Calcula el punto "final" real de un trazo de pared aplicando, en orden:
  // 1) snap de ángulo a 15° (salvo Shift = freeform), 2) snap a rejilla de
  // 10cm, 3) snap magnético a un extremo de pared existente (~10px de
  // pantalla) que tiene prioridad si hay uno cerca.
  const computeSnappedWallPoint = (
    rawX: number,
    rawY: number,
    freeform: boolean
  ): { x: number; y: number; snappedToEndpoint: boolean } => {
    const points = wallPointsRef.current;
    let punto = { x: rawX, y: rawY };

    if (points.length > 0) {
      punto = snapWallAngle(points[points.length - 1], punto, freeform, ANGLE_SNAP_STEP_DEG);
    }
    punto = snapPointToGrid(punto, pixelsPerMeterRef.current, GRID_SNAP_METERS);

    if (fabricCanvas) {
      const zoom = fabricCanvas.getZoom() || 1;
      const thresholdSceneUnits = ENDPOINT_SNAP_PX / zoom;
      const segmentos = getWallSegments(fabricCanvas);
      const endpoint = snapToWallEndpoint(punto, segmentos, thresholdSceneUnits);
      if (endpoint) {
        return { x: endpoint.x, y: endpoint.y, snappedToEndpoint: true };
      }
    }

    return { ...punto, snappedToEndpoint: false };
  };

  // Muestra/oculta un pequeño círculo indicador cuando el punto actual se ha
  // enganchado magnéticamente a un extremo de pared existente.
  const setSnapIndicator = (canvas: FabricCanvas, punto: { x: number; y: number } | null) => {
    if (snapIndicatorRef.current) {
      canvas.remove(snapIndicatorRef.current);
      snapIndicatorRef.current = null;
    }
    if (!punto) return;
    const indicator = new Circle({
      left: punto.x,
      top: punto.y,
      radius: 6,
      fill: "transparent",
      stroke: "#2563eb",
      strokeWidth: 2,
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    });
    (indicator as any).isSnapIndicator = true;
    snapIndicatorRef.current = indicator;
    canvas.add(indicator);
  };

  // Funciones de dibujo
  const handleWallClick = (rawX: number, rawY: number, freeform: boolean) => {
    if (!fabricCanvas) return;

    const points = wallPointsRef.current;
    const { x, y } = computeSnappedWallPoint(rawX, rawY, freeform);

    if (points.length > 0) {
      const lastPoint = points[points.length - 1];

      const line = new Line([lastPoint.x, lastPoint.y, x, y], {
        stroke: WALL_COLOR,
        strokeWidth: getWallStrokeWidth(),
        strokeLineCap: "square",
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

  const updatePreviewLine = (rawX: number, rawY: number, freeform: boolean = false) => {
    if (!fabricCanvas) return;

    const points = wallPointsRef.current;
    if (points.length === 0) return;

    const lastPoint = points[points.length - 1];
    const { x, y, snappedToEndpoint } = computeSnappedWallPoint(rawX, rawY, freeform);

    if (previewLineRef.current) {
      fabricCanvas.remove(previewLineRef.current);
    }

    // Limpiar texto de medida anterior
    if (measureTextRef.current) {
      fabricCanvas.remove(measureTextRef.current);
    }

    const dx = x - lastPoint.x;
    const dy = y - lastPoint.y;

    const preview = new Line([lastPoint.x, lastPoint.y, x, y], {
      stroke: freeform ? "#94a3b8" : WALL_COLOR,
      strokeWidth: 4,
      strokeDashArray: [8, 4],
      strokeLineCap: "square",
      selectable: false,
      evented: false,
    });

    previewLineRef.current = preview;
    fabricCanvas.add(preview);
    setSnapIndicator(fabricCanvas, snappedToEndpoint ? { x, y } : null);

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

  // Función para crear cota (anotación de medida) en una pared.
  // OJO: recibe `canvas` como parámetro en vez de usar el estado `fabricCanvas`
  // capturado por closure — el handler de object:modified para paredes vive en
  // el efecto que crea el canvas (deps [canvasWidth, canvasHeight], no depende
  // de `fabricCanvas`), así que esa closure quedaría con `fabricCanvas` desactualizado
  // (null o una instancia ya `dispose()`ada) y la cota nunca se añadiría al mover/redimensionar una pared.
  const createWallCota = (canvas: FabricCanvas, x1: number, y1: number, x2: number, y2: number, wallId: string) => {

    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthPx = Math.sqrt(dx * dx + dy * dy);
    const lengthM = roundTo5cm(lengthPx / pixelsPerMeterRef.current);

    // Punto medio de la pared
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    // Calcular ángulo de la pared
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    // Offset perpendicular para la línea de cota, por fuera del grosor de la
    // pared (si no, con paredes gruesas la cota quedaba encima del trazo).
    const offsetDistance = getWallStrokeWidth() / 2 + 14;
    const perpAngle = (angle + 90) * (Math.PI / 180);
    const perpX = Math.cos(perpAngle);
    const perpY = Math.sin(perpAngle);
    const offsetX = perpX * offsetDistance;
    const offsetY = perpY * offsetDistance;

    // Línea de cota (fina, paralela a la pared) con marcas ("ticks") en los extremos
    const dimLine = new Line(
      [x1 + offsetX, y1 + offsetY, x2 + offsetX, y2 + offsetY],
      {
        stroke: "#94a3b8",
        strokeWidth: 1,
        selectable: false,
        evented: false,
      }
    );
    (dimLine as any).customData = { tipo: "cota", parentId: wallId };
    (dimLine as any).isCota = true;
    canvas.add(dimLine);

    const tickLen = 5;
    [
      { x: x1 + offsetX, y: y1 + offsetY },
      { x: x2 + offsetX, y: y2 + offsetY },
    ].forEach((p) => {
      const tick = new Line(
        [p.x - perpX * tickLen, p.y - perpY * tickLen, p.x + perpX * tickLen, p.y + perpY * tickLen],
        { stroke: "#94a3b8", strokeWidth: 1, selectable: false, evented: false }
      );
      (tick as any).customData = { tipo: "cota", parentId: wallId };
      (tick as any).isCota = true;
      canvas.add(tick);
    });

    // Texto de la cota, siempre legible (nunca "boca abajo")
    const midOffsetX = midX + offsetX + perpX * 8;
    const midOffsetY = midY + offsetY + perpY * 8;
    const cotaText = new FabricText(`${lengthM.toFixed(2)}m`, {
      left: midOffsetX,
      top: midOffsetY,
      fontSize: 10,
      fontFamily: "system-ui, sans-serif",
      fontWeight: "600",
      fill: "#374151",
      backgroundColor: "rgba(255,255,255,0.85)",
      padding: 2,
      selectable: false,
      evented: false,
      originX: "center",
      originY: "center",
      angle: angle > 90 || angle < -90 ? angle + 180 : angle,
    });

    (cotaText as any).customData = { tipo: "cota", parentId: wallId };
    (cotaText as any).isCota = true;
    canvas.add(cotaText);
  };

  const removeDoorSwing = (canvas: FabricCanvas, doorId: string) => {
    canvas.getObjects().forEach((o) => {
      const cd = (o as any).customData;
      if (cd?.tipo === "door-swing" && cd?.parentId === doorId) canvas.remove(o);
    });
  };

  // Dibuja el arco de barrido (cuarto de círculo) de una puerta: hoja +
  // abanico desde la bisagra (el extremo izquierdo del hueco, antes de
  // rotar). `left/top/width/height/angle` son los mismos que el Rect de la
  // hoja de la puerta.
  const createDoorSwing = (
    canvas: FabricCanvas,
    doorId: string,
    left: number,
    top: number,
    width: number,
    height: number,
    angle: number
  ) => {
    removeDoorSwing(canvas, doorId);

    const rad = (angle * Math.PI) / 180;
    // Bisagra: extremo izquierdo del hueco de puerta, antes de rotar; se
    // rota manualmente por seno/coseno porque el Rect usa origen left/top.
    const localHingeX = 0;
    const localHingeY = height / 2;
    const hingeX = left + localHingeX * Math.cos(rad) - localHingeY * Math.sin(rad);
    const hingeY = top + localHingeX * Math.sin(rad) + localHingeY * Math.cos(rad);

    const swing = new Circle({
      left: hingeX,
      top: hingeY,
      radius: width,
      startAngle: angle,
      endAngle: angle + 90,
      fill: "",
      stroke: "#d97706",
      strokeWidth: 1,
      strokeDashArray: [3, 3],
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    });
    (swing as any).customData = { tipo: "door-swing", parentId: doorId };
    canvas.add(swing);
    // La hoja de la puerta debe quedar por encima de su propio arco de barrido
    const doorLeaf = canvas.getObjects().find((o) => (o as any).customData?.tipo === "door" && (o as any).customData?.id === doorId);
    if (doorLeaf) canvas.bringObjectToFront(doorLeaf);
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

      const wall = new Line([x1, y1, x2, y2], {
        stroke: WALL_COLOR,
        strokeWidth: getWallStrokeWidth(),
        strokeLineCap: "square",
        selectable: true,
        hasControls: true,
      });
      (wall as any).customData = { tipo: "wall", id };
      fabricCanvas.add(wall);
      
      // Añadir cota a la pared
      createWallCota(fabricCanvas, x1, y1, x2, y2, id);
      
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
    setSnapIndicator(fabricCanvas, null);
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
    setSnapIndicator(fabricCanvas, null);
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

  // Helper único para construir el objeto Fabric de una mesa (Rect o Circle),
  // en vez de repetir el mismo bloque en 5 sitios distintos (creación nueva,
  // carga desde estado local, carga desde BD, desagrupar, fusionar). Origen
  // left/top (igual que antes, NO se toca) para no romper el resto del
  // código que asume esa convención al arrastrar/fusionar/alinear mesas;
  // habilita solo el control de rotación (mtr) — el resto de controles de
  // escalado quedan ocultos porque lockScalingX/Y siguen activos.
  const createMesaTableObject = (opts: {
    id: string;
    nombre: string;
    capacidad: number;
    forma: "rectangular" | "circular";
    anchoCm: number;
    altoCm: number;
    posXPixels: number;
    posYPixels: number;
    rotacion?: number;
    isMerged?: boolean;
    originalMesas?: MesaCanvas["originalMesas"];
  }): FabricObject => {
    const ppm = pixelsPerMeterRef.current;
    const anchoPixels = (opts.anchoCm / 100) * ppm;
    const altoPixels = (opts.altoCm / 100) * ppm;
    const rotacion = opts.rotacion ?? 0;

    const fillColor = opts.isMerged ? "#bbf7d0" : "#dbeafe";
    const strokeColor = opts.isMerged ? "#16a34a" : "#2563eb";

    const baseProps: any = {
      left: opts.posXPixels,
      top: opts.posYPixels,
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth: 2,
      originX: "left",
      originY: "top",
      angle: rotacion,
      selectable: true,
      hasControls: true,
      lockScalingX: true,
      lockScalingY: true,
      hoverCursor: "move",
      moveCursor: "move",
      shadow: { color: "rgba(0,0,0,0.1)", blur: 8, offsetX: 2, offsetY: 2 },
    };

    let obj: FabricObject;
    if (opts.forma === "circular") {
      const radiusPixels = Math.min(anchoPixels, altoPixels) / 2;
      obj = new Circle({ ...baseProps, radius: radiusPixels });
    } else {
      obj = new Rect({ ...baseProps, width: anchoPixels, height: altoPixels, rx: 6, ry: 6 });
    }

    (obj as InstanceType<typeof Rect>).setControlsVisibility({
      tl: false, tr: false, bl: false, br: false,
      ml: false, mr: false, mt: false, mb: false,
      mtr: true,
    });

    (obj as any).customData = {
      tipo: "mesa",
      id: opts.id,
      nombre: opts.nombre,
      capacidad: opts.capacidad,
      isMerged: opts.isMerged || false,
      originalMesas: opts.originalMesas || null,
      forma: opts.forma,
      ancho: opts.anchoCm,
      alto: opts.altoCm,
      rotacion,
    };

    return obj;
  };

  const removeChairs = (canvas: FabricCanvas, mesaId: string) => {
    canvas.getObjects().forEach((o) => {
      const cd = (o as any).customData;
      if (cd?.tipo === "mesa-chair" && cd?.parentId === mesaId) canvas.remove(o);
    });
  };

  // (Re)dibuja las sillas alrededor de una mesa según su forma/capacidad,
  // rotadas junto con la mesa. Se apoya en getCenterPoint(), que Fabric
  // calcula correctamente sea cual sea el ángulo actual — evita tener que
  // reinterpretar left/top a mano cuando la mesa está rotada.
  const renderSillasMesa = (
    canvas: FabricCanvas,
    tableObj: FabricObject,
    // Centro absoluto (coords de escena) a usar en vez de tableObj.getCenterPoint():
    // necesario cuando `tableObj` es miembro de una ActiveSelection (mover 2
    // mesas a la vez) — su left/top ahí son relativos al grupo, no al canvas,
    // y getCenterPoint() no da la posición real donde se está dibujando.
    centerOverride?: { x: number; y: number }
  ) => {
    const cd = (tableObj as any).customData;
    if (!cd || cd.tipo !== "mesa") return;
    removeChairs(canvas, cd.id);
    if (!cd.capacidad || cd.capacidad <= 0) return;

    const ppm = pixelsPerMeterRef.current;
    const anchoPixels = (cd.ancho ?? 80) / 100 * ppm;
    const altoPixels = (cd.alto ?? 80) / 100 * ppm;
    const rotacion = tableObj.angle ?? 0;
    const center = centerOverride ?? tableObj.getCenterPoint();

    const sillas = cd.forma === "circular"
      ? distribuirSillasCirculo(cd.capacidad, Math.min(anchoPixels, altoPixels))
      : distribuirSillasRectangular(cd.capacidad, anchoPixels, altoPixels);

    const rotRad = (rotacion * Math.PI) / 180;
    const cos = Math.cos(rotRad);
    const sin = Math.sin(rotRad);
    const chairSize = Math.max(7, Math.min(14, Math.min(anchoPixels, altoPixels) * 0.16));

    sillas.forEach((silla) => {
      const rx = silla.x * cos - silla.y * sin;
      const ry = silla.x * sin + silla.y * cos;
      const chair = new Rect({
        left: center.x + rx,
        top: center.y + ry,
        width: chairSize,
        height: chairSize,
        fill: "#f8fafc",
        stroke: "#94a3b8",
        strokeWidth: 1,
        rx: 3,
        ry: 3,
        originX: "center",
        originY: "center",
        angle: silla.anguloDeg + rotacion,
        selectable: false,
        evented: false,
      });
      (chair as any).customData = { tipo: "mesa-chair", parentId: cd.id };
      canvas.add(chair);
    });

    // La mesa debe quedar por encima de sus propias sillas — salvo que sea
    // miembro de una ActiveSelection (2 mesas movidas a la vez), donde no es
    // un objeto de primer nivel del canvas y reordenarla no aplica/no hace falta.
    if (!(tableObj as any).group) {
      canvas.bringObjectToFront(tableObj);
    }
  };

  // =========================================================================
  // ETIQUETA DE MESA — un solo helper para los 6 sitios que antes construían
  // el FabricText a mano (dibujar mesa, cargar del estado local, cargar de
  // BBDD, desagrupar, fusionar y reconstruir el snapshot de undo/redo).
  //
  // JERARQUÍA: el NÚMERO es el dato con el que el personal identifica la mesa
  // ("la 7"), así que va en la primera línea, grande y en negrita; las plazas
  // y las dimensiones van debajo, en texto secundario más pequeño. Antes todo
  // el texto compartía un fontSize limitado a 5-10px y el número era
  // ilegible de un vistazo.
  //
  // Se usa UN ÚNICO FabricText con `styles` por línea (no dos objetos de
  // texto) porque los handlers de arrastre recolocan por
  // `customData.tipo === "mesa-label"` asumiendo un objeto centrado en la
  // mesa: dos objetos se apilarían uno encima del otro al mover la mesa.
  // =========================================================================
  /** Azul de mesa real (igual que antes). */
  const MESA_LABEL_COLOR = "#1e40af";
  /** Verde de mesa fusionada (igual que antes). */
  const MESA_LABEL_COLOR_MERGED = "#166534";
  /** Texto secundario (plazas/dimensiones): gris que se lee sobre azul y verde. */
  const MESA_LABEL_COLOR_SEC = "#475569";
  /** Por debajo de esto el número no se lee, así que se sacrifica la 2ª línea. */
  const MESA_LABEL_MIN_NUMERO = 9;

  const crearMesaLabelEnCentro = (
    canvas: FabricCanvas,
    opts: {
      mesaId: string;
      nombre: string;
      capacidad?: number | null;
      forma: string;
      anchoCm: number;
      altoCm: number;
      /** Centro de la mesa en coordenadas de escena. */
      centerX: number;
      centerY: number;
      isMerged?: boolean;
    },
  ): FabricText => {
    const ppm = pixelsPerMeterRef.current;
    const anchoPixels = (opts.anchoCm / 100) * ppm;
    const altoPixels = (opts.altoCm / 100) * ppm;

    // Texto secundario CORTO a propósito: cuanto menos ocupe, más grande puede
    // ser el número. Las dimensiones van en cm ("80×80"), que es como se habla
    // de una mesa, en vez del "0.80x0.80m" de antes (10 caracteres solo de
    // medidas dejaban al número sin sitio).
    const dimensionText =
      opts.forma === "circular" ? `Ø${Math.round(opts.anchoCm)}` : `${Math.round(opts.anchoCm)}×${Math.round(opts.altoCm)}`;
    const plazas = opts.capacidad && opts.capacidad > 0 ? `${opts.capacidad}p · ` : "";
    const secundario = `${plazas}${dimensionText}`;
    // Las fusionadas conservan su nombre compuesto ("7+8"), que es justo lo
    // que hay que ver para saber de qué mesas está hecha.
    const numero = (opts.nombre ?? "").trim() || "?";

    const minDimension = Math.min(anchoPixels, altoPixels);
    const colorNumero = opts.isMerged ? MESA_LABEL_COLOR_MERGED : MESA_LABEL_COLOR;
    const maxWidth = anchoPixels * 0.86;
    const maxHeight = altoPixels * 0.86;

    /** Encoge `fontSize` hasta que el texto quepa en `anchoMax`/`altoMax`. */
    const ajustar = (
      texto: string,
      fontSize: number,
      fontWeight: string,
      anchoMax: number,
      altoMax: number,
    ) => {
      const medida = new FabricText(texto, {
        fontSize,
        fontFamily: "system-ui, sans-serif",
        fontWeight,
      });
      let ajustado = fontSize;
      if (medida.width && medida.width > anchoMax) ajustado = ajustado * (anchoMax / medida.width);
      if (medida.height && medida.height > altoMax) {
        ajustado = Math.min(ajustado, fontSize * (altoMax / medida.height));
      }
      return ajustado;
    };

    // 1) El NÚMERO manda: se le da todo el tamaño que quepa a lo ancho y ~60%
    //    del alto (el resto se reserva para la línea secundaria).
    const cabeSecundario = altoPixels >= 24;
    let fontNumero = Math.max(
      7,
      ajustar(
        numero,
        Math.min(26, Math.max(MESA_LABEL_MIN_NUMERO, minDimension / 2.6)),
        "700",
        maxWidth,
        cabeSecundario ? maxHeight * 0.6 : maxHeight,
      ),
    );

    // 2) La línea secundaria se ajusta aparte: si para caber tuviera que
    //    quedarse por debajo de 4px no se dibuja, y el número aprovecha todo el
    //    alto. Nunca al revés: el número es el dato que identifica la mesa.
    let fontSecundario = cabeSecundario
      ? ajustar(secundario, Math.min(10, Math.max(4.5, fontNumero * 0.45)), "500", maxWidth, maxHeight * 0.34)
      : 0;
    const conSecundario = cabeSecundario && fontSecundario >= 4;
    if (!conSecundario) {
      fontSecundario = 0;
      fontNumero = Math.max(7, ajustar(numero, Math.min(26, minDimension / 2), "700", maxWidth, maxHeight));
    }

    const styles: TextStyle = {};
    if (conSecundario) {
      const fila: Record<number, any> = {};
      for (let i = 0; i < secundario.length; i += 1) {
        fila[i] = { fontSize: fontSecundario, fontWeight: "500", fill: MESA_LABEL_COLOR_SEC };
      }
      styles[1] = fila;
    }

    const label = new FabricText(conSecundario ? `${numero}\n${secundario}` : numero, {
      left: opts.centerX,
      top: opts.centerY,
      fontSize: fontNumero,
      fontFamily: "system-ui, sans-serif",
      fontWeight: "700",
      fill: colorNumero,
      textAlign: "center",
      selectable: false,
      evented: false,
      originX: "center",
      originY: "center",
      styles,
    });

    (label as any).customData = { tipo: "mesa-label", parentId: opts.mesaId };
    (label as any).isMesaLabel = true;
    canvas.add(label);
    return label;
  };

  /** Centro de una mesa a partir de su esquina superior izquierda (en píxeles). */
  const centroMesaDesdeEsquina = (
    forma: string,
    anchoCm: number,
    altoCm: number,
    posXPixels: number,
    posYPixels: number,
  ) => {
    const ppm = pixelsPerMeterRef.current;
    const anchoPixels = (anchoCm / 100) * ppm;
    const altoPixels = (altoCm / 100) * ppm;
    if (forma === "circular") {
      const radiusPixels = Math.min(anchoPixels, altoPixels) / 2;
      return { centerX: posXPixels + radiusPixels, centerY: posYPixels + radiusPixels };
    }
    return { centerX: posXPixels + anchoPixels / 2, centerY: posYPixels + altoPixels / 2 };
  };

  // Etiqueta de mesa a partir de su esquina superior izquierda (anchoCm/altoCm
  // en cm, posXPixels/posYPixels en píxeles).
  const createMesaLabel = (
    mesaId: string,
    nombre: string,
    anchoCm: number,
    altoCm: number,
    forma: string,
    posXPixels: number,
    posYPixels: number,
    extra?: { capacidad?: number | null; isMerged?: boolean },
  ) => {
    if (!fabricCanvas) return;
    const { centerX, centerY } = centroMesaDesdeEsquina(forma, anchoCm, altoCm, posXPixels, posYPixels);
    crearMesaLabelEnCentro(fabricCanvas, {
      mesaId,
      nombre,
      capacidad: extra?.capacidad,
      forma,
      anchoCm,
      altoCm,
      centerX,
      centerY,
      isMerged: extra?.isMerged,
    });
  };

  // Función para crear etiqueta bocadillo debajo de la mesa
  const createMesaBocadillo = (mesaId: string, texto: string, posXPixels: number, posYPixels: number, anchoPixels: number, altoPixels: number) => {
    if (!fabricCanvas) return;
    
    // Posición: debajo de la mesa con un margen de 8px
    const bocadilloY = posYPixels + altoPixels + 8;
    const centerX = posXPixels + anchoPixels / 2;
    
    // Calcular ancho aproximado del texto
    const textWidth = texto.length * 5 + 12;
    const bgWidth = Math.max(textWidth, 30);
    const bgHeight = 16;
    
    // Fondo del bocadillo
    const bg = new Rect({
      left: centerX - bgWidth / 2,
      top: bocadilloY,
      width: bgWidth,
      height: bgHeight,
      fill: "#fef3c7",
      stroke: "#d97706",
      strokeWidth: 1,
      rx: 4,
      ry: 4,
      selectable: false,
      evented: false,
    });
    (bg as any).customData = { tipo: "mesa-bocadillo", parentId: mesaId, subType: "bg" };
    fabricCanvas.add(bg);
    
    // Puntero triangular (hacia arriba)
    const pointerSize = 5;
    const pointer = new fabric.Polygon([
      { x: centerX - pointerSize, y: bocadilloY },
      { x: centerX + pointerSize, y: bocadilloY },
      { x: centerX, y: bocadilloY - pointerSize },
    ], {
      fill: "#fef3c7",
      stroke: "#d97706",
      strokeWidth: 1,
      selectable: false,
      evented: false,
    });
    (pointer as any).customData = { tipo: "mesa-bocadillo", parentId: mesaId, subType: "pointer" };
    fabricCanvas.add(pointer);
    
    // Texto de la etiqueta
    const textObj = new FabricText(texto, {
      left: centerX,
      top: bocadilloY + bgHeight / 2,
      fontSize: 9,
      fontFamily: "system-ui, sans-serif",
      fontWeight: "500",
      fill: "#92400e",
      textAlign: "center",
      selectable: false,
      evented: false,
      originX: "center",
      originY: "center",
    });
    (textObj as any).customData = { tipo: "mesa-bocadillo", parentId: mesaId, subType: "text" };
    fabricCanvas.add(textObj);
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

    const currentMesas = mesasCanvasRef.current;
    // NÚMERO DE LA MESA: se propone el PRIMER número libre del espacio, a
    // secas ("7"), no `Mesa ${length + 1}`. Dos motivos:
    //  1. `length + 1` no comprobaba nada: con tres mesas 1/2/3, borrar la 2 y
    //     dibujar otra devolvía "Mesa 3" — un duplicado. Así se fabricaron los
    //     números repetidos de producción.
    //  2. En la sala el personal dice "la 7", no "la Mesa 7": el nombre de la
    //     fila tiene que ser el número que se ve en la mesa de verdad.
    // Es solo una PROPUESTA: `onMesaCreada` lleva el foco al campo del número
    // del panel lateral para que el dueño ponga el real al momento.
    const mesaName = siguienteNumeroMesaLibre(mesasCanvasParaNombre(currentMesas));

    const obj = createMesaTableObject({
      id,
      nombre: mesaName,
      capacidad,
      forma,
      anchoCm,
      altoCm,
      posXPixels,
      posYPixels,
    });

    fabricCanvas.add(obj);
    renderSillasMesa(fabricCanvas, obj);

    // Añadir etiqueta de la mesa (pasando cm y píxeles)
    createMesaLabel(id, mesaName, anchoCm, altoCm, forma, posXPixels, posYPixels, { capacidad });

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
    // El número propuesto es solo eso: avisamos al padre para que el dueño
    // pueda corregirlo inmediatamente en el panel lateral.
    onMesaCreada?.(id, mesaName);
  };

  // Punto más cercano a `punto` sobre el segmento (clampado a sus extremos).
  const proyectarPuntoEnSegmento = (punto: { x: number; y: number }, seg: SegmentoPared) => {
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { x: seg.x1, y: seg.y1 };
    let t = ((punto.x - seg.x1) * dx + (punto.y - seg.y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { x: seg.x1 + t * dx, y: seg.y1 + t * dy };
  };

  const handleDoorClick = (x: number, y: number) => {
    if (!fabricCanvas) return;

    const id = `door-${Date.now()}`;
    const widthPx = DOOR_WIDTH_METERS * pixelsPerMeterRef.current;
    const heightPx = DOOR_LEAF_THICKNESS_PX;

    // Anclar a la pared más cercana (si el clic cae a menos de ~25px de
    // PANTALLA de una, sea cual sea el zoom actual): el hueco se centra
    // sobre la pared y su ángulo se alinea con ella.
    let centerX = x;
    let centerY = y;
    let angle = 0;
    const zoomActual = fabricCanvas.getZoom() || 1;
    let mejorDist = DOOR_WALL_SNAP_PX / zoomActual;

    getWallSegments(fabricCanvas).forEach((seg) => {
      const proyeccion = proyectarPuntoEnSegmento({ x, y }, seg);
      const dist = Math.hypot(proyeccion.x - x, proyeccion.y - y);
      if (dist <= mejorDist) {
        mejorDist = dist;
        centerX = proyeccion.x;
        centerY = proyeccion.y;
        angle = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1) * (180 / Math.PI);
      }
    });

    const left = centerX - widthPx / 2;
    const top = centerY - heightPx / 2;

    const door = new Rect({
      left,
      top,
      width: widthPx,
      height: heightPx,
      angle,
      fill: "#fef3c7",
      stroke: "#d97706",
      strokeWidth: 2,
      rx: 2,
      ry: 2,
      originX: "left",
      originY: "top",
    });

    (door as any).customData = { tipo: "door", id };
    fabricCanvas.add(door);
    createDoorSwing(fabricCanvas, id, left, top, widthPx, heightPx, angle);
    fabricCanvas.setActiveObject(door);
    fabricCanvas.renderAll();

    const currentElementos = elementosRef.current;
    onElementosChange([
      ...currentElementos,
      { id, tipo: "door", props: { left, top, width: widthPx, height: heightPx, angle } },
    ]);
    onToolChange("select");
  };

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full overflow-hidden">
      <canvas ref={canvasRef} id="plano-canvas" className="block" />
    </div>
  );
});

CanvasPlano.displayName = "CanvasPlano";
