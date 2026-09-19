import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ComboboxCreatable } from "@/components/ui/combobox-creatable";
import { useCocteles } from "@/hooks/useCocteles";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Upload, X, Languages } from "lucide-react";
import { Json } from "@/integrations/supabase/types";

const formSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  categoria: z.string().min(1, "La categoría es requerida"),
  precio_eur: z.coerce.number().min(0, "El precio debe ser positivo"),
  descripcion: z.string().optional(),
  ingredientes: z.string().optional(),
  preparacion: z.string().optional(),
});

interface CoctelFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaInicial?: string;
}

export function CoctelForm({ open, onOpenChange, categoriaInicial }: CoctelFormProps) {
  const { crearCoctel, categorias } = useCocteles();
  const [isTranslating, setIsTranslating] = useState(false);
  const [traducciones, setTraducciones] = useState<Json | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: categoriaInicial || "",
      precio_eur: 0,
      descripcion: "",
      ingredientes: "",
      preparacion: "",
    },
  });

  useEffect(() => {
    if (categoriaInicial) {
      form.setValue("categoria", categoriaInicial);
    }
  }, [categoriaInicial, form]);

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
  };

  const handleTranslate = async () => {
    const values = form.getValues();
    if (!values.nombre) {
      toast.error("Introduce un nombre antes de traducir");
      return;
    }

    setIsTranslating(true);
    try {
      const { data, error } = await supabase.functions.invoke('traducir-contenido', {
        body: {
          tipo: 'coctel',
          datos: {
            nombre: values.nombre,
            categoria: values.categoria,
            descripcion: values.descripcion || '',
            ingredientes: values.ingredientes || '',
          },
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Traducción no disponible');

      setTraducciones(data.translations || null);
      toast.success("Traducciones generadas");
    } catch (error) {
      console.error('Error traduciendo:', error);
      toast.error("Error al traducir");
    } finally {
      setIsTranslating(false);
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      await crearCoctel.mutateAsync({
        nombre: values.nombre,
        categoria: values.categoria,
        precio_eur: values.precio_eur,
        descripcion: values.descripcion,
        ingredientes: values.ingredientes,
        preparacion: values.preparacion,
      });

      // Si hay imagen, subirla después de crear el cóctel
      if (imageFile) {
        setIsUploading(true);
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('cocteles')
          .upload(fileName, imageFile);

        if (uploadError) {
          console.error('Error subiendo imagen:', uploadError);
          toast.error("Error al subir la imagen");
        }
        setIsUploading(false);
      }

      form.reset();
      setTraducciones(null);
      clearImage();
      onOpenChange(false);
    } catch (error) {
      console.error('Error creando cóctel:', error);
    }
  };

  const categoriasOptions = categorias.filter((cat): cat is string => cat !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Cóctel</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="nombre"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input placeholder="Mojito" {...field} />
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
                        options={categoriasOptions}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Selecciona o crea..."
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="precio_eur"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Precio (€)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" min="0" {...field} />
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
                      placeholder="Descripción del cóctel..."
                      className="min-h-[80px]"
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
                      placeholder="Ron, menta, lima, azúcar, soda..."
                      className="min-h-[60px]"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="preparacion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Preparación (opcional)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Pasos de preparación..."
                      className="min-h-[60px]"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Imagen */}
            <div className="space-y-2">
              <FormLabel>Imagen</FormLabel>
              {imagePreview ? (
                <div className="relative w-32 h-32">
                  <img 
                    src={imagePreview} 
                    alt="Preview" 
                    className="w-full h-full object-cover rounded-md"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute -top-2 -right-2 h-6 w-6"
                    onClick={clearImage}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-32 h-32 border-2 border-dashed border-muted-foreground/25 rounded-md cursor-pointer hover:border-primary/50 transition-colors">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground mt-1">Subir imagen</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageChange}
                  />
                </label>
              )}
            </div>

            {/* Botón traducir */}
            <Button
              type="button"
              variant="outline"
              onClick={handleTranslate}
              disabled={isTranslating}
              className="w-full"
            >
              {isTranslating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Languages className="h-4 w-4 mr-2" />
              )}
              Generar traducciones
            </Button>

            {/* Mostrar traducciones */}
            {traducciones && (
              <div className="p-3 bg-muted rounded-md text-sm space-y-2">
                <p className="font-medium">Traducciones generadas:</p>
                {typeof traducciones === 'object' && traducciones !== null && (
                  <>
                    {(traducciones as any).nombre_en && (
                      <p><span className="font-medium">🇬🇧 EN:</span> {(traducciones as any).nombre_en}</p>
                    )}
                    {(traducciones as any).nombre_fr && (
                      <p><span className="font-medium">🇫🇷 FR:</span> {(traducciones as any).nombre_fr}</p>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button 
                type="submit" 
                disabled={crearCoctel.isPending || isUploading}
              >
                {(crearCoctel.isPending || isUploading) && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Guardar Cóctel
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
