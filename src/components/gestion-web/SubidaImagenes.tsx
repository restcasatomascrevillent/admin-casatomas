import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Loader2, X, CheckCircle2, Eye, Camera, Image as ImageIcon } from "lucide-react";
import { usePlatos } from "@/hooks/usePlatos";
import { useBebidas } from "@/hooks/useBebidas";
import { useVinos } from "@/hooks/useVinos";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

const formSchema = z.object({
  tipo: z.enum(["platos", "bebidas", "vinos"]),
  categoria: z.string().optional(),
  item_id: z.string().min(1, "Selecciona un elemento"),
  archivo: z.instanceof(FileList).refine((files) => files?.length === 1, "Debes subir un archivo"),
});

type FormValues = z.infer<typeof formSchema>;

export function SubidaImagenes() {
  const { platos, categorias: categoriasPlatos } = usePlatos();
  const { bebidas, categorias: categoriasBebidas } = useBebidas();
  const { vinos, categorias: categoriasVinos } = useVinos();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tipo: "platos",
    },
  });

  const tipoSeleccionado = form.watch("tipo");
  const categoriaSeleccionada = form.watch("categoria");
  const itemIdSeleccionado = form.watch("item_id");

  // Obtener categorías según el tipo seleccionado
  const getCategorias = () => {
    switch (tipoSeleccionado) {
      case "platos":
        return categoriasPlatos || [];
      case "bebidas":
        return categoriasBebidas || [];
      case "vinos":
        return categoriasVinos || [];
      default:
        return [];
    }
  };

  // Filtrar items por categoría seleccionada
  const getItemsFiltrados = () => {
    switch (tipoSeleccionado) {
      case "platos":
        return categoriaSeleccionada
          ? platos?.filter((p) => p.categoria === categoriaSeleccionada && p.activado) || []
          : [];
      case "bebidas":
        return categoriaSeleccionada
          ? bebidas?.filter((b) => b.categoria === categoriaSeleccionada && b.activado) || []
          : [];
      case "vinos":
        return categoriaSeleccionada
          ? vinos?.filter((v) => v.categoria === categoriaSeleccionada && v.activado) || []
          : [];
      default:
        return [];
    }
  };

  // Obtener imagen actual del elemento seleccionado
  const getImagenActual = (): string | null => {
    if (!itemIdSeleccionado) return null;

    switch (tipoSeleccionado) {
      case "platos":
        return platos?.find((p) => p.id === itemIdSeleccionado)?.imagen_url || null;
      case "bebidas":
        return bebidas?.find((b) => b.id === itemIdSeleccionado)?.imagen_url || null;
      case "vinos":
        return vinos?.find((v) => v.id === itemIdSeleccionado)?.imagen_url || null;
      default:
        return null;
    }
  };

  const imagenActual = getImagenActual();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, onChange: (files: FileList) => void) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result as string);
        setShowPreview(true);
      };
      reader.readAsDataURL(file);
      onChange(files);
    }
  };

  const clearPreview = () => {
    setImagePreview(null);
    setShowPreview(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    form.resetField("archivo");
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const archivo = values.archivo[0];
      let itemNombre = "";
      let bucketName = "";

      // Determinar bucket y nombre según el tipo
      if (values.tipo === "platos") {
        const plato = platos?.find((p) => p.id === values.item_id);
        itemNombre = plato?.nombre || "";
        bucketName = "platos";
      } else if (values.tipo === "bebidas") {
        const bebida = bebidas?.find((b) => b.id === values.item_id);
        itemNombre = bebida?.nombre || "";
        bucketName = "bebidas";
      } else if (values.tipo === "vinos") {
        const vino = vinos?.find((v) => v.id === values.item_id);
        itemNombre = vino?.nombre || "";
        bucketName = "vinos";
      }

      // Obtener la extensión del archivo
      const extension = archivo.name.split(".").pop();
      const fileName = `${values.item_id}.${extension}`;

      // Eliminar imágenes anteriores con el mismo ID (cualquier extensión)
      const { data: existingFiles } = await supabase.storage.from(bucketName).list();

      if (existingFiles) {
        const filesToDelete = existingFiles
          .filter((file) => file.name.startsWith(values.item_id))
          .map((file) => file.name);

        if (filesToDelete.length > 0) {
          const { error: deleteError } = await supabase.storage.from(bucketName).remove(filesToDelete);
          if (deleteError) {
            console.warn("Error eliminando imágenes anteriores:", deleteError);
          }
        }
      }

      // Subir archivo a Supabase Storage
      const { error: uploadError } = await supabase.storage.from(bucketName).upload(fileName, archivo, {
        cacheControl: "3600",
        upsert: false,
      });

      if (uploadError) {
        throw new Error(`Error al subir a Supabase Storage: ${uploadError.message}`);
      }

      // Obtener la URL pública
      const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(fileName);

      // Actualizar imagen_url en la tabla correspondiente
      if (values.tipo === "platos") {
        const { error: updateError } = await supabase
          .from("Platos")
          .update({ imagen_url: urlData.publicUrl })
          .eq("id", values.item_id);

        if (updateError) {
          console.warn("Error actualizando imagen_url en Platos:", updateError);
        } else {
          queryClient.invalidateQueries({ queryKey: ["platos"] });
        }
      } else if (values.tipo === "bebidas") {
        const { error: updateError } = await supabase
          .from("Bebidas")
          .update({ imagen_url: urlData.publicUrl })
          .eq("id", values.item_id);

        if (updateError) {
          console.warn("Error actualizando imagen_url en Bebidas:", updateError);
        } else {
          queryClient.invalidateQueries({ queryKey: ["bebidas"] });
        }
      } else if (values.tipo === "vinos") {
        const { error: updateError } = await supabase
          .from("Vinos")
          .update({ imagen_url: urlData.publicUrl })
          .eq("id", values.item_id);

        if (updateError) {
          console.warn("Error actualizando imagen_url en Vinos:", updateError);
        } else {
          queryClient.invalidateQueries({ queryKey: ["vinos"] });
        }
      }

      toast.success(`Imagen de "${itemNombre}" guardada correctamente`);
      form.reset();
      clearPreview();
    } catch (error: any) {
      console.error("Error procesando imagen:", error);
      toast.error("Error al procesar la imagen: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const itemsFiltrados = getItemsFiltrados();
  const categorias = getCategorias();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subir Imágenes</CardTitle>
        <CardDescription>Sube imágenes de platos, bebidas o vinos de tu carta</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Selector de Tipo */}
            <FormField
              control={form.control}
              name="tipo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de elemento</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue("categoria", "");
                      form.setValue("item_id", "");
                      clearPreview();
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Selecciona el tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-popover z-50">
                      <SelectItem value="platos">🍽️ Platos</SelectItem>
                      <SelectItem value="bebidas">🥤 Bebidas</SelectItem>
                      <SelectItem value="vinos">🍷 Vinos</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Selector de Categoría */}
            <FormField
              control={form.control}
              name="categoria"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue("item_id", "");
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Selecciona una categoría" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-popover z-50">
                      {categorias.map((categoria) => (
                        <SelectItem key={categoria} value={categoria}>
                          {categoria}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Selector de Item */}
            <FormField
              control={form.control}
              name="item_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {tipoSeleccionado === "platos" && "Selecciona el plato"}
                    {tipoSeleccionado === "bebidas" && "Selecciona la bebida"}
                    {tipoSeleccionado === "vinos" && "Selecciona el vino"}
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={!categoriaSeleccionada}
                  >
                    <FormControl>
                      <SelectTrigger className="bg-background">
                        <SelectValue
                          placeholder={
                            !categoriaSeleccionada
                              ? "Primero selecciona una categoría"
                              : "Selecciona..."
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-popover z-50">
                      {itemsFiltrados.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Mostrar imagen actual si existe */}
            {itemIdSeleccionado && imagenActual && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 animate-in fade-in-50 duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Imagen actual</span>
                  <Badge variant="secondary" className="text-xs">Guardada</Badge>
                </div>
                <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-md bg-background border">
                  <img
                    src={imagenActual}
                    alt="Imagen actual"
                    className="object-contain w-full h-full"
                  />
                </div>
              </div>
            )}

            {/* Input de archivo con soporte de cámara */}
            <FormField
              control={form.control}
              name="archivo"
              render={({ field: { onChange, value, ...fieldProps } }) => (
                <FormItem>
                  <FormLabel>Nueva imagen</FormLabel>
                  <FormControl>
                    <div className="space-y-4">
                      {/* Input oculto con soporte de cámara */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => handleFileChange(e, onChange)}
                        className="hidden"
                        {...fieldProps}
                      />

                      {/* Botón personalizado para subir/capturar imagen */}
                      {!showPreview && (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full h-32 border-dashed border-2 hover:border-primary hover:bg-primary/5 transition-colors"
                          onClick={triggerFileInput}
                        >
                          <div className="flex flex-col items-center gap-2">
                            <div className="flex items-center gap-3">
                              <Camera className="h-6 w-6 text-muted-foreground" />
                              <Upload className="h-6 w-6 text-muted-foreground" />
                            </div>
                            <span className="text-sm text-muted-foreground">
                              Toca para hacer foto o seleccionar imagen
                            </span>
                          </div>
                        </Button>
                      )}

                      {/* Vista previa de la nueva imagen */}
                      {showPreview && imagePreview && (
                        <div className="relative rounded-lg border-2 border-primary bg-primary/5 p-4 animate-in fade-in-50 duration-500">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <Eye className="h-4 w-4" />
                              Nueva imagen
                              <Badge className="text-xs bg-primary">Por subir</Badge>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 -mt-1 -mr-1"
                              onClick={clearPreview}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>

                          <div className="relative aspect-video w-full overflow-hidden rounded-md bg-background">
                            <img src={imagePreview} alt="Preview" className="object-contain w-full h-full" />
                          </div>

                          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                            Imagen lista para subir
                          </div>
                        </div>
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isSubmitting || !showPreview}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Subiendo imagen...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Subir imagen
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
