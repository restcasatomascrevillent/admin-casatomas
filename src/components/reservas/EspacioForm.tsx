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
  useCrearEspacio,
  useActualizarEspacio,
  useEspaciosReserva,
  type EspacioReserva,
} from "@/hooks/useEspaciosReserva";
import { useMesas } from "@/hooks/useMesas";
import { calcularCuadreEspacio, textoEstadoCuadre } from "@/lib/reservas/aforoMesas";
import { MARCA_POR_DEFECTO, marcaDeEspacio } from "@/lib/reservas/negocios";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Construye el esquema de validación con el listado de espacios YA
 * EXISTENTES (para el aviso de nombre duplicado). Se reconstruye cada vez que
 * cambia esa lista — ver `schemaRef` más abajo, que es lo que de verdad lee
 * `zodResolver` en cada validación.
 *
 * Solo Casa Tomás admite reservas (decisión del dueño, 2026-10-01): no hay
 * selector de negocio. Un espacio NUEVO es de Casa Tomás; uno que se EDITA
 * conserva su negocio (`marca`, ver `onSubmit`). El nombre tiene que ser único
 * entre los espacios de ese mismo negocio: para Casa Tomás, las salas de Touza
 * que queden en la base de datos no cuentan (hay dos «Terraza»).
 */
const buildFormSchema = (otrosEspacios: readonly EspacioReserva[], marca: string) =>
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
    })
    .superRefine((values, ctx) => {
      const nombreNormalizado = values.nombre.trim().toLowerCase();
      const duplicado = otrosEspacios.some(
        (e) => marcaDeEspacio(e) === marca && (e.nombre || "").trim().toLowerCase() === nombreNormalizado,
      );
      if (duplicado) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nombre"],
          message: `Ya existe un espacio llamado "${values.nombre.trim()}". Usa otro nombre.`,
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

  // Negocio con el que se guarda: el de Casa Tomás si es nuevo; el que ya tiene
  // si se edita. Las pantallas solo dejan abrir aquí salas de Casa Tomás, pero si
  // llegara otra, guardarla NO la cambia de negocio: el trigger
  // `validar_capacidad_reserva` suma el aforo por marca y sus plazas pasarían a
  // contar en el de Casa Tomás.
  const marcaEspacio = espacio ? marcaDeEspacio(espacio) : MARCA_POR_DEFECTO;

  // Lista completa de espacios para el aviso de nombre duplicado (el esquema
  // solo mira los del mismo negocio). Ya está cacheada por Espacios.tsx con la
  // misma queryKey, así que esto no dispara una petición extra en el caso normal.
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
  const schemaRef = useRef(buildFormSchema(otrosEspacios, marcaEspacio));
  useEffect(() => {
    schemaRef.current = buildFormSchema(otrosEspacios, marcaEspacio);
  }, [otrosEspacios, marcaEspacio]);

  const form = useForm<FormValues>({
    resolver: (values, context, options) => zodResolver(schemaRef.current)(values, context, options),
    defaultValues: {
      nombre: espacio?.nombre || "",
      descripcion: espacio?.descripcion || "",
      capacidad_maxima: espacio?.capacidad_maxima || 10,
      activa: espacio?.activa ?? true,
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

  const onSubmit = async (values: FormValues) => {
    // El negocio del espacio se sigue ESCRIBIENDO (`caracteristicas.marca`): el
    // trigger `validar_capacidad_reserva` suma el aforo por marca. Un espacio
    // nuevo es de Casa Tomás, el único negocio que admite reservas; uno que se
    // edita conserva el suyo (`marcaEspacio`, ver arriba). El resto de
    // `caracteristicas` se conserva tal cual.
    const caracteristicasBase = (espacio?.caracteristicas as Record<string, unknown> | null) ?? {};
    const caracteristicas = { ...caracteristicasBase, marca: marcaEspacio };
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
                      type="number" inputMode="numeric"
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
                    que usa el aforo del restaurante (no se calcula automáticamente a partir de las mesas del plano).
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
                {/* Se cuentan las mesas REALES (`mesasReales`), no todas las
                    filas activas: las uniones del editor de plano
                    (`is_merged = true`) no aportan aforo porque sus originales
                    pueden seguir vivas en la tabla, así que se nombran aparte.
                    Tiene que decir el MISMO número que la tarjeta "Mesas y aforo
                    por espacio" de Reservas › Configuración — ver la cabecera de
                    `src/lib/reservas/aforoMesas.ts`. */}
                <span>
                  {cuadre.mesasReales === 1 ? "1 mesa activa suma" : `${cuadre.mesasReales} mesas activas suman`}{" "}
                  <strong>{cuadre.plazasMesas}</strong> plazas
                  {cuadre.mesasFusionadas > 0
                    ? `, más ${
                        cuadre.mesasFusionadas === 1 ? "1 mesa juntada" : `${cuadre.mesasFusionadas} mesas juntadas`
                      } con ${cuadre.plazasFusionadas} plazas que no cuentan para el aforo`
                    : ""}
                  .{" "}
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
