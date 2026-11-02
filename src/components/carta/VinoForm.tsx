import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { nombreCarta, categoriaCarta, descripcionCarta } from "@/lib/limites-carta";
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
import { toast } from "sonner";
import { subirFotoCarta } from "./subirFotoCarta";
import { useQueryClient } from "@tanstack/react-query";
import { CamposVino } from "./CamposVino";
import { formatoEuros, fuentesMercado, precioMercado, precioSugerido, type VinoDesdeFoto } from "./leerVinoFoto";
import { useRecorteVino } from "./recorte/useRecorteVino";
import { SelectorFotoCarta } from "./recorte/SelectorFotoCarta";
import { trasGuardarFotoCarta } from "./recorte/avisoGuardadoSinFondo";
import { noCerrarAlTocarFuera } from "./dialogoCarta";
import { esquemaPrecioCarta } from "./precioCarta";
import { urlSegura } from "@/lib/url-segura";
import { aceptarFoto } from "@/lib/aceptarFoto";
import { ACCEPT_FOTO, mensajeErrorStorage } from "@/lib/validarFoto";

const formSchema = z.object({
  nombre: nombreCarta,
  categoria: categoriaCarta,
  precio_eur: esquemaPrecioCarta,
  descripcion: descripcionCarta,
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

  const form = useForm<z.input<typeof formSchema>, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: categoriaInicial || "",
      precio_eur: "",
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
      precio_eur: "",
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

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (file && (await aceptarFoto(file, input))) recorte.iniciar(file);
  };

  const clearImage = () => {
    recorte.limpiar();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const onSubmit = async (values: z.output<typeof formSchema>) => {
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
        // Original intacto `<id>.<ext>` + foto de carta `<id>-carta-<ext>.webp`
        // (subirFotoCarta.ts): el script de homogeneizar la reconoce como ya
        // procesada y se puede volver a la original.
        const { url } = await subirFotoCarta("vinos", nuevoVino.id, {
          original: recorte.original,
          compuesta: recorte.usaCarta ? recorte.compuesta : null,
        });

        await actualizarVino.mutateAsync({
          id: nuevoVino.id,
          imagen_url: url,
        });

        queryClient.invalidateQueries({ queryKey: ["vinos"] });
        trasGuardarFotoCarta(recorte, { tabla: "Vinos", id: nuevoVino.id, nombre: nuevoVino.nombre });
      } catch (error) {
        console.error('Error uploading image:', error);
        toast.error("Vino creado, pero la foto no se ha podido subir. Súbela con el botón «Foto» de su tarjeta.", { description: mensajeErrorStorage(error) ?? undefined });
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
          <DialogTitle>Añadir Vino</DialogTitle>
          <DialogDescription>
            {precarga
              ? "Datos leídos de la etiqueta: revísalos, pon el precio y guarda"
              : "Completa los datos del nuevo vino"}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Image upload field */}
            <div className="space-y-2">
              <FormLabel>Foto de la botella</FormLabel>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageChange}
                accept={ACCEPT_FOTO}
                className="hidden"
              />
              
              {recorte.original ? (
                <SelectorFotoCarta
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
                    <p className="break-words text-xs text-muted-foreground">
                      En tienda: <span className="font-medium text-foreground">~{formatoEuros(enTienda)}</span>
                      {fuentesTienda.flatMap((f) => { const href = urlSegura(f.url); return href ? [{ ...f, href }] : []; }).map((f) => (
                        <a
                          key={f.url}
                          href={f.href}
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

            {/* Con dedo el pie queda pegado abajo del diálogo (formulario largo o teclado abierto en
                iOS): «Guardar» siempre a la vista. Con ratón, igual que antes. En el móvil, «Cancelar» y
                «Guardar» a medias del ancho y el pie por encima de todo (z-20 + isolate): en un iPhone se
                colaba entre los dos un botón del formulario («Usar» del precio sugerido, 02/11/2026). */}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end pointer-coarse:sticky pointer-coarse:bottom-[-1.5625rem] pointer-coarse:z-20 pointer-coarse:isolate pointer-coarse:-mx-6 pointer-coarse:border-t pointer-coarse:bg-background pointer-coarse:px-6 pointer-coarse:py-3">
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
