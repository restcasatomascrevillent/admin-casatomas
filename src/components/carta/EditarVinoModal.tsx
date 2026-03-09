import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Camera, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ComboboxCreatable } from "@/components/ui/combobox-creatable";
import { supabase } from "@/integrations/supabase/client";
import { Vino, useVinos } from "@/hooks/useVinos";
import { toast } from "sonner";

const formSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  categoria: z.string().min(1, "La categoría es obligatoria"),
  precio_eur: z.coerce.number().min(0, "El precio debe ser mayor o igual a 0"),
  descripcion: z.string().optional(),
  ingredientes: z.string().optional(),
  denominacion_origen: z.string().optional(),
  ubicacion_pais: z.string().optional(),
  ubicacion_region: z.string().optional(),
  alergenos_notas: z.string().optional(),
});

interface EditarVinoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vino: Vino | null;
}

export function EditarVinoModal({ open, onOpenChange, vino }: EditarVinoModalProps) {
  const { actualizarVino, categorias, denominaciones, regiones, paises } = useVinos();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: "",
      precio_eur: 0,
      descripcion: "",
      ingredientes: "",
      denominacion_origen: "",
      ubicacion_pais: "",
      ubicacion_region: "",
      alergenos_notas: "",
    },
  });

  useEffect(() => {
    if (!open || !vino) return;

    form.reset({
      nombre: vino.nombre ?? "",
      categoria: vino.categoria ?? "",
      precio_eur: vino.precio_eur ?? 0,
      descripcion: vino.descripcion ?? "",
      ingredientes: vino.ingredientes ?? "",
      denominacion_origen: vino.denominacion_origen ?? "",
      ubicacion_pais: vino.ubicacion_pais ?? "",
      ubicacion_region: vino.ubicacion_region ?? "",
      alergenos_notas: vino.alergenos_notas ?? "",
    });

    setImageFile(null);
    setImagePreview(vino.imagen_url ?? null);
    setRemoveImage(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [open, vino, form]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageFile(file);
    setRemoveImage(false);

    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setRemoveImage(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!vino) return;

    setIsUploadingImage(true);
    try {
      let imageUrlUpdate: string | null | undefined = undefined;

      if (imageFile) {
        const fileExt = imageFile.name.split(".").pop() || "jpg";
        const fileName = `${vino.id}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("vinos")
          .upload(fileName, imageFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from("vinos").getPublicUrl(fileName);
        imageUrlUpdate = urlData.publicUrl;
      } else if (removeImage) {
        imageUrlUpdate = null;
      }

      await actualizarVino.mutateAsync({
        id: vino.id,
        nombre: values.nombre,
        categoria: values.categoria,
        precio_eur: values.precio_eur,
        descripcion: values.descripcion?.trim() || null,
        ingredientes: values.ingredientes?.trim() || null,
        denominacion_origen: values.denominacion_origen?.trim() || null,
        ubicacion_region: values.ubicacion_region?.trim() || null,
        ubicacion_pais: values.ubicacion_pais?.trim() || null,
        alergenos_notas: values.alergenos_notas?.trim() || null,
        ...(imageUrlUpdate !== undefined ? { imagen_url: imageUrlUpdate } : {}),
      });

      onOpenChange(false);
    } catch (error) {
      console.error("Error updating vino:", error);
      toast.error("No se pudo actualizar el vino");
    } finally {
      setIsUploadingImage(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Vino</DialogTitle>
          <DialogDescription>
            Modifica los datos del vino seleccionado
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input placeholder="Nombre del vino" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="categoria"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría</FormLabel>
                  <FormControl>
                    <ComboboxCreatable
                      value={field.value}
                      onChange={field.onChange}
                      options={categorias}
                      placeholder="Selecciona o crea categoría..."
                      emptyText="No hay categorías"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <FormLabel>Imagen</FormLabel>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageChange}
                accept="image/*"
                capture="environment"
                className="hidden"
              />

              {imagePreview ? (
                <div className="relative w-full h-48 rounded-lg overflow-hidden border">
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2"
                    onClick={clearImage}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <Camera className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Toca para añadir imagen</p>
                </div>
              )}

              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  Cambiar foto
                </Button>
                {imagePreview && (
                  <Button type="button" variant="outline" className="text-destructive" onClick={clearImage}>
                    Quitar foto
                  </Button>
                )}
              </div>
            </div>

            <FormField
              control={form.control}
              name="precio_eur"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Precio (€)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" placeholder="0.00" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="descripcion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descripción del vino"
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="ingredientes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ingredientes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Ingredientes del vino"
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="denominacion_origen"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>D.O.</FormLabel>
                    <FormControl>
                      <ComboboxCreatable
                        value={field.value || ""}
                        onChange={field.onChange}
                        options={denominaciones}
                        placeholder="Selecciona D.O..."
                        emptyText="No hay denominaciones"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="ubicacion_region"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Región</FormLabel>
                    <FormControl>
                      <ComboboxCreatable
                        value={field.value || ""}
                        onChange={field.onChange}
                        options={regiones}
                        placeholder="Selecciona región..."
                        emptyText="No hay regiones"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="ubicacion_pais"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>País</FormLabel>
                    <FormControl>
                      <ComboboxCreatable
                        value={field.value || ""}
                        onChange={field.onChange}
                        options={paises}
                        placeholder="Selecciona país..."
                        emptyText="No hay países"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="alergenos_notas"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Alérgenos / Notas</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Información sobre alérgenos"
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={actualizarVino.isPending || isUploadingImage}>
                {actualizarVino.isPending || isUploadingImage ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  "Guardar cambios"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
