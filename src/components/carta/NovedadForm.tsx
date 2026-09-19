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
import { Card, CardContent } from "@/components/ui/card";
import { CalendarIcon, ChevronDown, Languages, UtensilsCrossed, Megaphone, Wine, Coffee, Loader2, Globe } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Novedad, NuevaNovedad } from "@/hooks/useNovedades";
import { usePlatos } from "@/hooks/usePlatos";
import { useVinos } from "@/hooks/useVinos";
import { useBebidas } from "@/hooks/useBebidas";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

type TipoItem = "plato" | "vino" | "bebida";

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
    tipo: "anuncio",
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

  const [tipoItem, setTipoItem] = useState<TipoItem>("plato");
  const [traduccionesOpen, setTraduccionesOpen] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  useEffect(() => {
    if (novedad) {
      setFormData({
        tipo: novedad.tipo,
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
      // Set tipoItem based on existing association
      if (novedad.plato_id) setTipoItem("plato");
      else if (novedad.vino_id) setTipoItem("vino");
      else if (novedad.bebida_id) setTipoItem("bebida");
    } else {
      setFormData({
        tipo: "anuncio",
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
      setTipoItem("plato");
    }
  }, [novedad, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prepare data based on tipo
    const submitData: NuevaNovedad = {
      ...formData,
    };

    if (formData.tipo === "item_carta") {
      // For item_carta, set tipo_asociacion based on selected item
      submitData.tipo_asociacion = tipoItem;
      // Clear titulo for item_carta (it will be derived from the item)
      submitData.titulo = "";
    }

    onSubmit(submitData);
  };

  const handleTipoChange = (tipo: "item_carta" | "anuncio") => {
    setFormData({
      ...formData,
      tipo,
      tipo_asociacion: tipo === "item_carta" ? tipoItem : null,
      plato_id: null,
      vino_id: null,
      bebida_id: null,
      seccion: null,
      titulo: "",
      descripcion: "",
    });
  };

  const handleTipoItemChange = (value: TipoItem) => {
    setTipoItem(value);
    setFormData({
      ...formData,
      tipo_asociacion: value,
      plato_id: null,
      vino_id: null,
      bebida_id: null,
    });
  };

  const handleTranslate = async () => {
    if (!formData.titulo) {
      toast.error("Introduce un título para traducir");
      return;
    }

    setIsTranslating(true);
    try {
      // Antes: llamaba a traducir-carta enviando `nombre` (n8n esperaba
      // `body.titulo`) y leyendo `data.nombre_en` (n8n devolvía `titulo_en`):
      // el botón nunca rellenó nada. Repuntado a traducir-contenido con las
      // claves reales de la tabla novedades.
      const { data, error } = await supabase.functions.invoke("traducir-contenido", {
        body: {
          tipo: "novedad",
          datos: {
            titulo: formData.titulo,
            descripcion: formData.descripcion || "",
          },
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Traducción no disponible");

      const t = data.translations || {};
      setFormData({
        ...formData,
        titulo_en: t.titulo_en || "",
        titulo_fr: t.titulo_fr || "",
        descripcion_en: t.descripcion_en || "",
        descripcion_fr: t.descripcion_fr || "",
      });
      setTraduccionesOpen(true);
      toast.success("Traducciones generadas");
    } catch (error) {
      console.error("Error translating:", error);
      toast.error("Error al traducir");
    } finally {
      setIsTranslating(false);
    }
  };

  // Get selected item preview
  const getSelectedItem = () => {
    if (formData.tipo !== "item_carta") return null;

    if (tipoItem === "plato" && formData.plato_id) {
      return platos.find((p) => p.id === formData.plato_id);
    }
    if (tipoItem === "vino" && formData.vino_id) {
      return vinos.find((v) => v.id === formData.vino_id);
    }
    if (tipoItem === "bebida" && formData.bebida_id) {
      return bebidas.find((b) => b.id === formData.bebida_id);
    }
    return null;
  };

  const selectedItem = getSelectedItem();

  const canSubmit = () => {
    if (formData.tipo === "item_carta") {
      return formData.plato_id || formData.vino_id || formData.bebida_id;
    }
    return formData.titulo?.trim();
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
          {/* Tipo Selection - Only show when creating */}
          {!novedad && (
            <div className="space-y-3">
              <Label>¿Qué tipo de novedad quieres crear?</Label>
              <div className="grid grid-cols-2 gap-3">
                <Card
                  className={cn(
                    "cursor-pointer transition-all hover:border-primary",
                    formData.tipo === "item_carta" && "border-primary bg-primary/5"
                  )}
                  onClick={() => handleTipoChange("item_carta")}
                >
                  <CardContent className="p-4 text-center">
                    <UtensilsCrossed className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <p className="font-medium">Item de Carta</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Destacar plato, vino o bebida
                    </p>
                  </CardContent>
                </Card>
                <Card
                  className={cn(
                    "cursor-pointer transition-all hover:border-primary",
                    formData.tipo === "anuncio" && "border-primary bg-primary/5"
                  )}
                  onClick={() => handleTipoChange("anuncio")}
                >
                  <CardContent className="p-4 text-center">
                    <Megaphone className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <p className="font-medium">Anuncio</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Evento, promo, noticia
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* ITEM DE CARTA MODE */}
          {formData.tipo === "item_carta" && (
            <>
              {/* Tipo de Item */}
              <div className="space-y-2">
                <Label>Tipo de item</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={tipoItem === "plato" ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleTipoItemChange("plato")}
                  >
                    <UtensilsCrossed className="h-4 w-4 mr-1" />
                    Plato
                  </Button>
                  <Button
                    type="button"
                    variant={tipoItem === "vino" ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleTipoItemChange("vino")}
                  >
                    <Wine className="h-4 w-4 mr-1" />
                    Vino
                  </Button>
                  <Button
                    type="button"
                    variant={tipoItem === "bebida" ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleTipoItemChange("bebida")}
                  >
                    <Coffee className="h-4 w-4 mr-1" />
                    Bebida
                  </Button>
                </div>
              </div>

              {/* Item Selector */}
              <div className="space-y-2">
                <Label>Seleccionar {tipoItem}</Label>
                {tipoItem === "plato" && (
                  <Select
                    value={formData.plato_id || ""}
                    onValueChange={(value) =>
                      setFormData({ ...formData, plato_id: value, vino_id: null, bebida_id: null })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar plato..." />
                    </SelectTrigger>
                    <SelectContent>
                      {platos.filter(p => p.activado).map((plato) => (
                        <SelectItem key={plato.id} value={plato.id}>
                          {plato.nombre} - {plato.categoria}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {tipoItem === "vino" && (
                  <Select
                    value={formData.vino_id || ""}
                    onValueChange={(value) =>
                      setFormData({ ...formData, vino_id: value, plato_id: null, bebida_id: null })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar vino..." />
                    </SelectTrigger>
                    <SelectContent>
                      {vinos.filter(v => v.activado).map((vino) => (
                        <SelectItem key={vino.id} value={vino.id}>
                          {vino.nombre} - {vino.categoria}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {tipoItem === "bebida" && (
                  <Select
                    value={formData.bebida_id || ""}
                    onValueChange={(value) =>
                      setFormData({ ...formData, bebida_id: value, plato_id: null, vino_id: null })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar bebida..." />
                    </SelectTrigger>
                    <SelectContent>
                      {bebidas.filter(b => b.activado).map((bebida) => (
                        <SelectItem key={bebida.id} value={bebida.id}>
                          {bebida.nombre} - {bebida.categoria}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Item Preview */}
              {selectedItem && (
                <Card className="bg-muted/50">
                  <CardContent className="p-4">
                    <div className="flex gap-4">
                      {selectedItem.imagen_url && (
                        <img
                          src={selectedItem.imagen_url}
                          alt={selectedItem.nombre || ""}
                          className="w-20 h-20 object-cover rounded-md"
                        />
                      )}
                      <div className="flex-1">
                        <p className="font-medium">{selectedItem.nombre}</p>
                        {"descripcion" in selectedItem && selectedItem.descripcion && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {selectedItem.descripcion}
                          </p>
                        )}
                        <p className="text-sm font-semibold mt-1">
                          {"precio_eur" in selectedItem && selectedItem.precio_eur != null
                            ? `${selectedItem.precio_eur}€`
                            : "precio" in selectedItem && selectedItem.precio != null
                            ? `${selectedItem.precio}€`
                            : ""}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* ANUNCIO MODE */}
          {formData.tipo === "anuncio" && (
            <>
              {/* Título with Translate Button */}
              <div className="space-y-2">
                <Label htmlFor="titulo">Título *</Label>
                <div className="flex gap-2">
                  <Input
                    id="titulo"
                    value={formData.titulo || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, titulo: e.target.value })
                    }
                    placeholder="Ej: Nuevo Menú Degustación"
                    className="flex-1"
                    required
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTranslate}
                    disabled={!formData.titulo || isTranslating}
                  >
                    {isTranslating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Globe className="h-4 w-4" />
                    )}
                    <span className="ml-1">Traducir</span>
                  </Button>
                </div>
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
                  placeholder="Descripción del anuncio..."
                  rows={3}
                />
              </div>

              {/* Sección */}
              <div className="space-y-2">
                <Label>Sección (opcional)</Label>
                <Select
                  value={formData.seccion || "ninguna"}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      seccion: value === "ninguna" ? null : value,
                      tipo_asociacion: value === "ninguna" ? null : "seccion",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sin sección" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ninguna">Sin sección</SelectItem>
                    {SECCIONES.map((sec) => (
                      <SelectItem key={sec.value} value={sec.value}>
                        {sec.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
            </>
          )}

          {/* COMMON FIELDS - Dates and Toggles */}
          <div className="border-t pt-4 space-y-4">
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
          </div>

          {/* Botones */}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || !canSubmit()}>
              {novedad ? "Guardar cambios" : "Crear novedad"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
