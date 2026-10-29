import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
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
  FormLabel,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useVinos, NuevoVino } from "@/hooks/useVinos";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { nombreSubida } from "./fotoCartaVino";
import { useQueryClient } from "@tanstack/react-query";
import { CamposVino } from "./CamposVino";
import { formatoEuros, fuentesMercado, precioMercado, precioSugerido, type VinoDesdeFoto } from "./leerVinoFoto";
import { useRecorteVino } from "./recorte/useRecorteVino";
import { VistaRecorteVino } from "./recorte/VistaRecorteVino";

const formSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  categoria: z.string().min(1, "La categoría es obligatoria"),
  precio_eur: z.coerce.number().min(0, "El precio debe ser mayor o igual a 0"),
  descripcion: z.string().optional(),
  ingredientes: z.string().optional(),
  denominacion_origen: z.string().optional(),
  ubicacion_pais: z.string().trim().min(1, "El país es obligatorio para el mapa"),
  ubicacion_region: z.string().trim().min(1, "La región es obligatoria para el mapa"),
});

interface VinoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaInicial?: string;
  /** Datos leídos de la foto de la botella: precargan el formulario (el usuario revisa y guarda). */
  precarga?: VinoDesdeFoto | null;
}

export function VinoForm({ open, onOpenChange, categoriaInicial, precarga }: VinoFormProps) {
  const { crearVino, actualizarVino, categorias, denominaciones, regiones, paises } = useVinos();
  const queryClient = useQueryClient();
  // Foto: recorte gratis en el navegador → sticker → foto con fondo de carta.
  const recorte = useRecorteVino();
  const imageFile = recorte.archivoFinal;
  const { iniciar: iniciarRecorte, limpiar: limpiarRecorte } = recorte;
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: categoriaInicial || "",
      precio_eur: 0,
      descripcion: "",
      ingredientes: "",
      denominacion_origen: "",
      ubicacion_pais: "",
      ubicacion_region: "",
    },
  });

  // Precarga desde la foto de la botella (BotonVinoDesdeFoto). Precio vacío
  // a propósito: no se lee de la etiqueta.
  const precargadoRef = useRef(false);
  // Precarga con la que se abrió (modo lote: avisar al cerrar aunque el padre ya la haya limpiado).
  const precargaAbiertaRef = useRef<VinoDesdeFoto | null>(null);
  useEffect(() => {
    if (!open) {
      const anterior = precargaAbiertaRef.current;
      precargaAbiertaRef.current = null;
      anterior?.alCerrar?.();
      // Si se cierra sin guardar un formulario precargado, no dejar sus datos
      // para el siguiente «Añadir vino».
      if (precargadoRef.current) {
        precargadoRef.current = false;
        form.reset({ ...form.formState.defaultValues, categoria: categoriaInicial || "" });
        limpiarRecorte();
      }
      return;
    }
    if (!precarga) return;
    precargadoRef.current = true;
    precargaAbiertaRef.current = precarga;
    const d = precarga.datos;
    form.reset({
      nombre: d.nombre ?? "",
      categoria: d.categoria ?? categoriaInicial ?? "",
      precio_eur: 0,
      descripcion: d.descripcion ?? "",
      ingredientes: d.ingredientes ?? "",
      denominacion_origen: d.denominacion_origen ?? "",
      ubicacion_pais: d.ubicacion_pais ?? "",
      ubicacion_region: d.ubicacion_region ?? "",
    });
    iniciarRecorte(precarga.foto, precarga.recorte);
  }, [open, precarga, form, categoriaInicial, iniciarRecorte, limpiarRecorte]);

  const sugerido = precarga ? precioSugerido(precarga.datos) : null;
  const enTienda = precarga ? precioMercado(precarga.datos) : null;
  const fuentesTienda = precarga ? fuentesMercado(precarga.datos) : [];

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) recorte.iniciar(file);
  };

  const clearImage = () => {
    recorte.limpiar();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    // La traducción ya no se genera aquí: crearVino (useVinos.ts) llama a
    // traducir-contenido internamente al guardar (ver informe, TAREA 2).
    const vinoData: NuevoVino = {
      nombre: values.nombre,
      categoria: values.categoria,
      precio_eur: values.precio_eur,
      descripcion: values.descripcion,
      ingredientes: values.ingredientes,
      denominacion_origen: values.denominacion_origen,
      ubicacion_pais: values.ubicacion_pais,
      ubicacion_region: values.ubicacion_region,
    };

    const nuevoVino = await crearVino.mutateAsync(vinoData);
    precarga?.alGuardar?.();

    // Upload image if selected
    if (imageFile && nuevoVino?.id) {
      setIsUploading(true);
      try {
        // Foto de carta (sin fondo, compuesta) → `<id>-carta.<ext>`: así el
        // script de homogeneizar la reconoce como ya procesada.
        const fileName = nombreSubida(nuevoVino.id, imageFile);

        const { error: uploadError } = await supabase.storage
          .from('vinos')
          .upload(fileName, imageFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('vinos')
          .getPublicUrl(fileName);

        await actualizarVino.mutateAsync({
          id: nuevoVino.id,
          imagen_url: urlData.publicUrl,
        });

        queryClient.invalidateQueries({ queryKey: ["vinos"] });
      } catch (error) {
        console.error('Error uploading image:', error);
        toast.error("Error al subir la imagen");
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
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Añadir Vino</DialogTitle>
          <DialogDescription>
            {precarga
              ? "Datos leídos de la etiqueta: revísalos, pon el precio y guarda"
              : "Completa los datos del nuevo vino"}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Image upload field */}
            <div className="space-y-2">
              <FormLabel>Foto de la botella</FormLabel>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageChange}
                accept="image/*"
                className="hidden"
              />
              
              {recorte.original ? (
                <VistaRecorteVino
                  recorte={recorte}
                  alt={precarga ? "Foto de la botella" : "Vista previa"}
                  superpuesto={
                  <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute bottom-2 right-2 h-11 w-11"
                    aria-label="Cambiar imagen"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-11 w-11"
                    aria-label="Quitar imagen"
                    onClick={clearImage}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  </>
                  }
                />
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

            <CamposVino
              control={form.control}
              categorias={categorias}
              denominaciones={denominaciones}
              regiones={regiones}
              paises={paises}
              bajoPrecio={
                (sugerido !== null || enTienda !== null) && (
                  <div className="space-y-1 rounded-md bg-muted/60 px-2 py-1 text-sm">
                    {sugerido !== null && (
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-muted-foreground">
                        Sugerido: <span className="font-medium text-foreground">{formatoEuros(sugerido)}</span>
                        {precarga?.datos.precio_razon ? ` — ${precarga.datos.precio_razon}` : ""}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 shrink-0"
                        onClick={() => form.setValue("precio_eur", sugerido, { shouldValidate: true, shouldDirty: true })}
                      >
                        Usar
                      </Button>
                    </div>
                    )}
                  {enTienda !== null && (
                    <p className="text-xs text-muted-foreground">
                      En tienda: <span className="font-medium text-foreground">~{formatoEuros(enTienda)}</span>
                      {fuentesTienda.map((f) => (
                        <a
                          key={f.url}
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 underline underline-offset-2 hover:text-foreground"
                        >
                          {f.tienda} ({formatoEuros(f.precio)})
                        </a>
                      ))}
                    </p>
                  )}
                  </div>
                )
              }
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
              <Button type="submit" className="h-11 px-5" disabled={crearVino.isPending || isUploading || recorte.trabajando}>
                {crearVino.isPending || isUploading ? "Guardando..." : recorte.trabajando ? "Recortando foto…" : "Guardar Vino"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
