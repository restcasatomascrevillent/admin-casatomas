import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
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
  numero_mesas: z.number().min(1, "Debe haber al menos 1 mesa"),
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
      numero_mesas: espacio?.numero_mesas || 5,
      activa: espacio?.activa ?? true,
    },
  });

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
          numero_mesas: values.numero_mesas,
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

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="numero_mesas"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número de mesas</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value))}
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
                        onChange={(e) => field.onChange(parseInt(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="activa"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between">
                  <FormLabel>Espacio activo</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit">
                {espacio ? "Actualizar" : "Crear"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
