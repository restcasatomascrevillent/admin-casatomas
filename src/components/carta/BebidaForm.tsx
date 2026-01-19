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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBebidas, NuevaBebida } from "@/hooks/useBebidas";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";
import { useQueryClient } from "@tanstack/react-query";

const formSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  categoria: z.string().min(1, "La categoría es obligatoria"),
  precio_eur: z.coerce.number().min(0, "El precio debe ser mayor o igual a 0"),
  descripcion: z.string().optional(),
  tamano: z.string().optional(),
});

interface BebidaFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaInicial?: string;
}

export function BebidaForm({ open, onOpenChange, categoriaInicial }: BebidaFormProps) {
  const { crearBebida, actualizarBebida, categorias } = useBebidas();
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
      tamano: "",
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
          categoria: values.categoria || '',
          tamano: values.tamano || '',
          tipo: 'bebida',
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
    const bebidaData: NuevaBebida = {
      nombre: values.nombre,
      categoria: values.categoria,
      precio_eur: values.precio_eur,
      descripcion: values.descripcion,
      tamano: values.tamano,
      ...(traducciones && { traducciones }),
    };
    
    const nuevaBebida = await crearBebida.mutateAsync(bebidaData);

    // Upload image if selected
    if (imageFile && nuevaBebida?.id) {
      setIsUploading(true);
      try {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${nuevaBebida.id}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('bebidas')
          .upload(fileName, imageFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('bebidas')
          .getPublicUrl(fileName);

        await actualizarBebida.mutateAsync({
          id: nuevaBebida.id,
          imagen_url: urlData.publicUrl,
        });

        queryClient.invalidateQueries({ queryKey: ["bebidas"] });
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
          <DialogTitle>Añadir Bebida</DialogTitle>
          <DialogDescription>
            Completa los datos de la nueva bebida
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

            <div className="grid grid-cols-2 gap-4">
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
                name="tamano"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tamaño</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: 33cl, 1L..." {...field} />
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

            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleTranslate}
                disabled={isTranslating || !form.watch("nombre")}
              >
                {isTranslating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Traduciendo...
                  </>
                ) : (
                  <>
                    <Globe className="mr-2 h-4 w-4" />
                    Traducir
                    {traducciones && " ✓"}
                  </>
                )}
              </Button>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={crearBebida.isPending || isUploading}>
                  {crearBebida.isPending || isUploading ? "Guardando..." : "Guardar Bebida"}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
