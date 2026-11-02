import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { LIMITES_CARTA, textoObligatorio, textoOpcional } from "@/lib/limites-carta";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBebidas, NuevaBebida } from "@/hooks/useBebidas";
import { useFotoCarta } from "./recorte/useRecorteVino";
import { SelectorFotoCarta } from "./recorte/SelectorFotoCarta";
import { avisarGuardadoSinFondo } from "./recorte/avisoGuardadoSinFondo";
import { noCerrarAlTocarFuera } from "./dialogoCarta";
import { esquemaPrecioCarta, propsCampoPrecio } from "./precioCarta";
import { subirFotoCarta } from "./subirFotoCarta";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { aceptarFoto } from "@/lib/aceptarFoto";
import { ACCEPT_FOTO, mensajeErrorStorage } from "@/lib/validarFoto";

const UNIDADES_MEDIDA = ["cl", "ml", "L"];

const formSchema = z.object({
  nombre: textoObligatorio(LIMITES_CARTA.nombre, "El nombre es obligatorio"),
  categoria: textoObligatorio(LIMITES_CARTA.categoria, "La categoría es obligatoria"),
  precio_eur: esquemaPrecioCarta,
  descripcion: textoOpcional(LIMITES_CARTA.descripcion),
  cantidad: z.coerce.number().optional(),
  unidad: z.string().optional(),
});

interface BebidaFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaInicial?: string;
}

export function BebidaForm({ open, onOpenChange, categoriaInicial }: BebidaFormProps) {
  const { crearBebida, actualizarBebida, categorias } = useBebidas();
  const queryClient = useQueryClient();
  // Foto: recorte automático → sticker → foto con el fondo elegido.
  const fotoCarta = useFotoCarta("bebida");
  const { limpiar: limpiarFoto } = fotoCarta;
  const imageFile = fotoCarta.original;
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.input<typeof formSchema>, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: categoriaInicial || "",
      precio_eur: "",
      descripcion: "",
      cantidad: undefined,
      unidad: "cl",
    },
  });

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (file && (await aceptarFoto(file, input))) {
      // Sin FileReader: leer la foto entera como data URL (12-50 MP en el móvil)
      // gastaba decenas de MB para una vista previa que no se enseña (la foto
      // nueva la pinta SelectorFotoCarta).
      fotoCarta.iniciar(file);
      setImagePreview(null);
    }
  };

  const clearImage = () => {
    limpiarFoto();
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const onSubmit = async (values: z.output<typeof formSchema>) => {
    const tamano = values.cantidad && values.unidad ? `${values.cantidad}${values.unidad}` : undefined;
    // La traducción ya no se genera aquí: crearBebida (useBebidas.ts) llama a
    // traducir-contenido internamente al guardar (ver informe, TAREA 2).
    const bebidaData: NuevaBebida = {
      nombre: values.nombre.trim(),
      categoria: values.categoria.trim(),
      precio_eur: values.precio_eur,
      descripcion: values.descripcion,
      tamano: tamano,
    };

    const nuevaBebida = await crearBebida.mutateAsync(bebidaData);

    // Upload image if selected
    if (imageFile && nuevaBebida?.id) {
      setIsUploading(true);
      try {
        // Original intacto + foto de carta `-carta-<ext>.webp` (subirFotoCarta.ts).
        const subida = await subirFotoCarta("bebidas", nuevaBebida.id, {
          original: imageFile,
          compuesta: fotoCarta.usaCarta ? fotoCarta.compuesta : null,
        });

        await actualizarBebida.mutateAsync({
          id: nuevaBebida.id,
          imagen_url: subida.url,
        });

        queryClient.invalidateQueries({ queryKey: ["bebidas"] });
        avisarGuardadoSinFondo(fotoCarta.estado);
      } catch (error) {
        console.error('Error uploading image:', error);
        toast.error("Bebida creada, pero la foto no se ha podido subir. Súbela con el botón «Foto» de su tarjeta.", { description: mensajeErrorStorage(error) ?? undefined });
      } finally {
        setIsUploading(false);
      }
    }

    form.reset();
    clearImage();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto" onInteractOutside={noCerrarAlTocarFuera}>
        <DialogHeader>
          <DialogTitle>Añadir Bebida</DialogTitle>
          <DialogDescription>
            Completa los datos de la nueva bebida
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                accept={ACCEPT_FOTO}
                className="hidden"
              />
              
              {fotoCarta.original ? (
                <SelectorFotoCarta
                  recorte={fotoCarta}
                  alt="Foto del producto"
                  superpuesto={
                    <Button type="button" variant="destructive" size="icon" className="absolute right-2 top-2 h-11 w-11" onClick={clearImage} aria-label="Quitar la imagen">
                      <X className="h-4 w-4" />
                    </Button>
                  }
                />
              ) : imagePreview ? (
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

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="precio_eur"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio (€)</FormLabel>
                    <FormControl>
                      <Input {...field} {...propsCampoPrecio} value={(field.value as string | number | undefined) ?? ""} placeholder="Ej.: 4,50" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-2">
                <FormField
                  control={form.control}
                  name="cantidad"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cantidad</FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="decimal" placeholder="Ej: 33" {...field} />
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
                          <SelectTrigger>
                            <SelectValue placeholder="Unidad" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {UNIDADES_MEDIDA.map((u) => (
                            <SelectItem key={u} value={u}>
                              {u}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
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

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 px-5"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" className="h-11 px-5" disabled={crearBebida.isPending || isUploading || fotoCarta.trabajando}>
                {crearBebida.isPending || isUploading ? "Guardando..." : "Guardar Bebida"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
