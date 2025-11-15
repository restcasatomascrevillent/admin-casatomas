import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Loader2, X, CheckCircle2, Eye } from "lucide-react";
import { usePlatos } from "@/hooks/usePlatos";
import { useSalas } from "@/hooks/useSalas";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const formSchema = z.object({
  tipo: z.enum(["restaurante", "plato"]),
  item_id: z.string().min(1, "Selecciona un elemento"),
  archivo: z.instanceof(FileList).refine((files) => files?.length === 1, "Debes subir un archivo"),
});

type FormValues = z.infer<typeof formSchema>;

export function SubidaImagenes() {
  const { platos } = usePlatos();
  const { data: salas } = useSalas();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tipo: "plato",
    },
  });

  const tipoSeleccionado = form.watch("tipo");
  const fileInputRef = form.register("archivo");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result as string);
        setShowPreview(true);
      };
      reader.readAsDataURL(file);
    }
    fileInputRef.onChange(e);
  };

  const clearPreview = () => {
    setImagePreview(null);
    setShowPreview(false);
    form.setValue("archivo", new DataTransfer().files);
  };

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const archivo = values.archivo[0];
      
      // Obtener el nombre del item
      let itemNombre = "";
      if (values.tipo === "plato") {
        const plato = platos?.find(p => p.id === values.item_id);
        itemNombre = plato?.nombre || "";
      } else {
        const sala = salas?.find(s => s.id === values.item_id);
        itemNombre = sala?.nombre || "";
      }

      // Determinar el bucket según el tipo
      const bucketName = values.tipo === "plato" ? "platos" : "salas";
      
      // Obtener la extensión del archivo
      const extension = archivo.name.split('.').pop();
      const fileName = `${values.item_id}.${extension}`;

      // Eliminar imágenes anteriores con el mismo ID (cualquier extensión)
      const { data: existingFiles } = await supabase.storage
        .from(bucketName)
        .list();

      if (existingFiles) {
        // Buscar archivos que empiecen con el ID del item
        const filesToDelete = existingFiles
          .filter(file => file.name.startsWith(values.item_id))
          .map(file => file.name);

        if (filesToDelete.length > 0) {
          const { error: deleteError } = await supabase.storage
            .from(bucketName)
            .remove(filesToDelete);

          if (deleteError) {
            console.warn("Error eliminando imágenes anteriores:", deleteError);
          }
        }
      }

      // Subir archivo a Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(fileName, archivo, {
          cacheControl: '3600',
          upsert: false, // Ya eliminamos la anterior, no necesitamos upsert
        });

      if (uploadError) {
        throw new Error(`Error al subir a Supabase Storage: ${uploadError.message}`);
      }

      // Convertir archivo a base64
      const archivoBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(archivo);
      });

      // Enviar al webhook a través de la edge function
      const { data, error } = await supabase.functions.invoke("enviar-imagen-webhook", {
        body: {
          tipo: values.tipo,
          item_id: values.item_id,
          item_nombre: itemNombre,
          archivo_nombre: archivo.name,
          archivo_tipo: archivo.type,
          archivo_size: archivo.size,
          archivo_base64: archivoBase64,
        },
      });

      if (error) throw error;

      toast.success("Imagen guardada en Supabase y enviada al webhook correctamente");
      form.reset();
      clearPreview();
    } catch (error: any) {
      console.error("Error procesando imagen:", error);
      toast.error("Error al procesar la imagen: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const platosActivos = platos?.filter(p => p.activado) || [];
  const salasActivas = salas?.filter(s => s.activa) || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subir Imágenes</CardTitle>
        <CardDescription>
          Sube imágenes de platos o del restaurante
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="tipo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de imagen</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Selecciona el tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-popover z-50">
                      <SelectItem value="plato">Plato</SelectItem>
                      <SelectItem value="restaurante">Restaurante (Sala)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="item_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {tipoSeleccionado === "plato" ? "Selecciona el plato" : "Selecciona la sala"}
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder={
                          tipoSeleccionado === "plato" 
                            ? "Selecciona un plato" 
                            : "Selecciona una sala"
                        } />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-popover z-50">
                      {tipoSeleccionado === "plato" ? (
                        platosActivos.map((plato) => (
                          <SelectItem key={plato.id} value={plato.id}>
                            {plato.nombre} - {plato.categoria}
                          </SelectItem>
                        ))
                      ) : (
                        salasActivas.map((sala) => (
                          <SelectItem key={sala.id} value={sala.id}>
                            {sala.nombre}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="archivo"
              render={({ field: { value, ...fieldProps } }) => (
                <FormItem>
                  <FormLabel>Imagen</FormLabel>
                  <FormControl>
                    <div className="space-y-4">
                      <Input
                        {...fieldProps}
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="cursor-pointer"
                      />
                      
                      {showPreview && imagePreview && (
                        <div className="relative rounded-lg border-2 border-border bg-muted/50 p-4 animate-in fade-in-50 duration-500">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <Eye className="h-4 w-4" />
                              Vista Previa
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 -mt-1 -mr-1"
                              onClick={clearPreview}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                          
                          <div className="relative aspect-video w-full overflow-hidden rounded-md bg-background">
                            <img
                              src={imagePreview}
                              alt="Preview"
                              className="object-contain w-full h-full"
                            />
                          </div>
                          
                          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                            Imagen lista para enviar
                          </div>
                        </div>
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button 
              type="submit" 
              className="w-full" 
              disabled={isSubmitting || !showPreview}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Enviar al Webhook
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
