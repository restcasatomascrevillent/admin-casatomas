import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PosicionSala } from "@/hooks/useSalas";

interface PosicionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (posicion: Omit<PosicionSala, "id" | "created_at" | "updated_at">) => void;
  salaId: string;
  initialData?: PosicionSala;
  loading?: boolean;
}

export const PosicionForm = ({ open, onOpenChange, onSubmit, salaId, initialData, loading }: PosicionFormProps) => {
  const [nombre, setNombre] = useState(initialData?.nombre || "");
  const [descripcion, setDescripcion] = useState(initialData?.descripcion || "");
  const [capacidad, setCapacidad] = useState(initialData?.capacidad_comensales?.toString() || "");
  const [prioridad, setPrioridad] = useState(initialData?.orden_prioridad?.toString() || "1");
  const [activa, setActiva] = useState(initialData?.activa ?? true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      sala_id: salaId,
      nombre,
      descripcion: descripcion || null,
      capacidad_comensales: parseInt(capacidad),
      orden_prioridad: parseInt(prioridad),
      activa,
    });
    handleClose();
  };

  const handleClose = () => {
    setNombre("");
    setDescripcion("");
    setCapacidad("");
    setPrioridad("1");
    setActiva(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{initialData ? "Editar Posición" : "Nueva Posición"}</DialogTitle>
          <DialogDescription>
            {initialData ? "Modifica los datos de la posición" : "Añade una nueva posición/zona en la sala"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input
                id="nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Zona Ventanas, Mesa 1"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="descripcion">Descripción</Label>
              <Textarea
                id="descripcion"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Descripción opcional"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="capacidad">Capacidad</Label>
                <Input
                  id="capacidad"
                  type="number"
                  min="1"
                  value={capacidad}
                  onChange={(e) => setCapacidad(e.target.value)}
                  placeholder="0"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="prioridad">Orden de Prioridad</Label>
                <Input
                  id="prioridad"
                  type="number"
                  min="1"
                  value={prioridad}
                  onChange={(e) => setPrioridad(e.target.value)}
                  placeholder="1"
                  required
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="activa">Posición Activa</Label>
              <Switch
                id="activa"
                checked={activa}
                onCheckedChange={setActiva}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : initialData ? "Actualizar" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
