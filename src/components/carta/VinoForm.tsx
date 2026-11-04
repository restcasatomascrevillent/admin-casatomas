import { useState, useRef, useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { nombreCarta, descripcionCarta } from "@/lib/limites-carta";
import { categoriasConOrigen, categoriaVino, mensajeFaltaOrigen, origenVinoClaro, paisVino, regionVino } from "@/lib/origen-vino";
import { Loader2, Camera, X, Sparkles, ImagePlus } from "lucide-react";
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
import type { VinoDesdeFoto } from "./leerVinoFoto";
import { useLecturaEtiquetaVino, valoresDesdeDatosVino } from "./lecturaEtiquetaVino";
import { PistaPrecioVino } from "./PistaPrecioVino";
import { useRecorteVino } from "./recorte/useRecorteVino";
import { aceptarFotoCarta } from "./recorte/fotoYaRecortada";
import { PegarFotoRecortada } from "./recorte/PegarFotoRecortada";
import { SelectorFotoCarta } from "./recorte/SelectorFotoCarta";
import { trasGuardarFotoCarta } from "./recorte/avisoGuardadoSinFondo";
import { noCerrarAlTocarFuera } from "./dialogoCarta";
import { esquemaPrecioCarta } from "./precioCarta";
import { CamposCopaParker } from "./CamposCopaParker";
import { camposCopaParker, cambiosCopaParker, COPA_PARKER_VACIO, exigirPrecioCopa } from "./copaParker";
import { ACCEPT_FOTO, mensajeErrorStorage } from "@/lib/validarFoto";

// Origen obligatorio (04/11/2026): país, región y categoría con denominación
// (no «… — ORIGEN PENDIENTE»). Sin él no se guarda, tampoco si lo rellena la IA.
// Copa y Parker (04/11/2026): ver copaParker.ts.
const formSchema = z
  .object({
    nombre: nombreCarta,
    categoria: categoriaVino,
    precio_eur: esquemaPrecioCarta,
    descripcion: descripcionCarta,
    ingredientes: z.string().optional(),
    denominacion_origen: z.string().optional(),
    ubicacion_pais: paisVino,
    ubicacion_region: regionVino,
    ...camposCopaParker,
  })
  .superRefine(exigirPrecioCopa);

interface VinoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaInicial?: string;
  /**
   * Datos ya leídos de la foto de la botella (modo «Varias botellas»): precargan
   * el formulario y NO se vuelve a llamar a la IA. Sin precarga, la IA lee la
   * etiqueta al poner la foto en el propio formulario (lecturaEtiquetaVino.ts).
   */
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
  // Móvil: «Hacer foto» abre directamente la cámara trasera (sin obligar: también galería o pegar).
  const camaraInputRef = useRef<HTMLInputElement>(null);

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
      ...COPA_PARKER_VACIO,
    },
  });

  // Sin las categorías «… — ORIGEN PENDIENTE»: no se puede elegir ninguna.
  const categoriasValidas = categoriasConOrigen(categorias);

  // Lectura de la etiqueta con IA al poner la foto (en paralelo al recorte,
  // que ya se hace aquí también en el móvil).
  const lectura = useLecturaEtiquetaVino(form, categoriasValidas);
  const { cancelar: cancelarLectura, limpiar: limpiarLectura } = lectura;

  // Precarga desde la foto de la botella (lote «Varias botellas»). Precio vacío
  // a propósito: no se lee de la etiqueta.
  const precargadoRef = useRef(false);
  // Precarga con la que se abrió (modo lote: avisar al cerrar aunque el padre ya la haya limpiado).
  const precargaAbiertaRef = useRef<VinoDesdeFoto | null>(null);
  useEffect(() => {
    if (!open) {
      const anterior = precargaAbiertaRef.current;
      precargaAbiertaRef.current = null;
      anterior?.alCerrar?.();
      // Una lectura que llegue con el formulario cerrado no rellena nada.
      cancelarLectura();
      // Si se cierra sin guardar un formulario precargado, no dejar sus datos
      // para el siguiente «Añadir vino».
      if (precargadoRef.current) {
        precargadoRef.current = false;
        form.reset({ ...form.formState.defaultValues, categoria: categoriaInicial || "" });
        limpiarRecorte();
        limpiarLectura();
      }
      return;
    }
    if (!precarga) return;
    precargadoRef.current = true;
    precargaAbiertaRef.current = precarga;
    const v = valoresDesdeDatosVino(precarga.datos);
    limpiarLectura();
    form.reset({ ...v, categoria: v.categoria || categoriaInicial || "", precio_eur: "", ...COPA_PARKER_VACIO });
    iniciarRecorte(precarga.foto, precarga.recorte);
  }, [open, precarga, form, categoriaInicial, iniciarRecorte, limpiarRecorte, cancelarLectura, limpiarLectura]);

  /** Datos de la etiqueta para el precio sugerido y las tiendas. */
  const datosEtiqueta = precarga?.datos ?? lectura.datos;

  // Si la IA no ha sacado claro el origen, se pide completarlo (no se guarda sin él).
  const [categoriaActual, paisActual, regionActual] = useWatch({
    control: form.control,
    name: ["categoria", "ubicacion_pais", "ubicacion_region"],
  });
  const origenActual = { categoria: categoriaActual, ubicacion_pais: paisActual, ubicacion_region: regionActual };
  const avisoOrigen =
    datosEtiqueta && !origenVinoClaro(origenActual)
      ? `La IA no ha sacado claro el origen de este vino. ${mensajeFaltaOrigen(origenActual)} Complétalo para poder guardarlo.`
      : null;

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => void usarFoto(e.target.files?.[0], e.target);

  /** Foto elegida o pegada («Pegar foto recortada»): si ya viene sin fondo, no se pasa el modelo. */
  const usarFoto = async (elegida: File | undefined, input?: HTMLInputElement | null) => {
    const file = elegida ? await aceptarFotoCarta(elegida, input) : null;
    if (!file) return;
    lectura.cancelar();
    recorte.iniciar(file);
    // Vino nuevo sin nombre: la IA lee la etiqueta a la vez que se recorta.
    // Con precarga (lote) la foto ya se leyó; con nombre escrito, botón manual.
    if (!precarga && !String(form.getValues("nombre") ?? "").trim()) void lectura.leer(file);
  };

  const clearImage = () => {
    lectura.limpiar();
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
      // Solo lo que no es el valor por defecto: ver `cambiosCopaParker`.
      ...cambiosCopaParker(values),
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
    if (camaraInputRef.current) camaraInputRef.current.value = "";
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto" onInteractOutside={noCerrarAlTocarFuera}>
        <DialogHeader>
          <DialogTitle>Añadir Vino</DialogTitle>
          <DialogDescription>
            {datosEtiqueta
              ? "Datos leídos de la etiqueta: revísalos, pon el precio y guarda"
              : "Pon la foto de la etiqueta y la IA rellena la ficha, o escríbela a mano"}
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
              <input
                type="file"
                ref={camaraInputRef}
                onChange={handleImageChange}
                accept="image/*"
                capture="environment"
                className="hidden"
                data-testid="vino-camara"
              />
              <PegarFotoRecortada onFoto={(f) => void usarFoto(f)} />
              
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
                <div className="space-y-2">
                  {/* Móvil: hacer la foto nada más abrir, sin obligar (03/11/2026: un solo «Añadir vino»). */}
                  <Button
                    type="button"
                    className="hidden h-12 w-full pointer-coarse:flex"
                    onClick={() => camaraInputRef.current?.click()}
                  >
                    <Camera className="mr-2 h-5 w-5" />
                    Hacer foto a la etiqueta
                  </Button>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <ImagePlus className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="px-2 text-center text-sm text-muted-foreground">
                      <span className="pointer-coarse:hidden">Toca para añadir la foto de la botella</span>
                      <span className="hidden pointer-coarse:inline">O elige una foto de la galería</span>
                    </p>
                  </div>
                </div>
              )}
              {recorte.original && (
                <div className="flex min-h-9 flex-wrap items-center gap-2" aria-live="polite">
                  {lectura.leyendo ? (
                    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Leyendo la etiqueta…
                    </span>
                  ) : (
                    !precarga && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={() => recorte.original && void lectura.leer(recorte.original)}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Leer etiqueta con IA
                      </Button>
                    )
                  )}
                </div>
              )}
            </div>

            <CamposVino
              control={form.control}
              categorias={categoriasValidas}
              denominaciones={denominaciones}
              regiones={regiones}
              paises={paises}
              bajoPrecio={
                <PistaPrecioVino
                  datos={datosEtiqueta}
                  onUsar={(precio) => form.setValue("precio_eur", precio, { shouldValidate: true, shouldDirty: true })}
                />
              }
              avisoOrigen={avisoOrigen}
            />

            <CamposCopaParker control={form.control} />

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
