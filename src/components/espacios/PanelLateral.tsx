import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Square, Circle, Users, Trash2 } from "lucide-react";
import { useCrearMesa, useEliminarMesa } from "@/hooks/useMesas";
import { MesaCanvas } from "./EditorPlanoEspacio";
import { toast } from "sonner";
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

interface PanelLateralProps {
  espacioId: string;
  selectedElement: any;
  mesasCanvas: MesaCanvas[];
  pixelsPerMeterX: number;
  pixelsPerMeterY: number;
  onMesasChange: (mesas: MesaCanvas[]) => void;
  onSelectionChange: (element: any) => void;
}

export function PanelLateral({
  espacioId,
  selectedElement,
  mesasCanvas,
  pixelsPerMeterX,
  pixelsPerMeterY,
  onMesasChange,
  onSelectionChange,
}: PanelLateralProps) {
  const [newMesa, setNewMesa] = useState({
    nombre: "",
    capacidad: 2,
    forma: "rectangular" as "rectangular" | "circular",
    ancho: 80,
    alto: 80,
  });
  
  // Actualizar dimensiones al cambiar forma
  const handleFormaChange = (forma: "rectangular" | "circular") => {
    if (forma === "circular") {
      setNewMesa({ ...newMesa, forma, ancho: 150, alto: 150, capacidad: 6 });
    } else {
      setNewMesa({ ...newMesa, forma, ancho: 80, alto: 80, capacidad: 2 });
    }
  };
  const [mesaToDelete, setMesaToDelete] = useState<{ id: string; nombre: string } | null>(null);

  const crearMesa = useCrearMesa();
  const eliminarMesa = useEliminarMesa();

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
        alto: newMesa.forma === "circular" ? newMesa.ancho : newMesa.alto,
        pos_x: 100,
        pos_y: 100,
      });

      toast.success(`Mesa "${newMesa.nombre}" creada`);
      setNewMesa({ ...newMesa, nombre: "" });
    } catch (error) {
      console.error("Error al crear mesa:", error);
      toast.error("Error al crear la mesa");
    }
  };

  const handleDeleteMesa = async () => {
    if (!mesaToDelete) return;

    try {
      // Si es una mesa temporal (no guardada), solo eliminarla del canvas
      if (mesaToDelete.id.startsWith("mesa-temp-")) {
        onMesasChange(mesasCanvas.filter((m) => m.id !== mesaToDelete.id));
        onSelectionChange(null);
        toast.success("Mesa eliminada");
      } else {
        await eliminarMesa.mutateAsync(mesaToDelete.id);
        onMesasChange(mesasCanvas.filter((m) => m.id !== mesaToDelete.id));
        onSelectionChange(null);
      }
    } catch (error) {
      console.error("Error al eliminar mesa:", error);
      toast.error("Error al eliminar la mesa");
    } finally {
      setMesaToDelete(null);
    }
  };

  return (
    <div className="w-72 flex flex-col gap-4 max-h-full overflow-y-auto pr-1">
      {/* Panel de propiedades */}
      {selectedElement && (
        <Card className="border-2 border-primary/20 bg-primary/5">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              {selectedElement.tipo === "mesa" && <Square className="h-4 w-4 text-blue-500" />}
              {selectedElement.tipo === "wall" && <div className="w-4 h-1 bg-gray-700 rounded" />}
              {selectedElement.tipo === "area" && <Square className="h-4 w-4 text-blue-400" />}
              {selectedElement.tipo === "door" && <div className="w-4 h-2 bg-yellow-500 rounded" />}
              Elemento seleccionado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Tipo:</span>{" "}
              <Badge variant="secondary" className="ml-2">
                {selectedElement.tipo === "mesa" && "Mesa"}
                {selectedElement.tipo === "wall" && "Pared"}
                {selectedElement.tipo === "area" && "Área"}
                {selectedElement.tipo === "door" && "Puerta"}
              </Badge>
            </div>

            {selectedElement.tipo === "mesa" && (
              <>
                <div className="text-sm">
                  <span className="text-muted-foreground">Nombre:</span>{" "}
                  <span className="font-medium">{selectedElement.nombre}</span>
                </div>
                <div className="text-sm flex items-center gap-1">
                  <Users className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Capacidad:</span>{" "}
                  <span className="font-medium">{selectedElement.capacidad} personas</span>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => setMesaToDelete({ id: selectedElement.id, nombre: selectedElement.nombre })}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar mesa
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Añadir mesa */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Añadir Mesa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs">Nombre</Label>
            <Input
              placeholder="Ej: Mesa 1"
              value={newMesa.nombre}
              onChange={(e) => setNewMesa({ ...newMesa, nombre: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label className="text-xs">Forma</Label>
              <div className="flex gap-1">
                <Button
                  variant={newMesa.forma === "rectangular" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => handleFormaChange("rectangular")}
                >
                  <Square className="h-4 w-4" />
                </Button>
                <Button
                  variant={newMesa.forma === "circular" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => handleFormaChange("circular")}
                >
                  <Circle className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Capacidad</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={newMesa.capacidad}
                onChange={(e) => setNewMesa({ ...newMesa, capacidad: parseInt(e.target.value) || 1 })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label className="text-xs">Ancho (cm)</Label>
              <Input
                type="number"
                min={30}
                max={300}
                value={newMesa.ancho}
                onChange={(e) => setNewMesa({ ...newMesa, ancho: parseInt(e.target.value) || 80 })}
              />
            </div>
            {newMesa.forma === "rectangular" && (
              <div className="space-y-2">
                <Label className="text-xs">Largo (cm)</Label>
                <Input
                  type="number"
                  min={30}
                  max={300}
                  value={newMesa.alto}
                  onChange={(e) => setNewMesa({ ...newMesa, alto: parseInt(e.target.value) || 60 })}
                />
              </div>
            )}
          </div>

          <Button className="w-full" onClick={handleAddMesa} disabled={crearMesa.isPending}>
            <Plus className="h-4 w-4 mr-2" />
            {crearMesa.isPending ? "Creando..." : "Crear Mesa"}
          </Button>
        </CardContent>
      </Card>

      {/* Lista de mesas */}
      <Card className="flex-1 min-h-0">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Mesas del espacio</span>
            <Badge variant="secondary">{mesasCanvas.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-48">
            <div className="p-3 space-y-2">
              {mesasCanvas.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No hay mesas. Añade una desde el formulario o haz clic en el canvas.
                </p>
              ) : (
                mesasCanvas.map((mesa) => (
                  <div
                    key={mesa.id}
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                      selectedElement?.id === mesa.id 
                        ? "bg-primary/10 border border-primary/30" 
                        : "bg-muted/50 hover:bg-muted"
                    }`}
                    onClick={() => onSelectionChange({ tipo: "mesa", ...mesa })}
                  >
                    <div className="flex items-center gap-2">
                      {mesa.forma === "circular" ? (
                        <Circle className="h-4 w-4 text-blue-500" />
                      ) : (
                        <Square className="h-4 w-4 text-blue-500" />
                      )}
                      <span className="text-sm font-medium">{mesa.nombre}</span>
                      {mesa.id.startsWith("mesa-temp-") && (
                        <Badge variant="outline" className="text-[10px] py-0">nuevo</Badge>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      <Users className="h-3 w-3 mr-1" />
                      {mesa.capacidad}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Leyenda */}
      <Card>
        <CardHeader className="py-2">
          <CardTitle className="text-xs text-muted-foreground">Leyenda</CardTitle>
        </CardHeader>
        <CardContent className="py-2 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-blue-100 border-2 border-blue-500 rounded" />
              <span>Mesa</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-blue-500/10 border border-blue-500 border-dashed rounded" />
              <span>Área</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-2 bg-yellow-100 border border-yellow-600 rounded" />
              <span>Puerta</span>
            </div>
          </div>
          
          {/* Leyenda de niveles de paredes */}
          <div className="border-t pt-2">
            <p className="text-xs text-muted-foreground mb-2">Nivel de paredes:</p>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-4 h-1.5 bg-green-500 rounded-full" />
                <span>Recta (0°)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-1.5 bg-yellow-500 rounded-full" />
                <span>Casi recta (&lt;1°)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-1.5 bg-orange-500 rounded-full" />
                <span>Desviada (1-3°)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-1.5 bg-red-500 rounded-full" />
                <span>Muy desviada (&gt;3°)</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dialog de confirmación para eliminar mesa */}
      <AlertDialog open={!!mesaToDelete} onOpenChange={() => setMesaToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta mesa?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la mesa "{mesaToDelete?.nombre}". Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMesa} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
