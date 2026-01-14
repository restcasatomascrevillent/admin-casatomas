import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CalendarIcon, ChevronDown, Languages } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Novedad, NuevaNovedad } from "@/hooks/useNovedades";
import { usePlatos } from "@/hooks/usePlatos";
import { useVinos } from "@/hooks/useVinos";
import { useBebidas } from "@/hooks/useBebidas";

interface NovedadFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  novedad?: Novedad | null;
  onSubmit: (data: NuevaNovedad) => void;
  isLoading?: boolean;
}

const SECCIONES = [
  { value: "carta", label: "Carta General" },
  { value: "web", label: "Web" },
  { value: "redes", label: "Redes Sociales" },
  { value: "promociones", label: "Promociones" },
  { value: "eventos", label: "Eventos" },
];

export function NovedadForm({
  open,
  onOpenChange,
  novedad,
  onSubmit,
  isLoading,
}: NovedadFormProps) {
  const { platos = [] } = usePlatos();
  const { vinos = [] } = useVinos();
  const { bebidas = [] } = useBebidas();

  const [formData, setFormData] = useState<NuevaNovedad>({
    titulo: "",
    descripcion: "",
    tipo_asociacion: null,
    plato_id: null,
    vino_id: null,
    bebida_id: null,
    seccion: null,
    fecha_inicio: new Date().toISOString().split("T")[0],
    fecha_fin: null,
    activo: true,
    destacado: false,
  });

  const [traduccionesOpen, setTraduccionesOpen] = useState(false);

  useEffect(() => {
    if (novedad) {
      setFormData({
        titulo: novedad.titulo,
        descripcion: novedad.descripcion || "",
        tipo_asociacion: novedad.tipo_asociacion,
        plato_id: novedad.plato_id,
        vino_id: novedad.vino_id,
        bebida_id: novedad.bebida_id,
        seccion: novedad.seccion,
        fecha_inicio: novedad.fecha_inicio,
        fecha_fin: novedad.fecha_fin,
        activo: novedad.activo,
        destacado: novedad.destacado,
        titulo_en: novedad.titulo_en || "",
        titulo_fr: novedad.titulo_fr || "",
        descripcion_en: novedad.descripcion_en || "",
        descripcion_fr: novedad.descripcion_fr || "",
      });
    } else {
      setFormData({
        titulo: "",
        descripcion: "",
        tipo_asociacion: null,
        plato_id: null,
        vino_id: null,
        bebida_id: null,
        seccion: null,
        fecha_inicio: new Date().toISOString().split("T")[0],
        fecha_fin: null,
        activo: true,
        destacado: false,
      });
    }
  }, [novedad, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleTipoAsociacionChange = (value: string) => {
    const tipo = value === "ninguna" ? null : (value as NuevaNovedad["tipo_asociacion"]);
    setFormData({
      ...formData,
      tipo_asociacion: tipo,
      plato_id: null,
      vino_id: null,
      bebida_id: null,
      seccion: null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {novedad ? "Editar Novedad" : "Nueva Novedad"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Título */}
          <div className="space-y-2">
            <Label htmlFor="titulo">Título *</Label>
            <Input
              id="titulo"
              value={formData.titulo}
              onChange={(e) =>
                setFormData({ ...formData, titulo: e.target.value })
              }
              placeholder="Ej: Nuevo Menú Degustación"
              required
            />
          </div>

          {/* Descripción */}
          <div className="space-y-2">
            <Label htmlFor="descripcion">Descripción</Label>
            <Textarea
              id="descripcion"
              value={formData.descripcion || ""}
              onChange={(e) =>
                setFormData({ ...formData, descripcion: e.target.value })
              }
              placeholder="Descripción de la novedad..."
              rows={3}
            />
          </div>

          {/* Tipo de Asociación */}
          <div className="space-y-2">
            <Label>Asociar a</Label>
            <Select
              value={formData.tipo_asociacion || "ninguna"}
              onValueChange={handleTipoAsociacionChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sin asociación" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ninguna">Sin asociación</SelectItem>
                <SelectItem value="plato">Plato</SelectItem>
                <SelectItem value="vino">Vino</SelectItem>
                <SelectItem value="bebida">Bebida</SelectItem>
                <SelectItem value="seccion">Sección</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Selector dinámico según tipo */}
          {formData.tipo_asociacion === "plato" && (
            <div className="space-y-2">
              <Label>Seleccionar Plato</Label>
              <Select
                value={formData.plato_id || ""}
                onValueChange={(value) =>
                  setFormData({ ...formData, plato_id: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar plato..." />
                </SelectTrigger>
                <SelectContent>
                  {platos.map((plato) => (
                    <SelectItem key={plato.id} value={plato.id}>
                      {plato.nombre} - {plato.categoria}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {formData.tipo_asociacion === "vino" && (
            <div className="space-y-2">
              <Label>Seleccionar Vino</Label>
              <Select
                value={formData.vino_id || ""}
                onValueChange={(value) =>
                  setFormData({ ...formData, vino_id: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar vino..." />
                </SelectTrigger>
                <SelectContent>
                  {vinos.map((vino) => (
                    <SelectItem key={vino.id} value={vino.id}>
                      {vino.nombre} - {vino.categoria}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {formData.tipo_asociacion === "bebida" && (
            <div className="space-y-2">
              <Label>Seleccionar Bebida</Label>
              <Select
                value={formData.bebida_id || ""}
                onValueChange={(value) =>
                  setFormData({ ...formData, bebida_id: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar bebida..." />
                </SelectTrigger>
                <SelectContent>
                  {bebidas.map((bebida) => (
                    <SelectItem key={bebida.id} value={bebida.id}>
                      {bebida.nombre} - {bebida.categoria}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {formData.tipo_asociacion === "seccion" && (
            <div className="space-y-2">
              <Label>Seleccionar Sección</Label>
              <Select
                value={formData.seccion || ""}
                onValueChange={(value) =>
                  setFormData({ ...formData, seccion: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar sección..." />
                </SelectTrigger>
                <SelectContent>
                  {SECCIONES.map((sec) => (
                    <SelectItem key={sec.value} value={sec.value}>
                      {sec.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fecha inicio *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.fecha_inicio && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.fecha_inicio
                      ? format(new Date(formData.fecha_inicio), "PPP", {
                          locale: es,
                        })
                      : "Seleccionar fecha"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={
                      formData.fecha_inicio
                        ? new Date(formData.fecha_inicio)
                        : undefined
                    }
                    onSelect={(date) =>
                      setFormData({
                        ...formData,
                        fecha_inicio: date
                          ? date.toISOString().split("T")[0]
                          : new Date().toISOString().split("T")[0],
                      })
                    }
                    locale={es}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Fecha fin (opcional)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.fecha_fin && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.fecha_fin
                      ? format(new Date(formData.fecha_fin), "PPP", {
                          locale: es,
                        })
                      : "Sin fecha fin"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <div className="p-2 border-b">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() =>
                        setFormData({ ...formData, fecha_fin: null })
                      }
                    >
                      Sin fecha fin
                    </Button>
                  </div>
                  <Calendar
                    mode="single"
                    selected={
                      formData.fecha_fin
                        ? new Date(formData.fecha_fin)
                        : undefined
                    }
                    onSelect={(date) =>
                      setFormData({
                        ...formData,
                        fecha_fin: date
                          ? date.toISOString().split("T")[0]
                          : null,
                      })
                    }
                    locale={es}
                    disabled={(date) =>
                      formData.fecha_inicio
                        ? date < new Date(formData.fecha_inicio)
                        : false
                    }
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Switches */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="activo"
                checked={formData.activo}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, activo: checked })
                }
              />
              <Label htmlFor="activo">Activo</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="destacado"
                checked={formData.destacado}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, destacado: checked })
                }
              />
              <Label htmlFor="destacado">Destacado</Label>
            </div>
          </div>

          {/* Traducciones */}
          <Collapsible open={traduccionesOpen} onOpenChange={setTraduccionesOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Languages className="h-4 w-4" />
                  Traducciones
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    traduccionesOpen && "rotate-180"
                  )}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Título (EN)</Label>
                  <Input
                    value={formData.titulo_en || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, titulo_en: e.target.value })
                    }
                    placeholder="Title in English"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Título (FR)</Label>
                  <Input
                    value={formData.titulo_fr || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, titulo_fr: e.target.value })
                    }
                    placeholder="Titre en français"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Descripción (EN)</Label>
                  <Textarea
                    value={formData.descripcion_en || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        descripcion_en: e.target.value,
                      })
                    }
                    placeholder="Description in English"
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Descripción (FR)</Label>
                  <Textarea
                    value={formData.descripcion_fr || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        descripcion_fr: e.target.value,
                      })
                    }
                    placeholder="Description en français"
                    rows={2}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Botones */}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || !formData.titulo}>
              {novedad ? "Guardar cambios" : "Crear novedad"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
