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
  FormLabel,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { borrarFotoSiNoSeUsa } from "@/lib/storage-carta";
import { Vino, useVinos } from "@/hooks/useVinos";
import { toast } from "sonner";
import { CamposVino } from "./CamposVino";

const formSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  categoria: z.string().min(1, "La categoría es obligatoria"),
  precio_eur: z.coerce.number().min(0, "El precio debe ser mayor o igual a 0"),
  descripcion: z.string().optional(),
  ingredientes: z.string().optional(),
  denominacion_origen: z.string().optional(),
  ubicacion_pais: z.string().optional(),
  ubicacion_region: z.string().optional(),
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
      // Foto que esta ficha deja de usar: se borra DESPUÉS de guardar (si el
      // guardado falla, la ficha la sigue mostrando) y solo si ninguna otra
      // ficha la usa (la Magnum comparte la foto de la botella normal).
      let fotoAntigua: string | null = null;

      if (imageFile) {
        const fileExt = imageFile.name.split(".").pop() || "jpg";
        const fileName = `${vino.id}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("vinos")
          .upload(fileName, imageFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from("vinos").getPublicUrl(fileName);
        imageUrlUpdate = `${urlData.publicUrl}?t=${Date.now()}`;
        // Si el nuevo fichero cambia de nombre (p. ej. .jpg -> .png), el upsert
        // no sobrescribe el antiguo: se anota para borrarlo tras guardar.
        const nombreArchivoAnterior = nombreArchivoStorage(vino.id, vino.imagen_url);
        if (nombreArchivoAnterior && nombreArchivoAnterior !== fileName) fotoAntigua = nombreArchivoAnterior;
      } else if (removeImage) {
        imageUrlUpdate = null;
        fotoAntigua = nombreArchivoStorage(vino.id, vino.imagen_url);
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
        // Sin alergenos_oficiales/alergenos_notas a propósito: el modal ya no
        // los muestra y así los valores guardados de cada vino no se tocan.
        ...(imageUrlUpdate !== undefined ? { imagen_url: imageUrlUpdate } : {}),
      });

      if (fotoAntigua) {
        await borrarFotoSiNoSeUsa({ tabla: "Vinos", bucket: "vinos", ruta: fotoAntigua, excluirId: vino.id });
      }

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
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Vino</DialogTitle>
          <DialogDescription>
            Modifica los datos del vino seleccionado
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <FormLabel>Foto de la botella</FormLabel>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageChange}
                accept="image/*"
                className="hidden"
              />

              {imagePreview ? (
                <div className="relative mx-auto h-56 w-full max-w-xs overflow-hidden rounded-lg border bg-muted">
                  <img src={imagePreview} alt="Foto de la botella" className="h-full w-full object-contain" />
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

            <CamposVino
              control={form.control}
              categorias={categorias}
              denominaciones={denominaciones}
              regiones={regiones}
              paises={paises}
            />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="h-11 px-5" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="h-11 px-5" disabled={actualizarVino.isPending || isUploadingImage}>
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
