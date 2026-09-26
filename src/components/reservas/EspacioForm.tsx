import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { useCrearEspacio, useActualizarEspacio, type EspacioReserva } from "@/hooks/useEspaciosReserva";
import { useMesas } from "@/hooks/useMesas";
import { calcularCuadreEspacio, textoEstadoCuadre } from "@/lib/reservas/aforoMesas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const formSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  descripcion: z.string().optional(),
  capacidad_maxima: z.number().min(1, "La capacidad debe ser al menos 1"),
  activa: z.boolean().default(true),
});

type FormValues = z.infer<typeof formSchema>;

interface EspacioFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  espacio?: EspacioReserva | null;
}

export const EspacioForm = ({ open, onOpenChange, espacio }: EspacioFormProps) => {
  const crearEspacio = useCrearEspacio();
  const actualizarEspacio = useActualizarEspacio();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: espacio?.nombre || "",
      descripcion: espacio?.descripcion || "",
      capacidad_maxima: espacio?.capacidad_maxima || 10,
      activa: espacio?.activa ?? true,
    },
  });

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
    try {
      if (espacio) {
        await actualizarEspacio.mutateAsync({
          id: espacio.id,
          ...values,
        });
      } else {
        await crearEspacio.mutateAsync({
          nombre: values.nombre,
          descripcion: values.descripcion || null,
          capacidad_maxima: values.capacidad_maxima,
          activa: values.activa,
          caracteristicas: {},
        });
      }
      form.reset();
      onOpenChange(false);
    } catch (error) {
      // Los errores ya se manejan en los hooks
    }
  };

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
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre del espacio</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Terraza, Sala Principal" {...field} />
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
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
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
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={crearEspacio.isPending || actualizarEspacio.isPending}>
                {espacio ? "Actualizar" : "Crear"} espacio
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};