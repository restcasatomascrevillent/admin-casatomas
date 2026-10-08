import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, Camera, X } from "lucide-react";
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
import { useVinos, NuevoVino } from "@/hooks/useVinos";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  ALERGENOS_OFICIALES,
  combinarAlergenos,
  normalizarAlergeno,
} from "@/lib/alergenos";

const formSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  categoria: z.string().min(1, "La categoría es obligatoria"),
  precio_eur: z.coerce.number().min(0, "El precio debe ser mayor o igual a 0"),
  descripcion: z.string().optional(),
  ingredientes: z.string().optional(),
  denominacion_origen: z.string().optional(),
  ubicacion_pais: z.string().trim().min(1, "El país es obligatorio para el mapa"),
  ubicacion_region: z.string().trim().min(1, "La región es obligatoria para el mapa"),
  alergenos_notas: z.string().optional(),
});

interface VinoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaInicial?: string;
}

export function VinoForm({ open, onOpenChange, categoriaInicial }: VinoFormProps) {
  const { crearVino, actualizarVino, categorias, denominaciones, regiones, paises } = useVinos();
  const queryClient = useQueryClient();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estado para alérgenos (mismo patrón que PlatoForm.tsx). Antes este
  // formulario no tenía ninguna casilla de alérgenos oficiales: por eso no se
  // podía declarar ni quitar "sulfitos" (u otro alérgeno) de un vino desde el
  // panel, solo por SQL directo.
  const [alergenosSeleccionados, setAlergenosSeleccionados] = useState<string[]>([]);
  const [alergenosPersonalizados, setAlergenosPersonalizados] = useState<string[]>([]);
  const [nuevoAlergeno, setNuevoAlergeno] = useState("");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: categoriaInicial || "",
      precio_eur: 0,
      descripcion: "",
      ingredientes: "",
      denominacion_origen: "",
      ubicacion_pais: "",
      ubicacion_region: "",
      alergenos_notas: "",
    },
  });

  const toggleAlergeno = (id: string) => {
    setAlergenosSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
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
    setAlergenosPersonalizados((prev) => prev.filter((a) => a !== alergeno));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    // La traducción ya no se genera aquí: crearVino (useVinos.ts) llama a
    // traducir-contenido internamente al guardar (ver informe, TAREA 2).
    const todosAlergenos = combinarAlergenos(alergenosSeleccionados, alergenosPersonalizados);
    const vinoData: NuevoVino = {
      nombre: values.nombre,
      categoria: values.categoria,
      precio_eur: values.precio_eur,
      descripcion: values.descripcion,
      ingredientes: values.ingredientes,
      denominacion_origen: values.denominacion_origen,
      ubicacion_pais: values.ubicacion_pais,
      ubicacion_region: values.ubicacion_region,
      alergenos_oficiales: todosAlergenos.length > 0 ? todosAlergenos : null,
      alergenos_notas: values.alergenos_notas,
    };

    const nuevoVino = await crearVino.mutateAsync(vinoData);

    // Upload image if selected
    if (imageFile && nuevoVino?.id) {
      setIsUploading(true);
      try {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${nuevoVino.id}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('vinos')
          .upload(fileName, imageFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('vinos')
          .getPublicUrl(fileName);

        await actualizarVino.mutateAsync({
          id: nuevoVino.id,
          imagen_url: urlData.publicUrl,
        });

        queryClient.invalidateQueries({ queryKey: ["vinos"] });
      } catch (error) {
        console.error('Error uploading image:', error);
        toast.error("Error al subir la imagen");
      } finally {
        setIsUploading(false);
      }
    }

    form.reset();
    clearImage();
    setAlergenosSeleccionados([]);
    setAlergenosPersonalizados([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Añadir Vino</DialogTitle>
          <DialogDescription>
            Completa los datos del nuevo vino
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

            {/* Image upload field */}
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
                  <img 
                    src={imagePreview} 
                    alt="Preview" 
                    className="w-full h-full object-cover"
                  />
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
                  <p className="text-sm text-muted-foreground">
                    Toca para añadir imagen
                  </p>
                </div>
              )}
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

            <p className="text-sm text-muted-foreground">El país y la región sitúan el vino en el mapa de la carta.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                      className={`
                        flex items-center gap-1.5 min-h-11 px-3 py-1.5 rounded-md text-sm font-medium
                        transition-all duration-200 border
                        ${isSelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
                        }
                      `}
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
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label="Añadir alérgeno"
                  onClick={addAlergenoPersonalizado}
                  disabled={!nuevoAlergeno.trim()}
                >
                  <span className="sr-only">Añadir</span>
                  +
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
              <Button
                type="button"
                variant="outline"
                className="h-11 px-5"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" className="h-11 px-5" disabled={crearVino.isPending || isUploading}>
                {crearVino.isPending || isUploading ? "Guardando..." : "Guardar Vino"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
