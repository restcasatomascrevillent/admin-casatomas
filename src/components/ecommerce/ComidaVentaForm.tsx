import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComboboxCreatable } from "@/components/ui/combobox-creatable";
import { supabase } from "@/integrations/supabase/client";
import { useComidaVenta, ComidaVentaInsert } from "@/hooks/useComidaVenta";
import { Upload, X } from "lucide-react";

const CATEGORIAS_DEFAULT = [
  "Jamón",
  "Lomo Embuchado",
  "Chorizo",
  "Quesos",
];

interface Props {
  onSuccess?: () => void;
}

export function ComidaVentaForm({ onSuccess }: Props) {
  const { addComida, categorias, origenes } = useComidaVenta();
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  
  const [form, setForm] = useState<ComidaVentaInsert>({
    nombre: "",
    categoria: null,
    precio_eur: null,
    descripcion: null,
    imagen_url: null,
    stock: 0,
    peso: null,
    activado: true,
    featured: false,
    orden: null,
    origen: null,
    nombre_en: null,
    nombre_fr: null,
    descripcion_en: null,
    descripcion_fr: null,
    categoria_en: null,
    categoria_fr: null,
  });

  const allCategorias = [...new Set([...CATEGORIAS_DEFAULT, ...categorias])];

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const fileExt = file.name.split(".").pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;

    const { error } = await supabase.storage.from("ecommerce").upload(fileName, file);
    
    if (error) {
      console.error("Error uploading:", error);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("ecommerce").getPublicUrl(fileName);
    setForm({ ...form, imagen_url: urlData.publicUrl });
    setImagePreview(urlData.publicUrl);
    setUploading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim()) return;

    await addComida.mutateAsync(form);
    setForm({
      nombre: "",
      categoria: null,
      precio_eur: null,
      descripcion: null,
      imagen_url: null,
      stock: 0,
      peso: null,
      activado: true,
      featured: false,
      orden: null,
      origen: null,
      nombre_en: null,
      nombre_fr: null,
      descripcion_en: null,
      descripcion_fr: null,
      categoria_en: null,
      categoria_fr: null,
    });
    setImagePreview(null);
    onSuccess?.();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo Producto de Comida</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre *</Label>
              <Input
                id="nombre"
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ej: Jamón Ibérico de Bellota"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Categoría</Label>
              <ComboboxCreatable
                options={allCategorias}
                value={form.categoria || ""}
                onChange={(val) => setForm({ ...form, categoria: val || null })}
                placeholder="Selecciona o crea categoría"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="precio">Precio (€)</Label>
              <Input
                id="precio"
                type="number"
                step="0.01"
                value={form.precio_eur || ""}
                onChange={(e) => setForm({ ...form, precio_eur: e.target.value ? parseFloat(e.target.value) : null })}
                placeholder="45.00"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stock">Stock</Label>
              <Input
                id="stock"
                type="number"
                value={form.stock || 0}
                onChange={(e) => setForm({ ...form, stock: parseInt(e.target.value) || 0 })}
                placeholder="10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="peso">Peso</Label>
              <Input
                id="peso"
                value={form.peso || ""}
                onChange={(e) => setForm({ ...form, peso: e.target.value || null })}
                placeholder="Ej: 100g, 1kg, 5kg"
              />
            </div>

            <div className="space-y-2">
              <Label>Origen</Label>
              <ComboboxCreatable
                options={origenes}
                value={form.origen || ""}
                onChange={(val) => setForm({ ...form, origen: val || null })}
                placeholder="Ej: Guijuelo, La Mancha"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="orden">Orden</Label>
              <Input
                id="orden"
                type="number"
                value={form.orden || ""}
                onChange={(e) => setForm({ ...form, orden: e.target.value ? parseInt(e.target.value) : null })}
                placeholder="1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="descripcion">Descripción</Label>
            <Textarea
              id="descripcion"
              value={form.descripcion || ""}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value || null })}
              placeholder="Descripción del producto..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Imagen</Label>
            <div className="flex items-center gap-4">
              {imagePreview ? (
                <div className="relative">
                  <img src={imagePreview} alt="Preview" className="w-24 h-24 object-cover rounded" />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute -top-2 -right-2 h-6 w-6"
                    onClick={() => {
                      setImagePreview(null);
                      setForm({ ...form, imagen_url: null });
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <label className="flex items-center gap-2 cursor-pointer border border-dashed rounded-lg p-4 hover:bg-muted/50 transition-colors">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {uploading ? "Subiendo..." : "Subir imagen"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                    disabled={uploading}
                  />
                </label>
              )}
            </div>
          </div>

          <Button type="submit" disabled={addComida.isPending || !form.nombre.trim()}>
            {addComida.isPending ? "Añadiendo..." : "Añadir Producto"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
