import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Square, Circle, Users, Trash2, ChevronDown, ChevronRight, Info, List } from "lucide-react";
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
  
  // Estados para secciones colapsables
  const [openAddMesa, setOpenAddMesa] = useState(true);
  const [openMesasList, setOpenMesasList] = useState(true);
  const [openLeyenda, setOpenLeyenda] = useState(false);
  
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
        pos_x: 1, // Posición inicial en metros
        pos_y: 1, // Posición inicial en metros
      });

      setNewMesa({
        nombre: "",
        capacidad: 2,
        forma: "rectangular",
        ancho: 80,
        alto: 80,
      });
      toast.success(`Mesa "${newMesa.nombre}" creada`);
    } catch (error) {
      toast.error("Error al crear la mesa");
    }
  };

  const handleDeleteMesa = async () => {
    if (!mesaToDelete) return;

    try {
      // Si es una mesa temporal, solo quitarla del estado local
      if (mesaToDelete.id.startsWith("mesa-temp-")) {
        onMesasChange(mesasCanvas.filter((m) => m.id !== mesaToDelete.id));
        onSelectionChange(null);
      } else {
        // Eliminar de la base de datos
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
    <div className="w-72 flex flex-col gap-2 max-h-full overflow-y-auto pr-1">
      {/* Panel de propiedades - siempre visible cuando hay selección */}
      {selectedElement && (
        <Card className="border-2 border-primary/20 bg-primary/5">
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {selectedElement.tipo === "mesa" && <Square className="h-4 w-4 text-blue-500" />}
              {selectedElement.tipo === "wall" && <div className="w-4 h-1 bg-gray-700 rounded" />}
              {selectedElement.tipo === "area" && <Square className="h-4 w-4 text-blue-400" />}
              {selectedElement.tipo === "door" && <div className="w-4 h-2 bg-yellow-500 rounded" />}
              Seleccionado
            </div>
            <div className="text-xs">
              <Badge variant="secondary">
                {selectedElement.tipo === "mesa" && "Mesa"}
                {selectedElement.tipo === "wall" && "Pared"}
                {selectedElement.tipo === "area" && "Área"}
                {selectedElement.tipo === "door" && "Puerta"}
              </Badge>
            </div>

            {selectedElement.tipo === "mesa" && (
              <>
                <div className="text-xs">
                  <span className="text-muted-foreground">Nombre:</span>{" "}
                  <span className="font-medium">{selectedElement.nombre}</span>
                </div>
                <div className="text-xs flex items-center gap-1">
                  <Users className="h-3 w-3 text-muted-foreground" />
                  <span>{selectedElement.capacidad} personas</span>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={() => setMesaToDelete({ id: selectedElement.id, nombre: selectedElement.nombre })}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Eliminar
                </Button>
              </>
            )}
          </div>
        </Card>
      )}

      {/* Añadir mesa - colapsable */}
      <Collapsible open={openAddMesa} onOpenChange={setOpenAddMesa}>
        <Card>
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between p-3 cursor-pointer">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Plus className="h-4 w-4" />
                Añadir Mesa
              </div>
              {openAddMesa ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Nombre</Label>
                <Input
                  placeholder="Ej: Mesa 1"
                  value={newMesa.nombre}
                  onChange={(e) => setNewMesa({ ...newMesa, nombre: e.target.value })}
                  className="h-8"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Forma</Label>
                  <div className="flex gap-1">
                    <Button
                      variant={newMesa.forma === "rectangular" ? "default" : "outline"}
                      size="sm"
                      className="flex-1 h-7"
                      onClick={() => handleFormaChange("rectangular")}
                    >
                      <Square className="h-3 w-3" />
                    </Button>
                    <Button
                      variant={newMesa.forma === "circular" ? "default" : "outline"}
                      size="sm"
                      className="flex-1 h-7"
                      onClick={() => handleFormaChange("circular")}
                    >
                      <Circle className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Capacidad</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={newMesa.capacidad}
                    onChange={(e) => setNewMesa({ ...newMesa, capacidad: parseInt(e.target.value) || 1 })}
                    className="h-8"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Ancho (cm)</Label>
                  <Input
                    type="number"
                    min={30}
                    max={300}
                    value={newMesa.ancho}
                    onChange={(e) => setNewMesa({ ...newMesa, ancho: parseInt(e.target.value) || 80 })}
                    className="h-8"
                  />
                </div>
                {newMesa.forma === "rectangular" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Largo (cm)</Label>
                    <Input
                      type="number"
                      min={30}
                      max={300}
                      value={newMesa.alto}
                      onChange={(e) => setNewMesa({ ...newMesa, alto: parseInt(e.target.value) || 60 })}
                      className="h-8"
                    />
                  </div>
                )}
              </div>

              <Button className="w-full h-8 text-xs" onClick={handleAddMesa} disabled={crearMesa.isPending}>
                <Plus className="h-3 w-3 mr-1" />
                {crearMesa.isPending ? "Creando..." : "Crear Mesa"}
              </Button>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Lista de mesas - colapsable */}
      <Collapsible open={openMesasList} onOpenChange={setOpenMesasList}>
        <Card>
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between p-3 cursor-pointer">
              <div className="flex items-center gap-2 text-sm font-medium">
                <List className="h-4 w-4" />
                Mesas
                <Badge variant="secondary" className="text-xs">{mesasCanvas.length}</Badge>
              </div>
              {openMesasList ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="p-0">
              <ScrollArea className="max-h-32">
                <div className="p-2 space-y-1">
                  {mesasCanvas.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      No hay mesas
                    </p>
                  ) : (
                    mesasCanvas.map((mesa) => (
                      <div
                        key={mesa.id}
                        className={`flex items-center justify-between p-1.5 rounded cursor-pointer transition-colors text-xs ${
                          selectedElement?.id === mesa.id 
                            ? "bg-primary/10 border border-primary/30" 
                            : "bg-muted/50 hover:bg-muted"
                        }`}
                        onClick={() => onSelectionChange({ tipo: "mesa", ...mesa })}
                      >
                        <div className="flex items-center gap-1.5">
                          {mesa.forma === "circular" ? (
                            <Circle className="h-3 w-3 text-blue-500" />
                          ) : (
                            <Square className="h-3 w-3 text-blue-500" />
                          )}
                          <span className="font-medium">{mesa.nombre}</span>
                        </div>
                        <Badge variant="outline" className="text-[10px] py-0 h-5">
                          <Users className="h-2.5 w-2.5 mr-0.5" />
                          {mesa.capacidad}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Leyenda - colapsable, cerrado por defecto */}
      <Collapsible open={openLeyenda} onOpenChange={setOpenLeyenda}>
        <Card>
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between p-3 cursor-pointer">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Info className="h-4 w-4" />
                Leyenda
              </div>
              {openLeyenda ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
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
                <p className="text-xs text-muted-foreground mb-1.5">Nivel de paredes:</p>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-1 bg-green-500 rounded-full" />
                    <span>Recta (0°)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-1 bg-yellow-500 rounded-full" />
                    <span>Casi (&lt;1°)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-1 bg-orange-500 rounded-full" />
                    <span>Desviada (1-3°)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-1 bg-red-500 rounded-full" />
                    <span>Muy (&gt;3°)</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

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
