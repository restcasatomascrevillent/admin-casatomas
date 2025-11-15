import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { verificarDisponibilidadSala } from "@/hooks/useDisponibilidad";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const formSchema = z.object({
  nombre: z.string().min(2, "El nombre es requerido"),
  telefono: z.string().min(9, "Teléfono inválido"),
  email: z.string().email("Email inválido").min(1, "El email es requerido"),
  fecha: z.date({ required_error: "Selecciona una fecha" }),
  hora: z.string().min(1, "Selecciona una hora"),
  sala_id: z.string().min(1, "Selecciona una sala"),
  numero_comensales: z.number().min(1, "Mínimo 1 comensal"),
  notas_cliente: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface FormularioReservaProps {
  onSuccess?: () => void;
  isPublic?: boolean;
  datosPreseleccionados?: {
    sala_id: string;
    fecha: Date;
    hora: string;
  } | null;
}

export const FormularioReserva = ({ onSuccess, isPublic = false, datosPreseleccionados }: FormularioReservaProps) => {
  const navigate = useNavigate();
  const [disponibilidadInfo, setDisponibilidadInfo] = useState<{
    disponible: boolean;
    mesasDisponibles: number;
    mensaje: string;
  } | null>(null);
  const [verificando, setVerificando] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      numero_comensales: 2,
    },
  });

  // Actualizar formulario cuando cambien los datos preseleccionados
  useEffect(() => {
    if (datosPreseleccionados) {
      form.setValue("sala_id", datosPreseleccionados.sala_id);
      form.setValue("fecha", datosPreseleccionados.fecha);
      form.setValue("hora", datosPreseleccionados.hora);
    }
  }, [datosPreseleccionados, form]);

  // Verificar disponibilidad automáticamente cuando cambian los campos relevantes (ya manejado arriba)
  // Código antiguo eliminado

  const onSubmit = async (values: FormValues) => {
    try {
      const { error } = await supabase.from("reservas" as any).insert({
        nombre: values.nombre,
        telefono: values.telefono,
        email: values.email,
        fecha: format(values.fecha, "yyyy-MM-dd"),
        hora: values.hora,
        sala_id: values.sala_id,
        numero_comensales: values.numero_comensales,
        notas_cliente: values.notas_cliente || null,
        estado: "pendiente",
      });

      if (error) throw error;

      toast.success("¡Reserva creada exitosamente!");
      form.reset();

      if (isPublic) {
        navigate("/reserva/confirmacion");
      } else if (onSuccess) {
        onSuccess();
      }
    } catch (error: any) {
      console.error("Error creando reserva:", error);
      toast.error("Error al crear la reserva: " + error.message);
    }
  };

  // Código antiguo eliminado - ahora solo trabajamos con sala_id
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="nombre"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre completo</FormLabel>
                <FormControl>
                  <Input placeholder="Juan Pérez" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

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
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="juan@email.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        </div>

        <FormField
          control={form.control}
          name="numero_comensales"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Número de comensales</FormLabel>
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
          name="notas_cliente"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notas adicionales (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Alergias, preferencias, ocasión especial..."
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {disponibilidadInfo && (
          <Alert variant={disponibilidadInfo.disponible ? "default" : "destructive"}>
            {disponibilidadInfo.disponible ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
            <AlertDescription>{disponibilidadInfo.mensaje}</AlertDescription>
          </Alert>
        )}

        <Button 
          type="submit" 
          className="w-full"
          disabled={verificando || (disponibilidadInfo !== null && !disponibilidadInfo.disponible)}
        >
          {verificando ? "Verificando..." : "Crear Reserva"}
        </Button>
      </form>
    </Form>
  );
};
