import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Globe, Loader2, Camera, X, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
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
import { usePlatos, NuevoPlato } from "@/hooks/usePlatos";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

// Alérgenos oficiales de la UE
const ALERGENOS_OFICIALES = [
  { id: "gluten", label: "Gluten" },
  { id: "crustaceos", label: "Crustáceos" },
  { id: "huevo", label: "Huevo" },
  { id: "pescado", label: "Pescado" },
  { id: "cacahuetes", label: "Cacahuetes" },
  { id: "frutos_cascara", label: "Frutos de cáscara" },
  { id: "lacteos", label: "Lácteos" },
  { id: "apio", label: "Apio" },
  { id: "mostaza", label: "Mostaza" },
  { id: "sesamo", label: "Sésamo" },
  { id: "sulfitos", label: "Sulfitos" },
  { id: "altramuces", label: "Altramuces" },
  { id: "moluscos", label: "Moluscos" },
  { id: "soja", label: "Soja" },
];

const formSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  categoria: z.string().min(1, "La categoría es obligatoria"),
  precio_eur: z.coerce.number().min(0, "El precio debe ser mayor o igual a 0"),
  descripcion: z.string().optional(),
  unidad: z.string().optional(),
  alergenos_notas: z.string().optional(),
});

interface PlatoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaInicial?: string;
}

export function PlatoForm({ open, onOpenChange, categoriaInicial }: PlatoFormProps) {
  const { crearPlato, categorias, unidades } = usePlatos();
  const queryClient = useQueryClient();
  const [isTranslating, setIsTranslating] = useState(false);
  const [traducciones, setTraducciones] = useState<Json | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Estado para alérgenos
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
      unidad: "",
      alergenos_notas: "",
    },
  });

  const toggleAlergeno = (id: string) => {
    setAlergenosSeleccionados(prev => 
      prev.includes(id) 
        ? prev.filter(a => a !== id)
        : [...prev, id]
    );
  };

  const addAlergenoPersonalizado = () => {
    const trimmed = nuevoAlergeno.trim();
    if (trimmed && !alergenosPersonalizados.includes(trimmed)) {
      setAlergenosPersonalizados(prev => [...prev, trimmed]);
      setNuevoAlergeno("");
    }
  };

  const removeAlergenoPersonalizado = (alergeno: string) => {
    setAlergenosPersonalizados(prev => prev.filter(a => a !== alergeno));
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

  const handleTranslate = async () => {
    const values = form.getValues();
    
    if (!values.nombre) {
      toast.error("Introduce el nombre antes de traducir");
      return;
    }

    setIsTranslating(true);
    try {
      // Combinar alérgenos oficiales seleccionados + personalizados
      const todosAlergenos = [...alergenosSeleccionados, ...alergenosPersonalizados];
      
      const { data, error } = await supabase.functions.invoke('traducir-carta', {
        body: {
          nombre: values.nombre,
          descripcion: values.descripcion || '',
          categoria: values.categoria || '',
          alergenos: todosAlergenos,
          tipo: 'plato',
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
    setIsUploading(true);
    try {
      // Combinar alérgenos oficiales seleccionados + personalizados
      const todosAlergenos = [...alergenosSeleccionados, ...alergenosPersonalizados];
      
      // 1. Crear el plato primero
      const platoData: NuevoPlato = {
        nombre: values.nombre,
        categoria: values.categoria,
        precio_eur: values.precio_eur,
        descripcion: values.descripcion,
        unidad: values.unidad,
        alergenos_notas: values.alergenos_notas,
        alergenos_oficiales: todosAlergenos.length > 0 ? todosAlergenos : null,
        ...(traducciones && { traducciones }),
      };
      
      const nuevoPlato = await crearPlato.mutateAsync(platoData);
      
      // 2. Si hay imagen, subirla a Storage
      if (imageFile && nuevoPlato?.id) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${nuevoPlato.id}.${fileExt}`;
        
        // Eliminar imagen anterior si existe
        await supabase.storage
          .from('platos')
          .remove([fileName]);
        
        // Subir nueva imagen
        const { error: uploadError } = await supabase.storage
          .from('platos')
          .upload(fileName, imageFile);
        
        if (uploadError) {
          console.error('Error uploading image:', uploadError);
          toast.error("Plato creado pero error al subir imagen");
        } else {
          // Obtener URL pública
          const { data: urlData } = supabase.storage
            .from('platos')
            .getPublicUrl(fileName);
          
          // Actualizar el plato con la URL de imagen
          await supabase
            .from('Platos')
            .update({ imagen_url: urlData.publicUrl })
            .eq('id', nuevoPlato.id);
          
          queryClient.invalidateQueries({ queryKey: ['platos'] });
        }
      }
      
      form.reset();
      setTraducciones(null);
      clearImage();
      setAlergenosSeleccionados([]);
      setAlergenosPersonalizados([]);
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating plato:', error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Añadir Plato</DialogTitle>
          <DialogDescription>
            Completa los datos del nuevo plato
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
                      <Input type="number" step="0.01" placeholder="0.00" {...field} />
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
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/90"
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
                  capture="environment"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </div>
            </div>

            {/* Selector de Alérgenos */}
            <div className="space-y-3">
              <FormLabel>Alérgenos</FormLabel>
              
              {/* Grid de alérgenos oficiales */}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {ALERGENOS_OFICIALES.map((alergeno) => {
                  const isSelected = alergenosSeleccionados.includes(alergeno.id);
                  return (
                    <button
                      key={alergeno.id}
                      type="button"
                      onClick={() => toggleAlergeno(alergeno.id)}
                      className={`
                        flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium
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
              
              {/* Añadir alérgeno personalizado */}
              <div className="flex gap-2">
                <Input
                  value={nuevoAlergeno}
                  onChange={(e) => setNuevoAlergeno(e.target.value)}
                  placeholder="Añadir alérgeno personalizado..."
                  className="flex-1"
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
                      className="gap-1 pr-1"
                    >
                      {alergeno}
                      <button
                        type="button"
                        onClick={() => removeAlergenoPersonalizado(alergeno)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
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

            {/* Mostrar traducciones */}
            {traducciones && typeof traducciones === 'object' && (
              <div className="p-4 bg-muted/50 rounded-lg space-y-3 border">
                <p className="text-sm font-medium text-muted-foreground">Traducciones generadas:</p>
                
                {/* Inglés */}
                {(traducciones as Record<string, unknown>)['traduccion ingles'] && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-blue-600">🇬🇧 English</p>
                    <div className="text-sm pl-2 border-l-2 border-blue-400">
                      <p><span className="text-muted-foreground">Name:</span> {((traducciones as Record<string, unknown>)['traduccion ingles'] as Record<string, string>)?.nombre}</p>
                      {((traducciones as Record<string, unknown>)['traduccion ingles'] as Record<string, string>)?.descripcion && (
                        <p><span className="text-muted-foreground">Description:</span> {((traducciones as Record<string, unknown>)['traduccion ingles'] as Record<string, string>)?.descripcion}</p>
                      )}
                      <p><span className="text-muted-foreground">Category:</span> {((traducciones as Record<string, unknown>)['traduccion ingles'] as Record<string, string>)?.categoria}</p>
                      {((traducciones as Record<string, unknown>)['traduccion ingles'] as Record<string, string>)?.alergenos && (
                        <p><span className="text-muted-foreground">Allergens:</span> {((traducciones as Record<string, unknown>)['traduccion ingles'] as Record<string, string>)?.alergenos}</p>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Francés */}
                {(traducciones as Record<string, unknown>)['traduccion_fr'] && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-red-600">🇫🇷 Français</p>
                    <div className="text-sm pl-2 border-l-2 border-red-400">
                      <p><span className="text-muted-foreground">Nom:</span> {((traducciones as Record<string, unknown>)['traduccion_fr'] as Record<string, string>)?.nombre}</p>
                      {((traducciones as Record<string, unknown>)['traduccion_fr'] as Record<string, string>)?.descripcion && (
                        <p><span className="text-muted-foreground">Description:</span> {((traducciones as Record<string, unknown>)['traduccion_fr'] as Record<string, string>)?.descripcion}</p>
                      )}
                      <p><span className="text-muted-foreground">Catégorie:</span> {((traducciones as Record<string, unknown>)['traduccion_fr'] as Record<string, string>)?.['catégorie'] || ((traducciones as Record<string, unknown>)['traduccion_fr'] as Record<string, string>)?.categoria}</p>
                      {((traducciones as Record<string, unknown>)['traduccion_fr'] as Record<string, string>)?.allergenes && (
                        <p><span className="text-muted-foreground">Allergènes:</span> {((traducciones as Record<string, unknown>)['traduccion_fr'] as Record<string, string>)?.allergenes}</p>
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
              <Button type="submit" disabled={crearPlato.isPending || isUploading}>
                {crearPlato.isPending || isUploading ? "Guardando..." : "Guardar Plato"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
