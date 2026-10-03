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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Bebida, useBebidas } from "@/hooks/useBebidas";
import { toast } from "sonner";

const formSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  categoria: z.string().min(1, "La categoría es obligatoria"),
  precio_eur: z.coerce.number().min(0, "El precio debe ser mayor o igual a 0"),
  descripcion: z.string().optional(),
  tamano: z.string().optional(),
});

/**
 * Deriva el nombre de fichero en Storage a partir de la URL pública guardada.
 * Todas las subidas de esta carpeta usan `${id}.${extensión}` como nombre
 * (ver más abajo, y BebidaForm/CoctelForm/PlatoForm/VinoForm), así que basta
 * con recuperar la extensión de la URL vieja (sin el `?t=...` que se añade
 * como cache-buster al subir) para reconstruir el path a borrar.
 */
function nombreArchivoStorage(id: string, imagenUrl: string | null | undefined): string | null {
  if (!imagenUrl) return null;
  const sinQuery = imagenUrl.split("?")[0];
  const ext = sinQuery.split(".").pop();
  if (!ext) return null;
  return `${id}.${ext}`;
}

interface EditarBebidaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bebida: Bebida | null;
}

export function EditarBebidaModal({ open, onOpenChange, bebida }: EditarBebidaModalProps) {
  const { actualizarBebida, categorias } = useBebidas();
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
      tamano: "",
    },
  });

  useEffect(() => {
    if (!open || !bebida) return;

    form.reset({
      nombre: bebida.nombre ?? "",
      categoria: bebida.categoria ?? "",
      precio_eur: bebida.precio_eur ?? 0,
      descripcion: bebida.descripcion ?? "",
      tamano: bebida.tamano ?? "",
    });

    setImageFile(null);
    setImagePreview(bebida.imagen_url ?? null);
    setRemoveImage(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [open, bebida, form]);

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
    if (!bebida) return;

    setIsUploadingImage(true);
    try {
      let imageUrlUpdate: string | null | undefined = undefined;

      if (imageFile) {
        const fileExt = imageFile.name.split(".").pop() || "jpg";
        const fileName = `${bebida.id}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("bebidas")
          .upload(fileName, imageFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from("bebidas").getPublicUrl(fileName);
        imageUrlUpdate = `${urlData.publicUrl}?t=${Date.now()}`;

        // Borrado defensivo de la imagen anterior cuando el nuevo fichero
        // cambia de nombre (p.ej. extensión distinta: .jpg -> .png). El
        // upsert solo sobrescribe cuando el nombre coincide EXACTO, y
        // ".JPG"/".jpg" son objetos distintos en Storage, así que sin esto
        // el objeto viejo queda huérfano. Si el borrado falla (fichero ya
        // no existe, red, permisos...) no debe impedir que se guarde el
        // resto de cambios del registro.
        const nombreArchivoAnterior = nombreArchivoStorage(bebida.id, bebida.imagen_url);
        if (nombreArchivoAnterior && nombreArchivoAnterior !== fileName) {
          try {
            const { error: removeError } = await supabase.storage.from("bebidas").remove([nombreArchivoAnterior]);
            if (removeError) {
              console.error("No se pudo borrar la imagen antigua de Storage (bebidas):", removeError);
            }
          } catch (removeErr) {
            console.error("Error borrando imagen antigua de Storage (bebidas):", removeErr);
          }
        }
      } else if (removeImage) {
        imageUrlUpdate = null;

        // Borrado defensivo: si falla (fichero ya no existe, red, permisos...)
        // no debe impedir que se guarde el resto de cambios del registro.
        const nombreArchivo = nombreArchivoStorage(bebida.id, bebida.imagen_url);
        if (nombreArchivo) {
          try {
            const { error: removeError } = await supabase.storage.from("bebidas").remove([nombreArchivo]);
            if (removeError) {
              console.error("No se pudo borrar la imagen antigua de Storage (bebidas):", removeError);
            }
          } catch (removeErr) {
            console.error("Error borrando imagen antigua de Storage (bebidas):", removeErr);
          }
        }
      }

      await actualizarBebida.mutateAsync({
        id: bebida.id,
        nombre: values.nombre,
        categoria: values.categoria,
        precio_eur: values.precio_eur,
        descripcion: values.descripcion?.trim() || null,
        tamano: values.tamano?.trim() || null,
        ...(imageUrlUpdate !== undefined ? { imagen_url: imageUrlUpdate } : {}),
      });

      onOpenChange(false);
    } catch (error) {
      console.error("Error updating bebida:", error);
      toast.error("No se pudo actualizar la bebida");
    } finally {
      setIsUploadingImage(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Bebida</DialogTitle>
          <DialogDescription>
            Modifica los datos de la bebida seleccionada
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
                    <Input placeholder="Nombre de la bebida" {...field} />
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
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona una categoría" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categorias.map((cat) => (
                        <SelectItem key={cat} value={cat || ""}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                className="hidden"
              />

              {imagePreview ? (
                <div className="relative w-full h-48 rounded-lg overflow-hidden border">
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-11 w-11"
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

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="precio_eur"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio (€)</FormLabel>
                    <FormControl>
                      <Input type="number" inputMode="decimal" step="0.01" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tamano"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tamaño</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: 33cl" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="descripcion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descripción de la bebida"
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="h-11 px-5" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="h-11 px-5" disabled={actualizarBebida.isPending || isUploadingImage}>
                {actualizarBebida.isPending || isUploadingImage ? (
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
