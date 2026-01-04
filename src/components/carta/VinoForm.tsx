import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Globe, Loader2 } from "lucide-react";
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
import { useVinos, NuevoVino } from "@/hooks/useVinos";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

const formSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  categoria: z.string().min(1, "La categoría es obligatoria"),
  precio_eur: z.coerce.number().min(0, "El precio debe ser mayor o igual a 0"),
  descripcion: z.string().optional(),
  denominacion_origen: z.string().optional(),
  ubicacion_pais: z.string().optional(),
  ubicacion_region: z.string().optional(),
  alergenos_notas: z.string().optional(),
  imagen_url: z.string().url("Debe ser una URL válida").optional().or(z.literal("")),
});

interface VinoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaInicial?: string;
}

export function VinoForm({ open, onOpenChange, categoriaInicial }: VinoFormProps) {
  const { crearVino } = useVinos();
  const [isTranslating, setIsTranslating] = useState(false);
  const [traducciones, setTraducciones] = useState<Json | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: categoriaInicial || "",
      precio_eur: 0,
      descripcion: "",
      denominacion_origen: "",
      ubicacion_pais: "",
      ubicacion_region: "",
      alergenos_notas: "",
      imagen_url: "",
    },
  });

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
      denominacion_origen: values.denominacion_origen,
      ubicacion_pais: values.ubicacion_pais,
      ubicacion_region: values.ubicacion_region,
      alergenos_notas: values.alergenos_notas,
      ...(traducciones && { traducciones }),
    };
    
    await crearVino.mutateAsync(vinoData);
    form.reset();
    setTraducciones(null);
    onOpenChange(false);
  };

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
                    <Input placeholder="Ej: Tinto, Blanco, Rosado..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="imagen_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL de Imagen</FormLabel>
                  <FormControl>
                    <Input placeholder="https://ejemplo.com/imagen.jpg" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="denominacion_origen"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>D.O.</FormLabel>
                    <FormControl>
                      <Input placeholder="Denominación" {...field} />
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
                      <Input placeholder="Región" {...field} />
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
                      <Input placeholder="País" {...field} />
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
                <Button type="submit" disabled={crearVino.isPending}>
                  {crearVino.isPending ? "Guardando..." : "Guardar Vino"}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
