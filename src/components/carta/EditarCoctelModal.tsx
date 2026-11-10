import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { LIMITES_CARTA, errorAlergenoPersonalizado, textoObligatorio, textoOpcional } from "@/lib/limites-carta";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ComboboxCreatable } from "@/components/ui/combobox-creatable";
import { useFotoCarta } from "./recorte/useRecorteVino";
import { aceptarFotoCarta } from "./recorte/fotoYaRecortada";
import { PegarFotoRecortada } from "./recorte/PegarFotoRecortada";
import { SelectorFotoCarta } from "./recorte/SelectorFotoCarta";
import { trasGuardarFotoCarta } from "./recorte/avisoGuardadoSinFondo";
import { noCerrarAlTocarFuera } from "./dialogoCarta";
import { BotonCambiarFondo } from "./recorte/BotonCambiarFondo";
import { rutaEnBucket, subirFotoCarta } from "./subirFotoCarta";
import { borrarFotoSiNoSeUsa } from "@/lib/storage-carta";
import { Coctel, useCocteles } from "@/hooks/useCocteles";
import { toast } from "sonner";
import {
  ALERGENOS_OFICIALES,
  combinarAlergenos,
  normalizarAlergeno,
  separarAlergenos,
} from "@/lib/alergenos";
import { ACCEPT_FOTO, mensajeErrorStorage } from "@/lib/validarFoto";

const formSchema = z.object({
  nombre: textoObligatorio(LIMITES_CARTA.nombre, "El nombre es obligatorio"),
  categoria: textoObligatorio(LIMITES_CARTA.categoria, "La categoría es obligatoria"),
  precio_eur: z.coerce.number().min(0, "El precio debe ser mayor o igual a 0"),
  descripcion: textoOpcional(LIMITES_CARTA.descripcion),
  ingredientes: textoOpcional(LIMITES_CARTA.ingredientes),
  preparacion: textoOpcional(LIMITES_CARTA.preparacion),
  alergenos_notas: textoOpcional(LIMITES_CARTA.alergenosNotas),
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

interface EditarCoctelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coctel: Coctel | null;
}

export function EditarCoctelModal({ open, onOpenChange, coctel }: EditarCoctelModalProps) {
  const { actualizarCoctel, categorias } = useCocteles();
  // Foto: recorte automático → sticker → foto con el fondo elegido.
  const fotoCarta = useFotoCarta("bebida");
  const { limpiar: limpiarFoto } = fotoCarta;
  const imageFile = fotoCarta.original;
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [alergenosSeleccionados, setAlergenosSeleccionados] = useState<string[]>([]);
  const [alergenosPersonalizados, setAlergenosPersonalizados] = useState<string[]>([]);
  const [nuevoAlergeno, setNuevoAlergeno] = useState("");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: "",
      precio_eur: 0,
      descripcion: "",
      ingredientes: "",
      preparacion: "",
      alergenos_notas: "",
    },
  });

  useEffect(() => {
    if (!open || !coctel) return;

    // Clasifica lo guardado en oficiales (ya en forma canónica) y
    // personalizados de verdad (mismo criterio que EditarPlatoModal.tsx).
    const { oficiales, personalizados } = separarAlergenos(coctel.alergenos_oficiales);

    form.reset({
      nombre: coctel.nombre ?? "",
      categoria: coctel.categoria ?? "",
      precio_eur: coctel.precio_eur ?? 0,
      descripcion: coctel.descripcion ?? "",
      ingredientes: coctel.ingredientes ?? "",
      preparacion: coctel.preparacion ?? "",
      alergenos_notas: coctel.alergenos_notas ?? "",
    });

    setAlergenosSeleccionados(oficiales);
    setAlergenosPersonalizados(personalizados);
    setNuevoAlergeno("");

    limpiarFoto();
    setImagePreview(coctel.imagen_url ?? null);
    setRemoveImage(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [open, coctel, form, limpiarFoto]);

  const toggleAlergeno = (id: string) => {
    setAlergenosSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const addAlergenoPersonalizado = () => {
    const trimmed = nuevoAlergeno.trim();
    if (!trimmed) return;
    const errorLargo = errorAlergenoPersonalizado(trimmed);
    if (errorLargo) {
      toast.error(errorLargo);
      return;
    }

    const canonico = normalizarAlergeno(trimmed);
    if (canonico) {
      setAlergenosSeleccionados((prev) =>
        prev.includes(canonico) ? prev : [...prev, canonico]
      );
      setNuevoAlergeno("");
      return;
    }

    if (!alergenosPersonalizados.includes(trimmed)) {
      setAlergenosPersonalizados((prev) => [...prev, trimmed]);
    }
    setNuevoAlergeno("");
  };

  const removeAlergenoPersonalizado = (alergeno: string) => {
    setAlergenosPersonalizados((prev) => prev.filter((item) => item !== alergeno));
  };

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

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!coctel) return;

    setIsUploadingImage(true);
    try {
      const alergenos = combinarAlergenos(alergenosSeleccionados, alergenosPersonalizados);
      let imageUrlUpdate: string | null | undefined = undefined;
      // Foto que esta ficha deja de usar: se borra DESPUÉS de guardar (si el
      // guardado falla, la ficha la sigue mostrando) y solo si ninguna otra
      // ficha la usa (dos fichas pueden compartir la misma foto).
      let fotoAntigua: string | null = null;

      if (imageFile) {
        // Original intacto + foto de carta `-carta-<ext>.webp` (subirFotoCarta.ts).
        const subida = await subirFotoCarta("cocteles", coctel.id, {
          original: imageFile,
          compuesta: fotoCarta.usaCarta ? fotoCarta.compuesta : null,
        });
        imageUrlUpdate = subida.url;
        // Si el nuevo fichero cambia de nombre (p. ej. .jpg -> .png), el upsert
        // no sobrescribe el antiguo: se anota para borrarlo tras guardar.
        const nombreArchivoAnterior =
          rutaEnBucket(coctel.imagen_url, "cocteles") ?? nombreArchivoStorage(coctel.id, coctel.imagen_url);
        if (nombreArchivoAnterior && !subida.rutas.includes(nombreArchivoAnterior)) fotoAntigua = nombreArchivoAnterior;
      } else if (removeImage) {
        imageUrlUpdate = null;
        fotoAntigua = rutaEnBucket(coctel.imagen_url, "cocteles") ?? nombreArchivoStorage(coctel.id, coctel.imagen_url);
      }

      await actualizarCoctel.mutateAsync({
        id: coctel.id,
        nombre: values.nombre.trim(),
        categoria: values.categoria.trim(),
        precio_eur: values.precio_eur,
        descripcion: values.descripcion?.trim() || null,
        ingredientes: values.ingredientes?.trim() || null,
        preparacion: values.preparacion?.trim() || null,
        alergenos_notas: values.alergenos_notas?.trim() || null,
        alergenos_oficiales: alergenos.length > 0 ? alergenos : null,
        ...(imageUrlUpdate !== undefined ? { imagen_url: imageUrlUpdate } : {}),
      });

      if (fotoAntigua) {
        await borrarFotoSiNoSeUsa({ tabla: "Cocteles", bucket: "cocteles", ruta: fotoAntigua, excluirId: coctel.id });
      }

      trasGuardarFotoCarta(fotoCarta, { tabla: "Cocteles", id: coctel.id, nombre: coctel.nombre });
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating coctel:", error);
      toast.error("No se pudo actualizar el cóctel", { description: mensajeErrorStorage(error) ?? undefined });
    } finally {
      setIsUploadingImage(false);
    }
  };

  const categoriasOptions = categorias.filter((cat): cat is string => cat !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="carta-contraste max-w-2xl max-h-[90dvh] overflow-y-auto" onInteractOutside={noCerrarAlTocarFuera}>
        <DialogHeader>
          <DialogTitle>Editar Cóctel</DialogTitle>
          <DialogDescription>
            Modifica los datos del cóctel seleccionado
          </DialogDescription>
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
                    <Input type="number" inputMode="decimal" step="0.01" min="0" {...field} />
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

            <div className="space-y-2">
              <FormLabel>Imagen del Cóctel</FormLabel>
              <div className="flex flex-col gap-3">
                {fotoCarta.original ? (
                  <SelectorFotoCarta
                    recorte={fotoCarta}
                    alt="Foto del producto"
                  />
                ) : imagePreview ? (
                  <div className="relative inline-block">
                    <img
                      src={imagePreview}
                      alt="Vista previa"
                      className="w-32 h-32 object-cover rounded-lg border"
                    />
                    <button
                      type="button"
                      onClick={clearImage}
                      aria-label="Quitar la imagen"
                      className="absolute -top-3 -right-3 flex h-11 w-11 items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    Cambiar foto
                  </Button>
                  <BotonCambiarFondo
                    recorte={fotoCarta}
                    tabla="Cocteles"
                    id={coctel?.id}
                    url={removeImage ? null : coctel?.imagen_url}
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
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT_FOTO}
                  onChange={handleImageChange}
                  className="hidden"
                />
                <PegarFotoRecortada onFoto={(f) => void usarFoto(f)} />
              </div>
            </div>

            {/* Selector de Alérgenos (ver src/lib/alergenos.ts) */}
            <div className="space-y-3">
              <FormLabel>Alérgenos</FormLabel>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ALERGENOS_OFICIALES.map((alergeno) => {
                  const isSelected = alergenosSeleccionados.includes(alergeno.id);
                  return (
                    <button
                      key={alergeno.id}
                      type="button"
                      onClick={() => toggleAlergeno(alergeno.id)}
                      className={[
                        "flex items-center gap-1.5 min-h-11 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 border",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted",
                      ].join(" ")}
                    >
                      <span className="truncate">{alergeno.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <Input
                  value={nuevoAlergeno}
                  onChange={(e) => setNuevoAlergeno(e.target.value)}
                  placeholder="Añadir alérgeno personalizado..."
                  className="h-11 flex-1 text-base md:text-base"
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
                  onClick={addAlergenoPersonalizado}
                  disabled={!nuevoAlergeno.trim()}
                >
                  Añadir
                </Button>
              </div>

              {alergenosPersonalizados.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {alergenosPersonalizados.map((alergeno) => (
                    <Badge key={alergeno} variant="secondary" className="gap-0 py-0 pl-3 pr-0 text-sm">
                      {alergeno}
                      <button
                        type="button"
                        onClick={() => removeAlergenoPersonalizado(alergeno)}
                        className="flex h-11 w-11 items-center justify-center hover:text-destructive"
                        aria-label={`Quitar ${alergeno}`}
                      >
                        <X className="h-4 w-4" />
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
                      placeholder="Ej: puede contener trazas de..."
                      className="resize-none"
                      rows={2}
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
              <Button type="submit" className="h-11 px-5" disabled={actualizarCoctel.isPending || isUploadingImage || fotoCarta.trabajando}>
                {actualizarCoctel.isPending || isUploadingImage ? (
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
