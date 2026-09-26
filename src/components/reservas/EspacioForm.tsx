import { useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCrearEspacio,
  useActualizarEspacio,
  useEspaciosReserva,
  type EspacioReserva,
} from "@/hooks/useEspaciosReserva";
import { useMesas, type Mesa } from "@/hooks/useMesas";
import { calcularCuadreEspacio, textoEstadoCuadre } from "@/lib/reservas/aforoMesas";
import {
  NEGOCIOS_PANEL,
  MARCA_POR_DEFECTO,
  marcaDeEspacio,
  etiquetaNegocio,
} from "@/lib/reservas/negocios";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Construye el esquema de validación con el listado de espacios YA
 * EXISTENTES (para el aviso de nombre duplicado dentro del mismo negocio).
 * Se reconstruye cada vez que cambia esa lista — ver `schemaRef` más abajo,
 * que es lo que de verdad lee `zodResolver` en cada validación.
 */
const buildFormSchema = (otrosEspacios: readonly EspacioReserva[]) =>
  z
    .object({
      nombre: z
        .string()
        .trim()
        .min(2, "El nombre debe tener al menos 2 caracteres"),
      descripcion: z.string().optional(),
      capacidad_maxima: z
        .number({ invalid_type_error: "La capacidad debe ser un número" })
        .int("La capacidad debe ser un número entero (sin decimales)")
        .min(1, "La capacidad debe ser al menos 1")
        .max(500, "La capacidad máxima admitida es 500 plazas"),
      activa: z.boolean().default(true),
      marca: z.string().min(1, "Selecciona el negocio al que pertenece este espacio"),
    })
    .superRefine((values, ctx) => {
      const nombreNormalizado = values.nombre.trim().toLowerCase();
      const duplicado = otrosEspacios.some(
        (e) =>
          marcaDeEspacio(e) === values.marca &&
          (e.nombre || "").trim().toLowerCase() === nombreNormalizado,
      );
      if (duplicado) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nombre"],
          message: `Ya existe un espacio llamado "${values.nombre.trim()}" en ${etiquetaNegocio(values.marca)}. Usa otro nombre.`,
        });
      }
    });

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

interface EspacioFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  espacio?: EspacioReserva | null;
  /**
   * Se llama justo después de crear un espacio nuevo (no al editar), con su
   * id y nombre. `Espacios.tsx` la usa para abrir el editor de plano sin que
   * este formulario necesite saber cómo se abre esa pantalla — ver el botón
   * de acción del toast "Configurar plano ahora" más abajo. Si no se pasa,
   * el toast simplemente no ofrece esa acción.
   */
  onEspacioCreado?: (espacio: { id: string; nombre: string }) => void;
}

export const EspacioForm = ({ open, onOpenChange, espacio, onEspacioCreado }: EspacioFormProps) => {
  const crearEspacio = useCrearEspacio();
  const actualizarEspacio = useActualizarEspacio();

  // Lista completa de espacios (todos los negocios) para el aviso de nombre
  // duplicado. Ya está cacheada por Espacios.tsx con la misma queryKey, así
  // que esto no dispara una petición extra en el caso normal.
  const { data: todosEspacios = [] } = useEspaciosReserva() as { data: EspacioReserva[] };
  const otrosEspacios = useMemo(
    () => (todosEspacios as EspacioReserva[]).filter((e) => e.id !== espacio?.id),
    [todosEspacios, espacio?.id],
  );

  // El resolver de react-hook-form se fija una vez al montar `useForm`; como
  // este formulario permanece montado (ver comentario más abajo), lo
  // envolvemos en una función que siempre lee el esquema más reciente desde
  // esta ref, para que el aviso de "nombre duplicado" use la lista de
  // espacios actual sin tener que recrear el formulario.
  const schemaRef = useRef(buildFormSchema(otrosEspacios));
  useEffect(() => {
    schemaRef.current = buildFormSchema(otrosEspacios);
  }, [otrosEspacios]);

  const marcaInicial = espacio ? marcaDeEspacio(espacio) : MARCA_POR_DEFECTO;

  const form = useForm<FormValues>({
    resolver: (values, context, options) => zodResolver(schemaRef.current)(values, context, options),
    defaultValues: {
      nombre: espacio?.nombre || "",
      descripcion: espacio?.descripcion || "",
      capacidad_maxima: espacio?.capacidad_maxima || 10,
      activa: espacio?.activa ?? true,
      marca: marcaInicial,
    },
  });

  const nombreInputRef = useRef<HTMLInputElement | null>(null);

  // `EspacioForm` se queda MONTADO en `Espacios.tsx` (se renderiza siempre, solo
  // cambia `open`), así que los `defaultValues` de arriba se calculan una única
  // vez: sin este reset, abrir "Editar Salón" después de haber abierto otro
  // espacio (o el alta) mostraba los datos de la vez anterior y se guardaban
  // encima del espacio equivocado.
  useEffect(() => {
    if (!open) return;
    form.reset({
      nombre: espacio?.nombre || "",
      descripcion: espacio?.descripcion || "",
      capacidad_maxima: espacio?.capacidad_maxima || 10,
      activa: espacio?.activa ?? true,
      marca: espacio ? marcaDeEspacio(espacio) : MARCA_POR_DEFECTO,
    });
    // Foco inicial en "Nombre del espacio" al abrir el modal (alta o edición).
    // Un pequeño retraso evita pelear con el foco que pone Radix Dialog.
    const id = window.setTimeout(() => nombreInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open, espacio, form]);

  // Plazas que suman las mesas de este espacio, para avisar si no cuadran con la
  // capacidad que se está escribiendo. Solo se consulta al EDITAR: un espacio que
  // aún no existe no tiene mesas.
  const { data: mesas = [] } = useMesas(espacio?.id, {
    incluirInactivas: true,
    habilitado: !!espacio?.id,
  });
  const capacidadEscrita = form.watch("capacidad_maxima");
  const marcaEscrita = form.watch("marca");
  const cuadre = useMemo(() => {
    if (!espacio) return null;
    // Se compara contra el valor del formulario (no el guardado) para que el
    // aviso reaccione mientras se teclea.
    return calcularCuadreEspacio(
      {
        ...espacio,
        capacidad_maxima: Number.isFinite(Number(capacidadEscrita)) ? Number(capacidadEscrita) : 0,
      },
      mesas,
    );
  }, [espacio, capacidadEscrita, mesas]);

  // Cambiar el negocio de un espacio YA existente es delicado: el aforo por
  // turno de cada negocio se calcula en vivo sumando la capacidad declarada
  // de los espacios que en ESE MOMENTO tienen esa marca (trigger
  // `validar_capacidad_reserva`, migración `20260922190000_aforo_por_marca`).
  // Mover un espacio de negocio no toca las reservas ya hechas en él
  // (`reservas.marca` es una columna propia, independiente) pero sí cambia,
  // desde ese instante, el aforo total de AMBOS negocios — el nuevo suma esta
  // capacidad y el anterior la pierde. Por eso avisamos pero NO bloqueamos el
  // guardado: bloquear impediría corregir un espacio mal etiquetado (p.ej. el
  // backfill de la migración `20260922180000` se equivoca), y quien lo hace
  // desde Super Admin es quien decide el aforo. El aviso es más urgente si el
  // espacio ya tiene mesas/plano configurado.
  const cambiaDeNegocio = !!espacio && marcaEscrita !== marcaInicial;
  const mesasActivasCount = (mesas as Mesa[]).filter((m) => m.activa !== false).length;

  const onSubmit = async (values: FormValues) => {
    const caracteristicasBase = (espacio?.caracteristicas as Record<string, unknown> | null) ?? {};
    const caracteristicas = { ...caracteristicasBase, marca: values.marca };
    try {
      if (espacio) {
        await actualizarEspacio.mutateAsync({
          id: espacio.id,
          nombre: values.nombre.trim(),
          descripcion: values.descripcion?.trim() || null,
          capacidad_maxima: values.capacidad_maxima,
          activa: values.activa,
          caracteristicas,
        });
      } else {
        const nuevo = (await crearEspacio.mutateAsync({
          nombre: values.nombre.trim(),
          descripcion: values.descripcion?.trim() || null,
          capacidad_maxima: values.capacidad_maxima,
          activa: values.activa,
          caracteristicas,
        })) as unknown as { id: string; nombre: string } | null | undefined;
        // Acción rápida: ofrecer ir directamente al editor de plano del
        // espacio recién creado, sin obligar a buscarlo en la lista.
        if (nuevo?.id && onEspacioCreado) {
          const espacioCreado = { id: nuevo.id, nombre: nuevo.nombre ?? values.nombre.trim() };
          toast("Espacio creado", {
            description: `"${espacioCreado.nombre}" ya está disponible. ¿Configuras su plano y sus mesas ahora?`,
            action: {
              label: "Configurar plano ahora",
              onClick: () => onEspacioCreado(espacioCreado),
            },
          });
        }
      }
      form.reset();
      onOpenChange(false);
    } catch (error) {
      // Los errores ya se manejan en los hooks
    }
  };

  const guardando = crearEspacio.isPending || actualizarEspacio.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {espacio ? "Editar espacio" : "Crear nuevo espacio"}
          </DialogTitle>
          <DialogDescription>
            Configura los espacios disponibles para reservas
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            aria-busy={guardando}
            // El input de capacidad lleva `min`/`max` para el spinner nativo, pero
            // dejamos que zod (mensajes en español, coherentes con el resto del
            // formulario) sea el único que decide si bloquea el envío: sin esto,
            // el navegador (y jsdom) intercepta el submit ANTES de que corra el
            // resolver de react-hook-form y muestra su propio globo de validación
            // en vez de nuestro `FormMessage`.
            noValidate
          >
            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre del espacio</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej: Terraza, Sala Principal"
                      disabled={guardando}
                      {...field}
                      ref={(el) => {
                        field.ref(el);
                        nombreInputRef.current = el;
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="marca"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Negocio</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={guardando}
                  >
                    <FormControl>
                      <SelectTrigger aria-label="Negocio">
                        <SelectValue placeholder="Selecciona un negocio" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {NEGOCIOS_PANEL.map((n) => (
                        <SelectItem key={n.marca} value={n.marca}>
                          {n.etiqueta}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Negocio al que pertenece este espacio. Decide en qué aforo por turno se cuenta su capacidad
                    (Casa Tomás y Touza tienen aforos independientes: nunca se suman entre sí).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {cambiaDeNegocio && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Vas a mover <strong>{espacio?.nombre}</strong> de {etiquetaNegocio(marcaInicial)} a{" "}
                  {etiquetaNegocio(marcaEscrita)}.{" "}
                  {mesasActivasCount > 0
                    ? `Este espacio tiene ${mesasActivasCount} mesa${mesasActivasCount === 1 ? "" : "s"} activa${mesasActivasCount === 1 ? "" : "s"} configurada${mesasActivasCount === 1 ? "" : "s"}. `
                    : ""}
                  Las reservas ya hechas en este espacio conservan su negocio original, pero desde que guardes su
                  capacidad pasará a contar en el aforo por turno de {etiquetaNegocio(marcaEscrita)} y dejará de
                  contar en el de {etiquetaNegocio(marcaInicial)}. Puedes guardar igualmente si es lo que quieres.
                </span>
              </div>
            )}

            <FormField
              control={form.control}
              name="descripcion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe las características del espacio"
                      disabled={guardando}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="capacidad_maxima"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Capacidad máxima</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      max="500"
                      disabled={guardando}
                      {...field}
                      onChange={(e) => {
                        // Vaciar el campo daba `NaN`, y con `NaN` el resolver de
                        // zod fallaba con "expected number" en vez del mensaje
                        // de capacidad mínima.
                        const n = parseInt(e.target.value, 10);
                        field.onChange(Number.isNaN(n) ? 0 : n);
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    Aforo declarado de este espacio: las plazas que se ofrecen a los clientes por turno. Es la cifra
                    que usa el aforo del negocio (no se calcula automáticamente a partir de las mesas del plano).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Capacidad declarada frente a las plazas de las mesas. Es un AVISO:
                no bloquea el guardado. Hoy el aforo lo decide la capacidad
                declarada (trigger `trg_validar_capacidad`, sin tocar); la regla
                de "que mande la suma de las mesas" está cableada y dormida en
                `supabase/migrations/20260926120000_capacidad_efectiva_mesas.sql`.
                Las mesas se dan de alta en Reservas › Configuración. */}
            {cuadre && (
              <div
                role="status"
                className={
                  cuadre.descuadra
                    ? "flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                    : "flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                }
              >
                {cuadre.descuadra ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span>
                  {cuadre.mesasActivas === 1 ? "1 mesa activa suma" : `${cuadre.mesasActivas} mesas activas suman`}{" "}
                  <strong>{cuadre.plazasMesas}</strong> plazas.{" "}
                  {cuadre.descuadra
                    ? `${textoEstadoCuadre(cuadre)}. Puedes guardar igualmente.`
                    : "Cuadra con la capacidad declarada."}
                </span>
              </div>
            )}

            <FormField
              control={form.control}
              name="activa"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <FormLabel>Espacio activo</FormLabel>
                    <FormDescription>
                      Si está activo, se ofrece a los clientes para reservar por teléfono o por la web. Si lo
                      desactivas, deja de ofrecerse para reservas nuevas pero conserva sus mesas, su plano y su
                      histórico.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={guardando}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={guardando}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando} aria-busy={guardando}>
                {guardando ? "Guardando..." : `${espacio ? "Actualizar" : "Crear"} espacio`}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
