import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { LIMITES_CARTA, textoObligatorio, textoOpcional } from "@/lib/limites-carta";
import { Camera, Loader2, X } from "lucide-react";
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
import { useFotoCarta } from "./recorte/useRecorteVino";
import { aceptarFotoCarta } from "./recorte/fotoYaRecortada";
import { PegarFotoRecortada } from "./recorte/PegarFotoRecortada";
import { SelectorFotoCarta } from "./recorte/SelectorFotoCarta";
import { trasGuardarFotoCarta } from "./recorte/avisoGuardadoSinFondo";
import { noCerrarAlTocarFuera } from "./dialogoCarta";
import { esquemaPrecioCarta, precioParaCampo, propsCampoPrecio } from "./precioCarta";
import { BotonCambiarFondo } from "./recorte/BotonCambiarFondo";
import { rutaEnBucket, subirFotoCarta } from "./subirFotoCarta";
import { borrarFotoSiNoSeUsa } from "@/lib/storage-carta";
import { Bebida, useBebidas } from "@/hooks/useBebidas";
import { toast } from "sonner";
import { ACCEPT_FOTO, mensajeErrorStorage } from "@/lib/validarFoto";

const formSchema = z.object({
  nombre: textoObligatorio(LIMITES_CARTA.nombre, "El nombre es obligatorio"),
  categoria: textoObligatorio(LIMITES_CARTA.categoria, "La categoría es obligatoria"),
  precio_eur: esquemaPrecioCarta,
  descripcion: textoOpcional(LIMITES_CARTA.descripcion),
  tamano: textoOpcional(LIMITES_CARTA.tamano),
});

/**
 * Deriva el nombre de fichero en Storage a partir de la URL pública guardada.
 * Todas las subidas de esta carpeta usan `${id}.${extensión}` como nombre
 * (ver más abajo, y BebidaForm/CoctelForm/PlatoForm/VinoForm), así que basta
 * con recuperar la extensión de la URL vieja (sin el `?t=...` que se añade
 * como cache-buster al subir) para reconstruir el path a borrar.
 */
function nombreArchivoStorage(id: string, imagenUrl: string | null | undefined): string | null {
  if (!imagenUrl) return null;
  const sinQuery = imagenUrl.split("?")[0];
  const ext = sinQuery.split(".").pop();
  if (!ext) return null;
  return `${id}.${ext}`;
}

interface EditarBebidaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bebida: Bebida | null;
}

export function EditarBebidaModal({ open, onOpenChange, bebida }: EditarBebidaModalProps) {
  const { actualizarBebida, categorias } = useBebidas();
  // Foto: recorte automático → sticker → foto con el fondo elegido.
  const fotoCarta = useFotoCarta("bebida");
  const { limpiar: limpiarFoto } = fotoCarta;
  const imageFile = fotoCarta.original;
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.input<typeof formSchema>, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: "",
      precio_eur: "",
      descripcion: "",
      tamano: "",
    },
  });

  useEffect(() => {
    if (!open || !bebida) return;

    form.reset({
      nombre: bebida.nombre ?? "",
      categoria: bebida.categoria ?? "",
      precio_eur: precioParaCampo(bebida.precio_eur),
      descripcion: bebida.descripcion ?? "",
      tamano: bebida.tamano ?? "",
    });

    limpiarFoto();
    setImagePreview(bebida.imagen_url ?? null);
    setRemoveImage(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [open, bebida, form, limpiarFoto]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => void usarFoto(e.target.files?.[0], e.target);

  /** Foto elegida o pegada («Pegar foto recortada»): si ya viene sin fondo, no se pasa el modelo. */
  const usarFoto = async (elegida: File | undefined, input?: HTMLInputElement | null) => {
    const file = elegida ? await aceptarFotoCarta(elegida, input) : null;
    if (!file) return;

    fotoCarta.iniciar(file);
    setRemoveImage(false);
    // Sin FileReader: leer la foto entera como data URL (12-50 MP en el móvil)
    // gastaba decenas de MB para una vista previa que no se enseña (la foto
    // nueva la pinta SelectorFotoCarta).
    setImagePreview(null);
  };

  const clearImage = () => {
    limpiarFoto();
    setImagePreview(null);
    setRemoveImage(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const onSubmit = async (values: z.output<typeof formSchema>) => {
    if (!bebida) return;

    setIsUploadingImage(true);
    try {
      let imageUrlUpdate: string | null | undefined = undefined;
      // Foto que esta ficha deja de usar: se borra DESPUÉS de guardar (si el
      // guardado falla, la ficha la sigue mostrando) y solo si ninguna otra
      // ficha la usa (dos fichas pueden compartir la misma foto).
      let fotoAntigua: string | null = null;

      if (imageFile) {
        // Original intacto + foto de carta `-carta-<ext>.webp` (subirFotoCarta.ts).
        const subida = await subirFotoCarta("bebidas", bebida.id, {
          original: imageFile,
          compuesta: fotoCarta.usaCarta ? fotoCarta.compuesta : null,
        });
        imageUrlUpdate = subida.url;
        // Si el nuevo fichero cambia de nombre (p. ej. .jpg -> .png), el upsert
        // no sobrescribe el antiguo: se anota para borrarlo tras guardar.
        const nombreArchivoAnterior =
          rutaEnBucket(bebida.imagen_url, "bebidas") ?? nombreArchivoStorage(bebida.id, bebida.imagen_url);
        if (nombreArchivoAnterior && !subida.rutas.includes(nombreArchivoAnterior)) fotoAntigua = nombreArchivoAnterior;
      } else if (removeImage) {
        imageUrlUpdate = null;
        fotoAntigua = rutaEnBucket(bebida.imagen_url, "bebidas") ?? nombreArchivoStorage(bebida.id, bebida.imagen_url);
      }

      await actualizarBebida.mutateAsync({
        id: bebida.id,
        nombre: values.nombre.trim(),
        categoria: values.categoria.trim(),
        precio_eur: values.precio_eur,
        descripcion: values.descripcion?.trim() || null,
        tamano: values.tamano?.trim() || null,
        ...(imageUrlUpdate !== undefined ? { imagen_url: imageUrlUpdate } : {}),
      });

      if (fotoAntigua) {
        await borrarFotoSiNoSeUsa({ tabla: "Bebidas", bucket: "bebidas", ruta: fotoAntigua, excluirId: bebida.id });
      }

      trasGuardarFotoCarta(fotoCarta, { tabla: "Bebidas", id: bebida.id, nombre: bebida.nombre });
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating bebida:", error);
      toast.error("No se pudo actualizar la bebida", { description: mensajeErrorStorage(error) ?? undefined });
    } finally {
      setIsUploadingImage(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="carta-contraste max-w-2xl max-h-[90dvh] overflow-y-auto" onInteractOutside={noCerrarAlTocarFuera}>
        <DialogHeader>
          <DialogTitle>Editar Bebida</DialogTitle>
          <DialogDescription>
            Modifica los datos de la bebida seleccionada
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

            <div className="space-y-2">
              <FormLabel>Imagen</FormLabel>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageChange}
                accept={ACCEPT_FOTO}
                className="hidden"
              />
              <PegarFotoRecortada onFoto={(f) => void usarFoto(f)} />

              {fotoCarta.original ? (
                <SelectorFotoCarta
                  recorte={fotoCarta}
                  alt="Foto del producto"
                />
              ) : imagePreview ? (
                <div className="relative w-full h-48 rounded-lg overflow-hidden border">
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
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
                  <p className="text-sm text-muted-foreground">Toca para añadir imagen</p>
                </div>
              )}

              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  Cambiar foto
                </Button>
                <BotonCambiarFondo
                  recorte={fotoCarta}
                  tabla="Bebidas"
                  id={bebida?.id}
                  url={removeImage ? null : bebida?.imagen_url}
                  onIniciado={() => {
                    setRemoveImage(false);
                    setImagePreview(null);
                  }}
                />
                {(imagePreview || fotoCarta.original) && (
                  <Button type="button" variant="outline" className="text-destructive" onClick={clearImage}>
                    Quitar foto
                  </Button>
                )}
              </div>
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

              <FormField
                control={form.control}
                name="tamano"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tamaño</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: 33cl" {...field} />
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

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="h-11 px-5" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="h-11 px-5" disabled={actualizarBebida.isPending || isUploadingImage || fotoCarta.trabajando}>
                {actualizarBebida.isPending || isUploadingImage ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  "Guardar cambios"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
