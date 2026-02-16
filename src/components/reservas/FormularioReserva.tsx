import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format, addDays } from "date-fns";
import { AlertTriangle, CheckCircle, ShieldBan } from "lucide-react";
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
import { useVerificarBlacklist, BlacklistEntry } from "@/hooks/useBlacklist";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";

const formSchema = z.object({
  nombre: z.string().min(2, "El nombre es requerido"),
  telefono: z.string().optional(),
  email: z.string().optional(),
  fecha: z.date({ required_error: "Selecciona una fecha" }),
  hora: z.string().min(1, "Selecciona una hora"),
  numero_comensales: z.number().min(1, "Mínimo 1 comensal"),
  notas_cliente: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface FormularioReservaProps {
  onSuccess?: () => void;
  isPublic?: boolean;
  datosPreseleccionados?: {
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
  const [blacklistEntry, setBlacklistEntry] = useState<BlacklistEntry | null>(null);
  const [limiteAlcanzado, setLimiteAlcanzado] = useState<string | null>(null);
  const verificarBlacklist = useVerificarBlacklist();
  const { data: configReservas } = useConfiguracionReservas();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      numero_comensales: 2,
    },
  });

  // Actualizar formulario cuando cambien los datos preseleccionados
  useEffect(() => {
    if (datosPreseleccionados) {
      form.setValue("fecha", datosPreseleccionados.fecha);
      form.setValue("hora", datosPreseleccionados.hora);
    }
  }, [datosPreseleccionados, form]);

  // Verificar disponibilidad automáticamente cuando cambian los campos relevantes (ya manejado arriba)
  // Código antiguo eliminado

  // Verificar blacklist cuando cambian email o teléfono
  const watchedEmail = form.watch("email");
  const watchedTelefono = form.watch("telefono");

  useEffect(() => {
    const checkBlacklist = async () => {
      if (watchedEmail || watchedTelefono) {
        const result = await verificarBlacklist.mutateAsync({
          email: watchedEmail,
          telefono: watchedTelefono,
        });
        setBlacklistEntry(result);
      } else {
        setBlacklistEntry(null);
      }
    };

    const timeout = setTimeout(checkBlacklist, 500);
    return () => clearTimeout(timeout);
  }, [watchedEmail, watchedTelefono]);

  // Verificar límites de reservas por teléfono/email
  const verificarLimites = async (telefono: string | undefined, email: string | undefined, fecha: string) => {
    if (!configReservas) return null;

    if (telefono && configReservas.max_reservas_por_telefono_dia > 0) {
      const { count } = await supabase
        .from("reservas" as any)
        .select("id", { count: "exact", head: true })
        .eq("telefono", telefono)
        .eq("fecha", fecha)
        .not("estado", "in", "(cancelada,rechazada)");

      if (count && count >= configReservas.max_reservas_por_telefono_dia) {
        return `Este teléfono ya tiene ${count} reserva(s) para hoy (máx: ${configReservas.max_reservas_por_telefono_dia})`;
      }
    }

    if (email && configReservas.max_reservas_por_email_dia > 0) {
      const { count } = await supabase
        .from("reservas" as any)
        .select("id", { count: "exact", head: true })
        .eq("email", email)
        .eq("fecha", fecha)
        .not("estado", "in", "(cancelada,rechazada)");

      if (count && count >= configReservas.max_reservas_por_email_dia) {
        return `Este email ya tiene ${count} reserva(s) para hoy (máx: ${configReservas.max_reservas_por_email_dia})`;
      }
    }

    return null;
  };

  const onSubmit = async (values: FormValues) => {
    try {
      // Validate required fields based on config
      if (configReservas?.telefono_obligatorio && (!values.telefono || values.telefono.length < 9)) {
        toast.error("El teléfono es obligatorio");
        return;
      }
      if (configReservas?.email_obligatorio && (!values.email || !values.email.includes("@"))) {
        toast.error("El email es obligatorio");
        return;
      }

      // Validate comensales limits
      if (configReservas) {
        if (values.numero_comensales < configReservas.min_comensales_por_reserva) {
          toast.error(`Mínimo ${configReservas.min_comensales_por_reserva} comensal(es)`);
          return;
        }
        if (values.numero_comensales > configReservas.max_comensales_por_reserva) {
          toast.error(`Máximo ${configReservas.max_comensales_por_reserva} comensales por reserva`);
          return;
        }
      }

      const fechaStr = format(values.fecha, "yyyy-MM-dd");

      // Check limits per phone/email
      const limiteMsg = await verificarLimites(values.telefono, values.email, fechaStr);
      if (limiteMsg) {
        setLimiteAlcanzado(limiteMsg);
        toast.error(limiteMsg);
        return;
      }

      // Verificar blacklist antes de crear
      const blacklisted = await verificarBlacklist.mutateAsync({
        email: values.email || "",
        telefono: values.telefono || "",
      });

      const estadoInicial = blacklisted ? "rechazada" : (configReservas?.auto_confirmar ? "confirmada" : "pendiente");

      const { error } = await supabase.from("reservas" as any).insert({
        nombre: values.nombre,
        telefono: values.telefono || null,
        email: values.email || null,
        fecha: fechaStr,
        hora: values.hora,
        numero_comensales: values.numero_comensales,
        notas_cliente: values.notas_cliente || null,
        estado: estadoInicial,
        en_blacklist: !!blacklisted,
      });

      if (error) throw error;

      if (blacklisted) {
        toast.info("Reserva registrada para revisión");
      } else {
        toast.success("¡Reserva creada exitosamente!");
      }
      
      form.reset();
      setLimiteAlcanzado(null);

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
                    min={configReservas?.min_comensales_por_reserva || 1}
                    max={configReservas?.max_comensales_por_reserva || 100}
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

        {limiteAlcanzado && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{limiteAlcanzado}</AlertDescription>
          </Alert>
        )}

        {blacklistEntry && !isPublic && (
          <Alert variant="destructive">
            <ShieldBan className="h-4 w-4" />
            <AlertDescription>
              <strong>Cliente en lista negra:</strong> {blacklistEntry.nombre || "Sin nombre"} 
              {blacklistEntry.motivo && ` - ${blacklistEntry.motivo}`}
            </AlertDescription>
          </Alert>
        )}

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
