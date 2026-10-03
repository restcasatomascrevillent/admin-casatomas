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
import { Badge } from "@/components/ui/badge";
import { ComboboxCreatable } from "@/components/ui/combobox-creatable";
import { supabase } from "@/integrations/supabase/client";
import { Vino, useVinos } from "@/hooks/useVinos";
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
  denominacion_origen: z.string().optional(),
  ubicacion_pais: z.string().optional(),
  ubicacion_region: z.string().optional(),
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
      denominacion_origen: "",
      ubicacion_pais: "",
      ubicacion_region: "",
      alergenos_notas: "",
    },
  });

  useEffect(() => {
    if (!open || !vino) return;

    // Clasifica lo guardado en oficiales (ya en forma canónica) y
    // personalizados de verdad (mismo criterio que EditarPlatoModal.tsx).
    const { oficiales, personalizados } = separarAlergenos(vino.alergenos_oficiales);

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

    setAlergenosSeleccionados(oficiales);
    setAlergenosPersonalizados(personalizados);
    setNuevoAlergeno("");

    setImageFile(null);
    setImagePreview(vino.imagen_url ?? null);
    setRemoveImage(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [open, vino, form]);

  const toggleAlergeno = (id: string) => {
    setAlergenosSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const addAlergenoPersonalizado = () => {
    const trimmed = nuevoAlergeno.trim();
    if (!trimmed) return;

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
    if (!vino) return;

    setIsUploadingImage(true);
    try {
      const alergenos = combinarAlergenos(alergenosSeleccionados, alergenosPersonalizados);
      let imageUrlUpdate: string | null | undefined = undefined;

      if (imageFile) {
        const fileExt = imageFile.name.split(".").pop() || "jpg";
        const fileName = `${vino.id}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("vinos")
          .upload(fileName, imageFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from("vinos").getPublicUrl(fileName);
        imageUrlUpdate = `${urlData.publicUrl}?t=${Date.now()}`;

        // Borrado defensivo de la imagen anterior cuando el nuevo fichero
        // cambia de nombre (p.ej. extensión distinta: .jpg -> .png). El
        // upsert solo sobrescribe cuando el nombre coincide EXACTO, y
        // ".JPG"/".jpg" son objetos distintos en Storage, así que sin esto
        // el objeto viejo queda huérfano. Si el borrado falla (fichero ya
        // no existe, red, permisos...) no debe impedir que se guarde el
        // resto de cambios del registro.
        const nombreArchivoAnterior = nombreArchivoStorage(vino.id, vino.imagen_url);
        if (nombreArchivoAnterior && nombreArchivoAnterior !== fileName) {
          try {
            const { error: removeError } = await supabase.storage.from("vinos").remove([nombreArchivoAnterior]);
            if (removeError) {
              console.error("No se pudo borrar la imagen antigua de Storage (vinos):", removeError);
            }
          } catch (removeErr) {
            console.error("Error borrando imagen antigua de Storage (vinos):", removeErr);
          }
        }
      } else if (removeImage) {
        imageUrlUpdate = null;

        // Borrado defensivo: si falla (fichero ya no existe, red, permisos...)
        // no debe impedir que se guarde el resto de cambios del registro.
        const nombreArchivo = nombreArchivoStorage(vino.id, vino.imagen_url);
        if (nombreArchivo) {
          try {
            const { error: removeError } = await supabase.storage.from("vinos").remove([nombreArchivo]);
            if (removeError) {
              console.error("No se pudo borrar la imagen antigua de Storage (vinos):", removeError);
            }
          } catch (removeErr) {
            console.error("Error borrando imagen antigua de Storage (vinos):", removeErr);
          }
        }
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
        alergenos_oficiales: alergenos.length > 0 ? alergenos : null,
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
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
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

            {/* Selector de Alérgenos (ver src/lib/alergenos.ts) */}
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
                      placeholder="Ej: sin sulfitos añadidos, puede contener trazas de..."
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
