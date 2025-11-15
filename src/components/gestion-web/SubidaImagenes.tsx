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
import { Upload, Loader2 } from "lucide-react";
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

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tipo: "plato",
    },
  });

  const tipoSeleccionado = form.watch("tipo");
  const fileInputRef = form.register("archivo");

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

      toast.success("Imagen enviada correctamente");
      form.reset();
    } catch (error: any) {
      console.error("Error enviando imagen:", error);
      toast.error("Error al enviar la imagen: " + error.message);
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
              render={() => (
                <FormItem>
                  <FormLabel>Archivo de imagen</FormLabel>
                  <FormControl>
                    <Input
                      type="file"
                      accept="image/*"
                      {...fileInputRef}
                      className="cursor-pointer"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Subir Imagen
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
