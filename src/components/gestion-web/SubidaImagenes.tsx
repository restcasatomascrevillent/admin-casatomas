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
  tipo: z.enum(["platos", "salas", "novedades", "web"]),
  categoria: z.string().optional(),
  item_id: z.string().min(1, "Selecciona un elemento"),
  archivo: z.instanceof(FileList).refine((files) => files?.length === 1, "Debes subir un archivo"),
});

type FormValues = z.infer<typeof formSchema>;

export function SubidaImagenes() {
  const { platos, categorias } = usePlatos();
  const { data: salas } = useSalas();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tipo: "platos",
    },
  });

  const tipoSeleccionado = form.watch("tipo");
  const categoriaSeleccionada = form.watch("categoria");

  // Filtrar platos por categoría seleccionada
  const platosFiltrados = categoriaSeleccionada
    ? platos?.filter(p => p.categoria === categoriaSeleccionada && p.activado)
    : [];

  // Datos de ejemplo para Novedades y Web (se configurarán en el futuro)
  const novedades = [
    { id: "nov1", nombre: "Menú de Navidad 2024" },
    { id: "nov2", nombre: "Nueva Terraza de Verano" },
  ];

  const seccionesWeb = [
    { id: "hero", nombre: "Imagen Hero Principal" },
    { id: "about", nombre: "Sobre Nosotros" },
    { id: "galeria", nombre: "Galería" },
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, onChange: (files: FileList) => void) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result as string);
        setShowPreview(true);
      };
      reader.readAsDataURL(file);
      onChange(files);
    }
  };

  const clearPreview = () => {
    setImagePreview(null);
    setShowPreview(false);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (input) {
      input.value = '';
    }
    form.resetField("archivo");
  };

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const archivo = values.archivo[0];
      
      // Obtener el nombre del item
      let itemNombre = "";
      let bucketName = "";
      
      if (values.tipo === "platos") {
        const plato = platos?.find(p => p.id === values.item_id);
        itemNombre = plato?.nombre || "";
        bucketName = "platos";
      } else if (values.tipo === "salas") {
        const sala = salas?.find(s => s.id === values.item_id);
        itemNombre = sala?.nombre || "";
        bucketName = "salas";
      } else if (values.tipo === "novedades") {
        const novedad = novedades.find(n => n.id === values.item_id);
        itemNombre = novedad?.nombre || "";
        bucketName = "novedades";
      } else if (values.tipo === "web") {
        const seccion = seccionesWeb.find(s => s.id === values.item_id);
        itemNombre = seccion?.nombre || "";
        bucketName = "web";
      }
      
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
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Error al subir a Supabase Storage: ${uploadError.message}`);
      }

      toast.success("Imagen guardada correctamente en Supabase Storage");
      form.reset();
      clearPreview();
    } catch (error: any) {
      console.error("Error procesando imagen:", error);
      toast.error("Error al procesar la imagen: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

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
                  <Select 
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue("categoria", "");
                      form.setValue("item_id", "");
                    }} 
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Selecciona el tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-popover z-50">
                      <SelectItem value="platos">Platos</SelectItem>
                      <SelectItem value="salas">Salas</SelectItem>
                      <SelectItem value="novedades">Novedades</SelectItem>
                      <SelectItem value="web">Web</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {tipoSeleccionado === "platos" && (
              <FormField
                control={form.control}
                name="categoria"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoría del plato</FormLabel>
                    <Select 
                      onValueChange={(value) => {
                        field.onChange(value);
                        form.setValue("item_id", "");
                      }} 
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Selecciona una categoría" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-popover z-50">
                        {categorias?.map((categoria) => (
                          <SelectItem key={categoria} value={categoria}>
                            {categoria}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="item_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {tipoSeleccionado === "platos" && "Selecciona el plato"}
                    {tipoSeleccionado === "salas" && "Selecciona la sala"}
                    {tipoSeleccionado === "novedades" && "Selecciona la novedad"}
                    {tipoSeleccionado === "web" && "Selecciona la sección"}
                  </FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    value={field.value}
                    disabled={tipoSeleccionado === "platos" && !categoriaSeleccionada}
                  >
                    <FormControl>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder={
                          tipoSeleccionado === "platos" && !categoriaSeleccionada
                            ? "Primero selecciona una categoría"
                            : "Selecciona..."
                        } />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-popover z-50">
                      {tipoSeleccionado === "platos" && platosFiltrados.map((plato) => (
                        <SelectItem key={plato.id} value={plato.id}>
                          {plato.nombre}
                        </SelectItem>
                      ))}
                      
                      {tipoSeleccionado === "salas" && salas?.filter(s => s.activa).map((sala) => (
                        <SelectItem key={sala.id} value={sala.id}>
                          {sala.nombre}
                        </SelectItem>
                      ))}
                      
                      {tipoSeleccionado === "novedades" && novedades.map((novedad) => (
                        <SelectItem key={novedad.id} value={novedad.id}>
                          {novedad.nombre}
                        </SelectItem>
                      ))}
                      
                      {tipoSeleccionado === "web" && seccionesWeb.map((seccion) => (
                        <SelectItem key={seccion.id} value={seccion.id}>
                          {seccion.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="archivo"
              render={({ field: { onChange, value, ...fieldProps } }) => (
                <FormItem>
                  <FormLabel>Imagen</FormLabel>
                  <FormControl>
                    <div className="space-y-4">
                      <Input
                        {...fieldProps}
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleFileChange(e, onChange)}
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
