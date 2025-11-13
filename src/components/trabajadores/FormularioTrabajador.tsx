import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCrearTrabajador, useActualizarTrabajador, useTrabajadores } from "@/hooks/useTrabajadores";

const formSchema = z.object({
  nombre: z.string().min(2, "El nombre es requerido"),
  apellidos: z.string().min(2, "Los apellidos son requeridos"),
  telefono: z.string().min(9, "Teléfono inválido"),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  puesto: z.string().min(1, "Selecciona un puesto"),
  fecha_contratacion: z.string(),
  salario_hora: z.number().min(0).optional(),
  notas: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface FormularioTrabajadorProps {
  trabajadorId?: string | null;
  onSuccess?: () => void;
}

const PUESTOS = [
  { value: "gerente", label: "Gerente" },
  { value: "camarero", label: "Camarero" },
  { value: "ayudante_camarero", label: "Ayudante de Camarero" },
  { value: "cocinero", label: "Cocinero" },
  { value: "ayudante_cocina", label: "Ayudante de Cocina" },
  { value: "recepcionista", label: "Recepcionista" },
  { value: "limpieza", label: "Limpieza" },
];

export const FormularioTrabajador = ({ trabajadorId, onSuccess }: FormularioTrabajadorProps) => {
  const { data: trabajadores } = useTrabajadores();
  const crearMutation = useCrearTrabajador();
  const actualizarMutation = useActualizarTrabajador();

  const trabajador = trabajadores?.find((t) => t.id === trabajadorId);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: "",
      apellidos: "",
      telefono: "",
      email: "",
      puesto: "",
      fecha_contratacion: new Date().toISOString().split("T")[0],
      salario_hora: undefined,
      notas: "",
    },
  });

  useEffect(() => {
    if (trabajador) {
      form.reset({
        nombre: trabajador.nombre,
        apellidos: trabajador.apellidos,
        telefono: trabajador.telefono,
        email: trabajador.email || "",
        puesto: trabajador.puesto,
        fecha_contratacion: trabajador.fecha_contratacion,
        salario_hora: trabajador.salario_hora || undefined,
        notas: trabajador.notas || "",
      });
    }
  }, [trabajador, form]);

  const onSubmit = async (values: FormValues) => {
    const data = {
      ...values,
      email: values.email || null,
      salario_hora: values.salario_hora || null,
      notas: values.notas || null,
      activo: true,
    };

    if (trabajadorId) {
      await actualizarMutation.mutateAsync({ id: trabajadorId, ...data });
    } else {
      await crearMutation.mutateAsync(data as any);
    }

    form.reset();
    onSuccess?.();
  };

  return (
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
                  <Input placeholder="Juan" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="apellidos"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Apellidos</FormLabel>
                <FormControl>
                  <Input placeholder="García López" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="telefono"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Teléfono</FormLabel>
                <FormControl>
                  <Input placeholder="612345678" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email (opcional)</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="juan@email.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="puesto"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Puesto</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar puesto" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PUESTOS.map((puesto) => (
                      <SelectItem key={puesto.value} value={puesto.value}>
                        {puesto.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="fecha_contratacion"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fecha de Contratación</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="salario_hora"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Salario por Hora (€) (opcional)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="15.50"
                  {...field}
                  onChange={(e) => {
                    const value = e.target.value;
                    field.onChange(value === "" ? undefined : parseFloat(value));
                  }}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notas"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notas (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Información adicional..."
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full">
          {trabajadorId ? "Actualizar" : "Crear"} Trabajador
        </Button>
      </form>
    </Form>
  );
};
