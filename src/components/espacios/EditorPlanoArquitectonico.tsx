import { useEffect, useRef, useState, useCallback } from "react";
import { Canvas as FabricCanvas, Rect, Circle, Line, Polygon, FabricObject } from "fabric";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePlanoEspacio, useCrearOActualizarPlano } from "@/hooks/usePlanosEspacio";
import { useMesas, useCrearMesa, useActualizarMesasSilent, useEliminarMesa, Mesa } from "@/hooks/useMesas";
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
  RotateCw,
  Users,
  Download
} from "lucide-react";

interface EditorPlanoArquitectonicoProps {
  espacioId: string;
  espacioNombre: string;
  onBack: () => void;
}

type ToolType = "select" | "wall" | "rectangle" | "circle" | "polygon" | "mesa" | "silla" | "elemento";

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
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 600 });
  const [selectedObject, setSelectedObject] = useState<FabricObject | null>(null);
  const [wallStart, setWallStart] = useState<{ x: number; y: number } | null>(null);
  const [elementos, setElementos] = useState<ElementoDecorador[]>([]);

  // Configuración de nueva mesa
  const [newMesa, setNewMesa] = useState({
    nombre: "",
    capacidad: 4,
    forma: "rectangular",
    ancho: 80,
    alto: 60,
  });

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

  // Cargar configuración guardada
  useEffect(() => {
    if (!fabricCanvas || !plano) return;

    // Restaurar tamaño del canvas
    if (plano.ancho && plano.alto) {
      setCanvasSize({ width: plano.ancho, height: plano.alto });
      fabricCanvas.setWidth(plano.ancho);
      fabricCanvas.setHeight(plano.alto);
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
              });
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

  // Renderizar mesas desde la base de datos
  useEffect(() => {
    if (!fabricCanvas || loadingMesas) return;

    // Eliminar mesas anteriores del canvas
    const objects = fabricCanvas.getObjects();
    objects.forEach((obj) => {
      if ((obj as any).customData?.tipo === "mesa") {
        fabricCanvas.remove(obj);
      }
    });

    // Añadir mesas
    mesas.forEach((mesa) => {
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

    fabricCanvas.renderAll();
  }, [fabricCanvas, mesas, loadingMesas]);

  // Manejar clicks según herramienta activa
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleMouseDown = (opt: any) => {
      if (activeTool === "select") return;

      // Obtener coordenadas del click
      const pointer = fabricCanvas.getScenePoint(opt.e);

      if (activeTool === "wall") {
        if (!wallStart) {
          setWallStart({ x: pointer.x, y: pointer.y });
        } else {
          const wall = new Line([wallStart.x, wallStart.y, pointer.x, pointer.y], {
            stroke: "#374151",
            strokeWidth: 8,
            selectable: true,
            hasControls: true,
          });
          (wall as any).customData = { tipo: "wall", id: `wall-${Date.now()}` };
          fabricCanvas.add(wall);
          setWallStart(null);
          setElementos(prev => [...prev, { id: `wall-${Date.now()}`, tipo: "wall" }]);
        }
      } else if (activeTool === "rectangle") {
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
      } else if (activeTool === "circle") {
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
      } else if (activeTool === "polygon") {
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
      } else if (activeTool === "silla") {
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
      } else if (activeTool === "elemento") {
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

    fabricCanvas.on("mouse:down", handleMouseDown);

    return () => {
      fabricCanvas.off("mouse:down", handleMouseDown);
    };
  }, [fabricCanvas, activeTool, wallStart]);

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
        elementosCanvas.push({
          ...base,
          x1: (obj as Line).x1,
          y1: (obj as Line).y1,
          x2: (obj as Line).x2,
          y2: (obj as Line).y2,
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
      // Guardar plano
      await guardarPlano.mutateAsync({
        espacio_id: espacioId,
        ancho: canvasSize.width,
        alto: canvasSize.height,
        configuracion: {
          elementos: elementosCanvas,
          version: 1,
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
  }, [fabricCanvas, espacioId, canvasSize, guardarPlano, actualizarMesas]);

  // Añadir nueva mesa
  const handleAddMesa = async () => {
    if (!newMesa.nombre.trim()) {
      toast.error("Introduce un nombre para la mesa");
      return;
    }

    try {
      await crearMesa.mutateAsync({
        espacio_id: espacioId,
        nombre: newMesa.nombre,
        capacidad: newMesa.capacidad,
        forma: newMesa.forma,
        ancho: newMesa.ancho,
        alto: newMesa.alto,
        pos_x: 100,
        pos_y: 100,
      });

      setNewMesa({ nombre: "", capacidad: 4, forma: "rectangular", ancho: 80, alto: 60 });
    } catch (error) {
      console.error("Error al crear mesa:", error);
    }
  };

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
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteSelected}
                disabled={!selectedObject}
                title="Eliminar seleccionado"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* Instrucciones */}
            {activeTool === "wall" && wallStart && (
              <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
                Haz click en otro punto para completar la pared
              </div>
            )}

            {/* Canvas */}
            <div className="border-2 border-dashed border-border rounded-lg overflow-auto bg-white">
              <canvas ref={canvasRef} />
            </div>

            {/* Configuración de tamaño */}
            <div className="flex items-center gap-4 mt-4">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Ancho:</Label>
                <Input
                  type="number"
                  value={canvasSize.width}
                  onChange={(e) => {
                    const w = parseInt(e.target.value) || 800;
                    setCanvasSize((prev) => ({ ...prev, width: w }));
                    fabricCanvas?.setWidth(w);
                  }}
                  className="w-20 h-8"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Alto:</Label>
                <Input
                  type="number"
                  value={canvasSize.height}
                  onChange={(e) => {
                    const h = parseInt(e.target.value) || 600;
                    setCanvasSize((prev) => ({ ...prev, height: h }));
                    fabricCanvas?.setHeight(h);
                  }}
                  className="w-20 h-8"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {mesas.length} mesas configuradas
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Panel lateral */}
        <div className="space-y-4">
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
                    onValueChange={(v) => setNewMesa({ ...newMesa, forma: v })}
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Ancho</Label>
                  <Input
                    type="number"
                    value={newMesa.ancho}
                    onChange={(e) => setNewMesa({ ...newMesa, ancho: parseInt(e.target.value) || 80 })}
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Alto</Label>
                  <Input
                    type="number"
                    value={newMesa.alto}
                    onChange={(e) => setNewMesa({ ...newMesa, alto: parseInt(e.target.value) || 60 })}
                    className="h-8"
                  />
                </div>
              </div>
              <Button size="sm" onClick={handleAddMesa} className="w-full" disabled={crearMesa.isPending}>
                <Plus className="mr-2 h-4 w-4" />
                Añadir Mesa
              </Button>
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
