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
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Plato, usePlatos } from "@/hooks/usePlatos";
import { toast } from "sonner";
import {
  ALERGENOS_OFICIALES,
  combinarAlergenos,
  normalizarAlergeno,
  separarAlergenos,
} from "@/lib/alergenos";

const formSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  categoria: z.string().min(1, "La categoría es obligatoria"),
  precio_eur: z.coerce.number().min(0, "El precio debe ser mayor o igual a 0"),
  descripcion: z.string().optional(),
  ingredientes: z.string().optional(),
  unidad: z.string().optional(),
  alergenos_notas: z.string().optional(),
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

interface EditarPlatoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plato: Plato | null;
}

export function EditarPlatoModal({ open, onOpenChange, plato }: EditarPlatoModalProps) {
  const { actualizarPlato, categorias, unidades } = usePlatos();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [alergenosSeleccionados, setAlergenosSeleccionados] = useState<string[]>([]);
  const [alergenosPersonalizados, setAlergenosPersonalizados] = useState<string[]>([]);
  const [nuevoAlergeno, setNuevoAlergeno] = useState("");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: "",
      precio_eur: 0,
      descripcion: "",
      ingredientes: "",
      unidad: "",
      alergenos_notas: "",
    },
  });

  useEffect(() => {
    if (!open || !plato) return;

    // Clasifica lo guardado en oficiales (ya en forma canónica, para que las
    // casillas se marquen solas aunque en BD estuviera `frutos_cascara` o
    // `Frutos de Cáscara`) y personalizados de verdad.
    const { oficiales, personalizados } = separarAlergenos(plato.alergenos_oficiales);

    form.reset({
      nombre: plato.nombre ?? "",
      categoria: plato.categoria ?? "",
      precio_eur: plato.precio_eur ?? 0,
      descripcion: plato.descripcion ?? "",
      ingredientes: plato.ingredientes ?? "",
      unidad: plato.unidad ?? "",
      alergenos_notas: plato.alergenos_notas ?? "",
    });

    setAlergenosSeleccionados(oficiales);
    setAlergenosPersonalizados(personalizados);
    setNuevoAlergeno("");

    setImageFile(null);
    setImagePreview(plato.imagen_url ?? null);
    setRemoveImage(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [open, plato, form]);

  const toggleAlergeno = (id: string) => {
    setAlergenosSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const addAlergenoPersonalizado = () => {
    const trimmed = nuevoAlergeno.trim();
    if (!trimmed) return;

    // Si lo escrito a mano es en realidad un alérgeno oficial (con o sin
    // acentos, singular o plural), se marca su casilla en lugar de añadir una
    // entrada suelta que acabaría duplicada en la web.
    const canonico = normalizarAlergeno(trimmed);
    if (canonico) {
      setAlergenosSeleccionados((prev) =>
        prev.includes(canonico) ? prev : [...prev, canonico]
      );
      setNuevoAlergeno("");
      return;
    }

    if (!alergenosPersonalizados.includes(trimmed)) {
      setAlergenosPersonalizados((prev) => [...prev, trimmed]);
    }
    setNuevoAlergeno("");
  };

  const removeAlergenoPersonalizado = (alergeno: string) => {
    setAlergenosPersonalizados((prev) => prev.filter((item) => item !== alergeno));
  };

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
    if (!plato) return;

    setIsUploadingImage(true);
    try {
      const alergenos = combinarAlergenos(alergenosSeleccionados, alergenosPersonalizados);
      let imageUrlUpdate: string | null | undefined = undefined;

      if (imageFile) {
        const fileExt = imageFile.name.split(".").pop() || "jpg";
        const fileName = `${plato.id}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("platos")
          .upload(fileName, imageFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from("platos").getPublicUrl(fileName);
        imageUrlUpdate = `${urlData.publicUrl}?t=${Date.now()}`;

        // Borrado defensivo de la imagen anterior cuando el nuevo fichero
        // cambia de nombre (p.ej. extensión distinta: .jpg -> .png). El
        // upsert solo sobrescribe cuando el nombre coincide EXACTO, y
        // ".JPG"/".jpg" son objetos distintos en Storage, así que sin esto
        // el objeto viejo queda huérfano. Si el borrado falla (fichero ya
        // no existe, red, permisos...) no debe impedir que se guarde el
        // resto de cambios del registro.
        const nombreArchivoAnterior = nombreArchivoStorage(plato.id, plato.imagen_url);
        if (nombreArchivoAnterior && nombreArchivoAnterior !== fileName) {
          try {
            const { error: removeError } = await supabase.storage.from("platos").remove([nombreArchivoAnterior]);
            if (removeError) {
              console.error("No se pudo borrar la imagen antigua de Storage (platos):", removeError);
            }
          } catch (removeErr) {
            console.error("Error borrando imagen antigua de Storage (platos):", removeErr);
          }
        }
      } else if (removeImage) {
        imageUrlUpdate = null;

        // Borrado defensivo: si falla (fichero ya no existe, red, permisos...)
        // no debe impedir que se guarde el resto de cambios del registro.
        const nombreArchivo = nombreArchivoStorage(plato.id, plato.imagen_url);
        if (nombreArchivo) {
          try {
            const { error: removeError } = await supabase.storage.from("platos").remove([nombreArchivo]);
            if (removeError) {
              console.error("No se pudo borrar la imagen antigua de Storage (platos):", removeError);
            }
          } catch (removeErr) {
            console.error("Error borrando imagen antigua de Storage (platos):", removeErr);
          }
        }
      }

      await actualizarPlato.mutateAsync({
        id: plato.id,
        nombre: values.nombre,
        categoria: values.categoria,
        precio_eur: values.precio_eur,
        descripcion: values.descripcion?.trim() || null,
        ingredientes: values.ingredientes?.trim() || null,
        unidad: values.unidad?.trim() || null,
        alergenos_notas: values.alergenos_notas?.trim() || null,
        alergenos_oficiales: alergenos.length > 0 ? alergenos : null,
        ...(imageUrlUpdate !== undefined ? { imagen_url: imageUrlUpdate } : {}),
      });

      onOpenChange(false);
    } catch (error) {
      console.error("Error updating plato:", error);
      toast.error("No se pudo actualizar el plato");
    } finally {
      setIsUploadingImage(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Plato</DialogTitle>
          <DialogDescription>
            Modifica los datos del plato seleccionado
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
                    <Input placeholder="Nombre del plato" {...field} />
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
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Selecciona una categoría" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-popover z-50">
                      {categorias.map((cat) => (
                        <SelectItem key={cat} value={cat as string}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                name="unidad"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidad</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Selecciona una unidad" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-popover z-50">
                        {unidades.map((unidad) => (
                          <SelectItem key={unidad} value={unidad as string}>
                            {unidad}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                      placeholder="Descripción del plato"
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
                      placeholder="Ingredientes del plato"
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <FormLabel>Imagen del Plato</FormLabel>
              <div className="flex flex-col gap-3">
                {imagePreview ? (
                  <div className="relative inline-block">
                    <img
                      src={imagePreview}
                      alt="Vista previa"
                      className="w-32 h-32 object-cover rounded-lg border"
                    />
                    <button
                      type="button"
                      onClick={clearImage}
                      aria-label="Quitar la imagen"
                      className="absolute -top-3 -right-3 flex h-11 w-11 items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-24 border-2 border-dashed border-muted-foreground/25 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
                  >
                    <Camera className="h-8 w-8 text-muted-foreground/50" />
                    <span className="text-sm text-muted-foreground mt-1">
                      Haz clic para subir o usar cámara
                    </span>
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
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </div>
            </div>

            <div className="space-y-3">
              <FormLabel>Alérgenos</FormLabel>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ALERGENOS_OFICIALES.map((alergeno) => {
                  const isSelected = alergenosSeleccionados.includes(alergeno.id);
                  return (
                    <button
                      key={alergeno.id}
                      type="button"
                      onClick={() => toggleAlergeno(alergeno.id)}
                      className={[
                        "flex items-center gap-1.5 min-h-11 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 border",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted",
                      ].join(" ")}
                    >
                      <span className="truncate">{alergeno.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <Input
                  value={nuevoAlergeno}
                  onChange={(e) => setNuevoAlergeno(e.target.value)}
                  placeholder="Añadir alérgeno personalizado..."
                  className="h-11 flex-1 text-base md:text-base"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addAlergenoPersonalizado();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addAlergenoPersonalizado}
                  disabled={!nuevoAlergeno.trim()}
                >
                  Añadir
                </Button>
              </div>

              {alergenosPersonalizados.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {alergenosPersonalizados.map((alergeno) => (
                    <Badge key={alergeno} variant="secondary" className="gap-0 py-0 pl-3 pr-0 text-sm">
                      {alergeno}
                      <button
                        type="button"
                        onClick={() => removeAlergenoPersonalizado(alergeno)}
                        className="flex h-11 w-11 items-center justify-center hover:text-destructive"
                        aria-label={`Quitar ${alergeno}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <FormField
              control={form.control}
              name="alergenos_notas"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas adicionales</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Ej: Puede contener trazas de..."
                      className="resize-none"
                      rows={2}
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
              <Button type="submit" className="h-11 px-5" disabled={actualizarPlato.isPending || isUploadingImage}>
                {actualizarPlato.isPending || isUploadingImage ? (
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
