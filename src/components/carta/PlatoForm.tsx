import { AptoParaPlato } from "./AptoParaPlato";
import { aptitudesManualesDisponibles, cambioVegetariano } from "@/lib/dietas-plato";
import { guardarUnidadPlato, opcionesUnidadPlato } from "@/lib/unidades-platos";
import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { nombreCarta, categoriaCarta, descripcionCarta, MAX_PRECIO_CARTA, mensajePrecioMaximo } from "@/lib/limites-carta";
import { Camera, X, Plus } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { Badge } from "@/components/ui/badge";
import { usePlatos, NuevoPlato } from "@/hooks/usePlatos";
import { useFotoCarta } from "./recorte/useRecorteVino";
import { aceptarFotoCarta } from "./recorte/fotoYaRecortada";
import { PegarFotoRecortada } from "./recorte/PegarFotoRecortada";
import { SelectorFotoCarta } from "./recorte/SelectorFotoCarta";
import { trasGuardarFotoCarta } from "./recorte/avisoGuardadoSinFondo";
import { noCerrarAlTocarFuera } from "./dialogoCarta";
import { subirFotoCarta } from "./subirFotoCarta";
import { useVideoPlato } from "./video/useVideoPlato";
import { SeccionVideoPlato } from "./video/SeccionVideoPlato";
import { ErrorMigracionVideo } from "./video/subirVideoPlato";
import { columnaVideoDisponible } from "./video/videoPlato";
import { toast } from "sonner";
import {
  ALERGENOS_OFICIALES,
  SIN_ALERGENOS_DECLARADOS,
  esSinAlergenosDeclarados,
  combinarAlergenos,
  normalizarAlergeno,
} from "@/lib/alergenos";
import { ACCEPT_FOTO, mensajeErrorStorage } from "@/lib/validarFoto";

const formSchema = z
  .object({
    nombre: nombreCarta,
    categoria: categoriaCarta,
    precio_eur: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.coerce
        .number({ invalid_type_error: "Indica un precio válido" })
        .finite("Indica un precio válido")
        .min(0, "El precio debe ser mayor o igual a 0")
        .max(MAX_PRECIO_CARTA, mensajePrecioMaximo),
    ),
    descripcion: descripcionCarta,
    sin_gluten_disponible: z.boolean().default(false),
    vegetariano: z.boolean().default(false),
    // «Apto para celíacos» / «Apto sin lactosa» a mano; null = según alérgenos (20261122093000).
    apto_celiacos: z.boolean().nullable().default(null),
    apto_sin_lactosa: z.boolean().nullable().default(null),
    ingredientes: z.string().optional(),
    unidad: z.string().default("Unidad"),
    gramos: z.coerce.number().optional(),
  })
  .superRefine((values, ctx) => {
    if (
      values.unidad === "gramos" &&
      (!Number.isInteger(values.gramos) || !values.gramos || values.gramos <= 0)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gramos"],
        message: "Indica una cantidad de gramos entera y mayor que cero",
      });
  });

interface PlatoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaInicial?: string;
}

export function PlatoForm({
  open,
  onOpenChange,
  categoriaInicial,
}: PlatoFormProps) {
  const { platos, crearPlato, actualizarPlato, categorias, unidades, refrescarPlatos } = usePlatos();
  // Vídeo del plato (opcional): se sube aparte, después de crear el plato.
  const videoPlato = useVideoPlato();
  const { limpiar: limpiarVideo } = videoPlato;
  // Al cerrar el formulario se cancela el vídeo en curso y se descarta el no guardado.
  useEffect(() => {
    if (!open) limpiarVideo();
  }, [open, limpiarVideo]);
  // Foto: recorte automático → sticker → foto con el fondo elegido.
  const fotoCarta = useFotoCarta("plato");
  const imageFile = fotoCarta.original;
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estado para alérgenos
  const [alergenosSeleccionados, setAlergenosSeleccionados] = useState<
    string[]
  >([]);
  const [alergenosPersonalizados, setAlergenosPersonalizados] = useState<
    string[]
  >([]);
  const [nuevoAlergeno, setNuevoAlergeno] = useState("");
  const [sinAlergenos, setSinAlergenos] = useState(false);
  const [errorAlergenos, setErrorAlergenos] = useState(false);
  // Columnas de «Apto para» a mano: se ven en los platos ya cargados (sin carta cargada, se asume que sí).
  const aptitudesManuales = !platos?.length || aptitudesManualesDisponibles(platos[0]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: categoriaInicial || "",
      precio_eur: 0,
      descripcion: "",
      sin_gluten_disponible: false,
      vegetariano: false,
      apto_celiacos: null,
      apto_sin_lactosa: null,
      ingredientes: "",
      unidad: "Unidad",
      gramos: 100,
    },
  });

  const toggleAlergeno = (id: string) => {
    setSinAlergenos(false);
    setErrorAlergenos(false);
    setAlergenosSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id],
    );
  };

  const addAlergenoPersonalizado = () => {
    const trimmed = nuevoAlergeno.trim();
    if (!trimmed) return;
    setSinAlergenos(false);
    setErrorAlergenos(false);

    // Si lo escrito a mano es en realidad un alérgeno oficial (escrito con o
    // sin acentos, en singular o plural), se marca su casilla en vez de crear
    // una entrada suelta: así no se guardan dos veces lo mismo.
    const canonico = normalizarAlergeno(trimmed);
    if (canonico) {
      setAlergenosSeleccionados((prev) =>
        prev.includes(canonico) ? prev : [...prev, canonico],
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
    setAlergenosPersonalizados((prev) => prev.filter((a) => a !== alergeno));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => void usarFoto(e.target.files?.[0], e.target);

  /** Foto elegida o pegada («Pegar foto recortada»): si ya viene sin fondo, no se pasa el modelo. */
  const usarFoto = async (elegida: File | undefined, input?: HTMLInputElement | null) => {
    const file = elegida ? await aceptarFotoCarta(elegida, input) : null;
    if (file) fotoCarta.iniciar(file);
  };

  const clearImage = () => {
    fotoCarta.limpiar();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (
      !sinAlergenos &&
      !alergenosSeleccionados.length &&
      !alergenosPersonalizados.length
    ) {
      setErrorAlergenos(true);
      return;
    }
    setIsUploading(true);
    try {
      // Combinar oficiales + personalizados en vocabulario canónico y sin
      // duplicados (ver src/lib/alergenos.ts).
      const todosAlergenos = sinAlergenos
        ? [SIN_ALERGENOS_DECLARADOS]
        : combinarAlergenos(alergenosSeleccionados, alergenosPersonalizados);

      // 1. Crear el plato primero
      const platoData: NuevoPlato = {
        nombre: values.nombre,
        categoria: values.categoria,
        precio_eur: values.precio_eur,
        descripcion: values.descripcion,
        // «Se puede hacer para celíacos»: interruptor siempre editable (10/11/2026).
        sin_gluten_disponible: values.sin_gluten_disponible,
        // Solo si se marca (ver `cambioVegetariano`).
        ...cambioVegetariano(null, values.vegetariano),
        // Solo si se decide a mano (null = según alérgenos): sin la migración el alta sigue funcionando.
        ...(aptitudesManuales && values.apto_celiacos !== null ? { apto_celiacos: values.apto_celiacos } : {}),
        ...(aptitudesManuales && values.apto_sin_lactosa !== null ? { apto_sin_lactosa: values.apto_sin_lactosa } : {}),
        ingredientes: values.ingredientes,
        unidad: guardarUnidadPlato(values.unidad, values.gramos),
        alergenos_oficiales: todosAlergenos.length > 0 ? todosAlergenos : null,
      };
      // La traducción ya no se genera aquí: crearPlato (usePlatos.ts) llama a
      // traducir-contenido internamente al guardar (ver informe, TAREA 2).
      const nuevoPlato = await crearPlato.mutateAsync(platoData);

      // 2. Si hay imagen, subirla a Storage
      if (imageFile && nuevoPlato?.id) {
        try {
          // Original intacto + foto de carta `-carta-<ext>.webp` (subirFotoCarta.ts).
          const { url } = await subirFotoCarta("platos", nuevoPlato.id, {
            original: imageFile,
            compuesta: fotoCarta.usaCarta ? fotoCarta.compuesta : null,
          });
          // Se pasa por la mutación del hook (antes era un UPDATE directo a
          // Supabase): así se invalida la caché y, sobre todo, se dispara la
          // republicación de las webs — sin esto la foto no llegaba nunca.
          await actualizarPlato.mutateAsync({ id: nuevoPlato.id, imagen_url: url });
          trasGuardarFotoCarta(fotoCarta, { tabla: "Platos", id: nuevoPlato.id, nombre: nuevoPlato.nombre });
        } catch (uploadError) {
          console.error("Error uploading image:", uploadError);
          toast.error("Plato creado, pero la foto no se ha podido subir. Súbela con el botón «Foto» de su tarjeta.", { description: mensajeErrorStorage(uploadError) ?? undefined });
        }
      }

      if (nuevoPlato?.id) {
        try {
          if (await videoPlato.guardar(nuevoPlato.id, null, nuevoPlato.nombre)) refrescarPlatos?.();
        } catch (errorVideo) {
          console.error("Error guardando el vídeo del plato:", errorVideo);
          toast.error(
            errorVideo instanceof ErrorMigracionVideo
              ? errorVideo.message
              : "Plato creado, pero no se pudo guardar el vídeo",
          );
        }
      }
      videoPlato.limpiar();

      form.reset();
      clearImage();
      setAlergenosSeleccionados([]);
      setAlergenosPersonalizados([]);
      setSinAlergenos(false);
      setErrorAlergenos(false);
      onOpenChange(false);
    } catch (error) {
      console.error("Error creating plato:", error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto" onInteractOutside={noCerrarAlTocarFuera}>
        <DialogHeader>
          <DialogTitle>Añadir Plato</DialogTitle>
          <DialogDescription>
            Nombre, categoría, precio y declaración de alérgenos son
            obligatorios.
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
                    <Input placeholder="Nombre del plato" {...field} />
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
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Selecciona una categoría" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-popover z-50">
                      {categorias.map((cat) => (
                        <SelectItem key={cat} value={cat as string}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="precio_eur"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio (€)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                      />
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
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Selecciona una unidad" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-popover z-50">
                        {opcionesUnidadPlato(unidades).map((unidad) => (
                          <SelectItem key={unidad} value={unidad as string}>
                            {unidad === "gramos" ? "Gramos" : unidad}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {form.watch("unidad") === "gramos" && (
              <FormField
                control={form.control}
                name="gramos"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cantidad de gramos</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        placeholder="Ej.: 150"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-sm text-muted-foreground">
                      El precio indicado corresponde a esta cantidad de gramos.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Selector de Alérgenos */}
            <div
              className="space-y-3"
              role="group"
              aria-label="Alérgenos (obligatorio)"
            >
              <p className="font-medium">
                Alérgenos{" "}
                <span className="text-destructive">(obligatorio)</span>
              </p>
              <Button
                type="button"
                variant={sinAlergenos ? "default" : "outline"}
                className="h-11"
                aria-pressed={sinAlergenos}
                onClick={() => {
                  setSinAlergenos((v) => !v);
                  setAlergenosSeleccionados([]);
                  setAlergenosPersonalizados([]);
                  setErrorAlergenos(false);
                }}
              >
                Sin alérgenos declarados
              </Button>
              {errorAlergenos && (
                <p
                  role="alert"
                  className="text-sm font-medium text-destructive"
                >
                  Selecciona los alérgenos o confirma que no hay alérgenos
                  declarados.
                </p>
              )}

              {/* Grid de alérgenos oficiales */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ALERGENOS_OFICIALES.map((alergeno) => {
                  const isSelected = alergenosSeleccionados.includes(
                    alergeno.id,
                  );
                  return (
                    <button
                      key={alergeno.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggleAlergeno(alergeno.id)}
                      className={`
                        flex items-center gap-1.5 min-h-11 px-3 py-1.5 rounded-md text-sm font-medium
                        transition-all duration-200 border
                        ${
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
                        }
                      `}
                    >
                      <span className="truncate">{alergeno.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Añadir alérgeno personalizado */}
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
                  size="icon"
                  onClick={addAlergenoPersonalizado}
                  disabled={!nuevoAlergeno.trim()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* Lista de alérgenos personalizados */}
              {alergenosPersonalizados.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {alergenosPersonalizados.map((alergeno) => (
                    <Badge
                      key={alergeno}
                      variant="secondary"
                      className="gap-0 py-0 pl-3 pr-0 text-sm"
                    >
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

            {/* «Apto para» (04/11/2026, dueño): celíacos, vegetarianos y sin lactosa, con su motivo y los
                interruptores editables (10/11/2026). Mismas reglas que los filtros de la web. */}
            <AptoParaPlato
              control={form.control}
              setValue={form.setValue}
              aptitudesManuales={aptitudesManuales}
              alergenos={sinAlergenos ? [SIN_ALERGENOS_DECLARADOS] : combinarAlergenos(alergenosSeleccionados, alergenosPersonalizados)}
            />

            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer font-medium">
                Información adicional (opcional)
              </summary>
              <div className="space-y-4 pt-4">
                <FormField
                  control={form.control}
                  name="descripcion"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descripción</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Descripción del plato"
                          className="resize-none"
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
                          placeholder="Ingredientes del plato"
                          className="resize-none"
                          rows={2}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-2">
                  <FormLabel>Imagen del Plato</FormLabel>
                  <div className="flex flex-col gap-3">
                    {fotoCarta.original ? (
                      <SelectorFotoCarta
                        recorte={fotoCarta}
                        alt="Foto del plato"
                        superpuesto={
                        <button
                          type="button"
                          onClick={clearImage}
                          aria-label="Quitar la imagen"
                          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          <X className="h-4 w-4" />
                        </button>
                        }
                      />
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

                <SeccionVideoPlato
                  video={videoPlato}
                  columnaDisponible={columnaVideoDisponible(platos)}
                  temaFoto={fotoCarta.tema}
                />
              </div>
            </details>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 px-5"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-11 px-5"
                disabled={crearPlato.isPending || isUploading || fotoCarta.trabajando}
              >
                {crearPlato.isPending || isUploading
                  ? "Guardando..."
                  : "Guardar Plato"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
