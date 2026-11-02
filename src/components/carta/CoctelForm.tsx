import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { LIMITES_CARTA, errorAlergenoPersonalizado, textoObligatorio, textoOpcional } from "@/lib/limites-carta";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ComboboxCreatable } from "@/components/ui/combobox-creatable";
import { useCocteles } from "@/hooks/useCocteles";
import { useFotoCarta } from "./recorte/useRecorteVino";
import { SelectorFotoCarta } from "./recorte/SelectorFotoCarta";
import { noCerrarAlTocarFuera } from "./dialogoCarta";
import { subirFotoCarta } from "./subirFotoCarta";
import { toast } from "sonner";
import { Loader2, Upload, X, Plus } from "lucide-react";
import {
  ALERGENOS_OFICIALES,
  combinarAlergenos,
  normalizarAlergeno,
} from "@/lib/alergenos";
import { aceptarFoto } from "@/lib/aceptarFoto";
import { ACCEPT_FOTO, mensajeErrorStorage } from "@/lib/validarFoto";

const formSchema = z.object({
  nombre: textoObligatorio(LIMITES_CARTA.nombre, "El nombre es obligatorio"),
  categoria: textoObligatorio(LIMITES_CARTA.categoria, "La categoría es obligatoria"),
  precio_eur: z.coerce.number().min(0, "El precio debe ser positivo"),
  descripcion: textoOpcional(LIMITES_CARTA.descripcion),
  ingredientes: textoOpcional(LIMITES_CARTA.ingredientes),
  preparacion: textoOpcional(LIMITES_CARTA.preparacion),
  alergenos_notas: textoOpcional(LIMITES_CARTA.alergenosNotas),
});

interface CoctelFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaInicial?: string;
}

export function CoctelForm({ open, onOpenChange, categoriaInicial }: CoctelFormProps) {
  const { crearCoctel, actualizarCoctel, categorias } = useCocteles();
  // Foto: recorte automático → sticker → foto con el fondo elegido.
  const fotoCarta = useFotoCarta("bebida");
  const { limpiar: limpiarFoto } = fotoCarta;
  const imageFile = fotoCarta.original;
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Estado para alérgenos (mismo patrón que PlatoForm.tsx / VinoForm.tsx).
  // Antes este formulario no tenía ninguna casilla de alérgenos oficiales: los
  // 12 cócteles existentes declaraban "no consta", incumpliendo el Reglamento
  // UE 1169/2011.
  const [alergenosSeleccionados, setAlergenosSeleccionados] = useState<string[]>([]);
  const [alergenosPersonalizados, setAlergenosPersonalizados] = useState<string[]>([]);
  const [nuevoAlergeno, setNuevoAlergeno] = useState("");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      categoria: categoriaInicial || "",
      precio_eur: 0,
      descripcion: "",
      ingredientes: "",
      preparacion: "",
      alergenos_notas: "",
    },
  });

  useEffect(() => {
    if (categoriaInicial) {
      form.setValue("categoria", categoriaInicial);
    }
  }, [categoriaInicial, form]);

  const toggleAlergeno = (id: string) => {
    setAlergenosSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
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

    // Si lo escrito a mano es en realidad un alérgeno oficial (con o sin
    // acentos, singular o plural), se marca su casilla en vez de crear una
    // entrada suelta que acabaría duplicada en la web.
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
    setAlergenosPersonalizados((prev) => prev.filter((a) => a !== alergeno));
  };

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
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const todosAlergenos = combinarAlergenos(alergenosSeleccionados, alergenosPersonalizados);

      // Alérgenos van directos en el alta: crearCoctel (useCocteles.ts) ya
      // los acepta y normaliza en el propio INSERT, igual que
      // crearPlato/crearVino. Antes hacía falta un segundo actualizarCoctel
      // solo para esto, con una ventana en la que un fallo ahí dejaba el
      // cóctel guardado sin alérgenos declarados (obligatorios por el
      // Reglamento UE 1169/2011) aunque el usuario creyera que sí.
      const nuevoCoctel = await crearCoctel.mutateAsync({
        nombre: values.nombre.trim(),
        categoria: values.categoria.trim(),
        precio_eur: values.precio_eur,
        descripcion: values.descripcion,
        ingredientes: values.ingredientes,
        preparacion: values.preparacion,
        alergenos_oficiales: todosAlergenos.length > 0 ? todosAlergenos : undefined,
        alergenos_notas: values.alergenos_notas?.trim() || undefined,
      });

      // Si hay imagen, subirla después de crear el cóctel (hace falta el id).
      // Antes se subía al bucket y NUNCA se escribía `imagen_url`: la foto
      // quedaba huérfana en storage y el cóctel salía sin imagen en la web.
      if (imageFile && nuevoCoctel?.id) {
        setIsUploading(true);
        try {
          // Original intacto + foto de carta `-carta-<ext>.webp` (subirFotoCarta.ts).
          const subida = await subirFotoCarta("cocteles", nuevoCoctel.id, {
            original: imageFile,
            compuesta: fotoCarta.usaCarta ? fotoCarta.compuesta : null,
          });

          // Vía el hook, para que invalide la caché y republique las webs.
          await actualizarCoctel.mutateAsync({
            id: nuevoCoctel.id,
            imagen_url: subida.url,
          });
        } catch (uploadError) {
          console.error('Error subiendo imagen:', uploadError);
          toast.error("Cóctel creado, pero la foto no se ha podido subir. Súbela con el botón «Foto» de su tarjeta.", { description: mensajeErrorStorage(uploadError) ?? undefined });
        } finally {
          setIsUploading(false);
        }
      }

      form.reset();
      setAlergenosSeleccionados([]);
      setAlergenosPersonalizados([]);
      setNuevoAlergeno("");
      clearImage();
      onOpenChange(false);
    } catch (error) {
      console.error('Error creando cóctel:', error);
    }
  };

  const categoriasOptions = categorias.filter((cat): cat is string => cat !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto" onInteractOutside={noCerrarAlTocarFuera}>
        <DialogHeader>
          <DialogTitle>Nuevo Cóctel</DialogTitle>
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

            {/* Imagen */}
            <div className="space-y-2">
              <FormLabel>Imagen</FormLabel>
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
                <div className="relative w-32 h-32">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="w-full h-full object-cover rounded-md"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-1 right-1 h-11 w-11"
                    onClick={clearImage}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-32 h-32 border-2 border-dashed border-muted-foreground/25 rounded-md cursor-pointer hover:border-primary/50 transition-colors">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground mt-1">Subir imagen</span>
                  <input
                    type="file"
                    accept={ACCEPT_FOTO}
                    className="hidden"
                    onChange={handleImageChange}
                  />
                </label>
              )}
            </div>

            {/* Selector de Alérgenos (ver src/lib/alergenos.ts) */}
            <div className="space-y-3">
              <FormLabel>Alérgenos</FormLabel>

              {/* Grid de alérgenos oficiales */}
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
                  className="h-11 w-11 shrink-0"
                  aria-label="Añadir alérgeno"
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

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" className="h-11 px-5" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={crearCoctel.isPending || isUploading || fotoCarta.trabajando}
              >
                {(crearCoctel.isPending || isUploading) && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Guardar Cóctel
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
