import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Globe, Loader2, Camera, X } from "lucide-react";
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
import { useVinos, NuevoVino } from "@/hooks/useVinos";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";
import { useQueryClient } from "@tanstack/react-query";

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

interface VinoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaInicial?: string;
}

export function VinoForm({ open, onOpenChange, categoriaInicial }: VinoFormProps) {
  const { crearVino, actualizarVino, categorias, denominaciones, regiones, paises } = useVinos();
  const queryClient = useQueryClient();
  const [isTranslating, setIsTranslating] = useState(false);
  const [traducciones, setTraducciones] = useState<Json | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleTranslate = async () => {
    const values = form.getValues();
    
    if (!values.nombre) {
      toast.error("Introduce el nombre antes de traducir");
      return;
    }

    setIsTranslating(true);
    try {
      const { data, error } = await supabase.functions.invoke('traducir-carta', {
        body: {
          nombre: values.nombre,
          descripcion: values.descripcion || '',
          ingredientes: values.ingredientes || '',
          categoria: values.categoria || '',
          ubicacion_pais: values.ubicacion_pais || '',
          ubicacion_region: values.ubicacion_region || '',
          alergenos_notas: values.alergenos_notas || '',
          tipo: 'vino',
        },
      });

      if (error) throw error;

      console.log('Translation response:', data);
      setTraducciones(data);
      toast.success("Traducción completada");
    } catch (error) {
      console.error('Translation error:', error);
      toast.error("Error al traducir");
    } finally {
      setIsTranslating(false);
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const vinoData: NuevoVino = {
      nombre: values.nombre,
      categoria: values.categoria,
      precio_eur: values.precio_eur,
      descripcion: values.descripcion,
      ingredientes: values.ingredientes,
      denominacion_origen: values.denominacion_origen,
      ubicacion_pais: values.ubicacion_pais,
      ubicacion_region: values.ubicacion_region,
      alergenos_notas: values.alergenos_notas,
      ...(traducciones && { traducciones }),
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
    setTraducciones(null);
    clearImage();
    onOpenChange(false);
  };

  // Extract translation data for display
  const traduccionIngles = traducciones && typeof traducciones === 'object' 
    ? (traducciones as Record<string, unknown>)['traduccion ingles'] as Record<string, string> | undefined
    : undefined;
  const traduccionFrances = traducciones && typeof traducciones === 'object'
    ? (traducciones as Record<string, unknown>)['traduccion_fr'] as Record<string, string> | undefined
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                capture="environment"
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

            {/* Translations display */}
            {traducciones && (traduccionIngles || traduccionFrances) && (
              <div className="p-4 bg-muted/50 rounded-lg space-y-3 border">
                <p className="text-sm font-medium text-muted-foreground">Traducciones generadas:</p>
                
                {traduccionIngles && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-blue-600">🇬🇧 English</p>
                    <div className="text-sm pl-2 border-l-2 border-blue-400 space-y-0.5">
                      {traduccionIngles.nombre && (
                        <p><span className="text-muted-foreground">Name:</span> {traduccionIngles.nombre}</p>
                      )}
                      {traduccionIngles.descripcion && (
                        <p><span className="text-muted-foreground">Description:</span> {traduccionIngles.descripcion}</p>
                      )}
                      {traduccionIngles.categoria && (
                        <p><span className="text-muted-foreground">Category:</span> {traduccionIngles.categoria}</p>
                      )}
                    </div>
                  </div>
                )}
                
                {traduccionFrances && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-red-600">🇫🇷 Français</p>
                    <div className="text-sm pl-2 border-l-2 border-red-400 space-y-0.5">
                      {traduccionFrances.nombre && (
                        <p><span className="text-muted-foreground">Nom:</span> {traduccionFrances.nombre}</p>
                      )}
                      {traduccionFrances.descripcion && (
                        <p><span className="text-muted-foreground">Description:</span> {traduccionFrances.descripcion}</p>
                      )}
                      {(traduccionFrances['catégorie'] || traduccionFrances.categoria) && (
                        <p><span className="text-muted-foreground">Catégorie:</span> {traduccionFrances['catégorie'] || traduccionFrances.categoria}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={crearVino.isPending || isUploading}>
                {crearVino.isPending || isUploading ? "Guardando..." : "Guardar Vino"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
