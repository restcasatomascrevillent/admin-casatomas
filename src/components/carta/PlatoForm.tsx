import { guardarUnidadPlato, opcionesUnidadPlato } from "@/lib/unidades-platos";
import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Camera, X, Plus } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { usePlatos, NuevoPlato } from "@/hooks/usePlatos";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ALERGENOS_OFICIALES,
  combinarAlergenos,
  normalizarAlergeno,
} from "@/lib/alergenos";

const formSchema = z
  .object({
    nombre: z.string().trim().min(1, "El nombre es obligatorio"),
    categoria: z.string().trim().min(1, "La categoría es obligatoria"),
    precio_eur: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.coerce
        .number({ invalid_type_error: "Indica un precio válido" })
        .finite("Indica un precio válido")
        .min(0, "El precio debe ser mayor o igual a 0"),
    ),
    descripcion: z.string().optional(),
    sin_gluten_disponible: z.boolean().default(false),
    ingredientes: z.string().optional(),
    unidad: z.string().default("Unidad"),
    gramos: z.coerce.number().optional(),
  })
  .superRefine((values, ctx) => {
    if (
      values.unidad === "gramos" &&
      (!Number.isInteger(values.gramos) || !values.gramos || values.gramos <= 0)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gramos"],
        message: "Indica una cantidad de gramos entera y mayor que cero",
      });
  });

interface PlatoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaInicial?: string;
}

export function PlatoForm({
  open,
  onOpenChange,
  categoriaInicial,
}: PlatoFormProps) {
  const { crearPlato, actualizarPlato, categorias, unidades } = usePlatos();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estado para alérgenos
  const [alergenosSeleccionados, setAlergenosSeleccionados] = useState<
    string[]
  >([]);
  const [alergenosPersonalizados, setAlergenosPersonalizados] = useState<
    string[]
  >([]);
  const [nuevoAlergeno, setNuevoAlergeno] = useState("");
  const tieneGluten = alergenosSeleccionados.includes("gluten");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: categoriaInicial || "",
      precio_eur: 0,
      descripcion: "",
      sin_gluten_disponible: false,
      ingredientes: "",
      unidad: "Unidad",
      gramos: 100,
    },
  });

  const toggleAlergeno = (id: string) => {
    if (id === "gluten" && tieneGluten) {
      form.setValue("sin_gluten_disponible", false, { shouldDirty: true });
    }
    setAlergenosSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id],
    );
  };

  const addAlergenoPersonalizado = () => {
    const trimmed = nuevoAlergeno.trim();
    if (!trimmed) return;

    // Si lo escrito a mano es en realidad un alérgeno oficial (escrito con o
    // sin acentos, en singular o plural), se marca su casilla en vez de crear
    // una entrada suelta: así no se guardan dos veces lo mismo.
    const canonico = normalizarAlergeno(trimmed);
    if (canonico) {
      setAlergenosSeleccionados((prev) =>
        prev.includes(canonico) ? prev : [...prev, canonico],
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
    setIsUploading(true);
    try {
      // Combinar oficiales + personalizados en vocabulario canónico y sin
      // duplicados (ver src/lib/alergenos.ts).
      const todosAlergenos = combinarAlergenos(
        alergenosSeleccionados,
        alergenosPersonalizados,
      );

      // 1. Crear el plato primero
      const platoData: NuevoPlato = {
        nombre: values.nombre,
        categoria: values.categoria,
        precio_eur: values.precio_eur,
        descripcion: values.descripcion,
        sin_gluten_disponible:
          todosAlergenos.includes("gluten") && values.sin_gluten_disponible,
        ingredientes: values.ingredientes,
        unidad: guardarUnidadPlato(values.unidad, values.gramos),
        alergenos_oficiales: todosAlergenos.length > 0 ? todosAlergenos : null,
      };
      // La traducción ya no se genera aquí: crearPlato (usePlatos.ts) llama a
      // traducir-contenido internamente al guardar (ver informe, TAREA 2).
      const nuevoPlato = await crearPlato.mutateAsync(platoData);

      // 2. Si hay imagen, subirla a Storage
      if (imageFile && nuevoPlato?.id) {
        const fileExt = imageFile.name.split(".").pop();
        const fileName = `${nuevoPlato.id}.${fileExt}`;

        // Eliminar imagen anterior si existe
        await supabase.storage.from("platos").remove([fileName]);

        // Subir nueva imagen
        const { error: uploadError } = await supabase.storage
          .from("platos")
          .upload(fileName, imageFile);

        if (uploadError) {
          console.error("Error uploading image:", uploadError);
          toast.error("Plato creado pero error al subir imagen");
        } else {
          // Obtener URL pública
          const { data: urlData } = supabase.storage
            .from("platos")
            .getPublicUrl(fileName);

          // Se pasa por la mutación del hook (antes era un UPDATE directo a
          // Supabase): así se invalida la caché y, sobre todo, se dispara la
          // republicación de las webs — sin esto la foto no llegaba nunca.
          await actualizarPlato.mutateAsync({
            id: nuevoPlato.id,
            imagen_url: urlData.publicUrl,
          });
        }
      }

      form.reset();
      clearImage();
      setAlergenosSeleccionados([]);
      setAlergenosPersonalizados([]);
      onOpenChange(false);
    } catch (error) {
      console.error("Error creating plato:", error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Añadir Plato</DialogTitle>
          <DialogDescription>
            Solo nombre, categoría y precio son obligatorios.
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

            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="precio_eur"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio (€)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                      />
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
                        {opcionesUnidadPlato(unidades).map((unidad) => (
                          <SelectItem key={unidad} value={unidad as string}>
                            {unidad === "gramos" ? "Gramos" : unidad}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {form.watch("unidad") === "gramos" && (
              <FormField
                control={form.control}
                name="gramos"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cantidad de gramos</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        placeholder="Ej.: 150"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-sm text-muted-foreground">
                      El precio indicado corresponde a esta cantidad de gramos.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer font-medium">
                Información adicional (opcional)
              </summary>
              <div className="space-y-4 pt-4">
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
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="hidden"
                    />
                  </div>
                </div>

                {/* Selector de Alérgenos */}
                <div className="space-y-3">
                  <FormLabel>Alérgenos</FormLabel>

                  {/* Grid de alérgenos oficiales */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {ALERGENOS_OFICIALES.map((alergeno) => {
                      const isSelected = alergenosSeleccionados.includes(
                        alergeno.id,
                      );
                      return (
                        <button
                          key={alergeno.id}
                          type="button"
                          onClick={() => toggleAlergeno(alergeno.id)}
                          className={`
                        flex items-center gap-1.5 min-h-11 px-3 py-1.5 rounded-md text-sm font-medium
                        transition-all duration-200 border
                        ${
                          isSelected
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

                  {/* Añadir alérgeno personalizado */}
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
                      onClick={addAlergenoPersonalizado}
                      disabled={!nuevoAlergeno.trim()}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Lista de alérgenos personalizados */}
                  {alergenosPersonalizados.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {alergenosPersonalizados.map((alergeno) => (
                        <Badge
                          key={alergeno}
                          variant="secondary"
                          className="gap-0 py-0 pl-3 pr-0 text-sm"
                        >
                          {alergeno}
                          <button
                            type="button"
                            onClick={() =>
                              removeAlergenoPersonalizado(alergeno)
                            }
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

                {tieneGluten && (
                  <FormField
                    control={form.control}
                    name="sin_gluten_disponible"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-3 rounded-lg border border-emerald-600/25 bg-emerald-50 p-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(value) =>
                              field.onChange(value === true)
                            }
                          />
                        </FormControl>
                        <FormLabel className="cursor-pointer leading-relaxed text-emerald-900">
                          Se puede hacer sin gluten
                        </FormLabel>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </details>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 px-5"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-11 px-5"
                disabled={crearPlato.isPending || isUploading}
              >
                {crearPlato.isPending || isUploading
                  ? "Guardando..."
                  : "Guardar Plato"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
