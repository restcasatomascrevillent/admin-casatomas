import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Sala } from "@/hooks/useSalas";

interface SalaFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (sala: Omit<Sala, "id" | "user_id" | "created_at" | "updated_at">) => void;
  initialData?: Sala;
  loading?: boolean;
}

export const SalaForm = ({ open, onOpenChange, onSubmit, initialData, loading }: SalaFormProps) => {
  const [nombre, setNombre] = useState(initialData?.nombre || "");
  const [descripcion, setDescripcion] = useState(initialData?.descripcion || "");
  const [capacidadMaxima, setCapacidadMaxima] = useState(initialData?.capacidad_maxima?.toString() || "");
  const [activa, setActiva] = useState(initialData?.activa ?? true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      nombre,
      descripcion: descripcion || null,
      capacidad_maxima: parseInt(capacidadMaxima),
      caracteristicas: {},
      activa,
    });
    handleClose();
  };

  const handleClose = () => {
    setNombre("");
    setDescripcion("");
    setCapacidadMaxima("");
    setActiva(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{initialData ? "Editar Sala" : "Nueva Sala"}</DialogTitle>
          <DialogDescription>
            {initialData ? "Modifica los datos de la sala" : "Crea una nueva sala en tu restaurante"}
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
                placeholder="Ej: Sala Principal"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="descripcion">Descripción</Label>
              <Textarea
                id="descripcion"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Descripción opcional de la sala"
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="capacidad">Capacidad Máxima</Label>
              <Input
                id="capacidad"
                type="number"
                min="1"
                value={capacidadMaxima}
                onChange={(e) => setCapacidadMaxima(e.target.value)}
                placeholder="0"
                required
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="activa">Sala Activa</Label>
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
