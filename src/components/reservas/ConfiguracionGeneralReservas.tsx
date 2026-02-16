import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ShieldCheck, Clock, Users, Mail, Phone, CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";
import {
  useConfiguracionReservas,
  useActualizarConfiguracionReservas,
} from "@/hooks/useConfiguracionReservas";

const configSchema = z.object({
  minutos_corte_antes_servicio: z.number().min(0).max(1440),
  max_reservas_por_telefono_dia: z.number().min(1).max(50),
  max_reservas_por_email_dia: z.number().min(1).max(50),
  max_comensales_por_reserva: z.number().min(1).max(100),
  min_comensales_por_reserva: z.number().min(1).max(50),
  dias_max_antelacion: z.number().min(1).max(365),
  telefono_obligatorio: z.boolean(),
  email_obligatorio: z.boolean(),
  auto_confirmar: z.boolean(),
});

type ConfigFormValues = z.infer<typeof configSchema>;

export function ConfiguracionGeneralReservas() {
  const { data: config, isLoading } = useConfiguracionReservas();
  const actualizarMutation = useActualizarConfiguracionReservas();

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      minutos_corte_antes_servicio: 60,
      max_reservas_por_telefono_dia: 2,
      max_reservas_por_email_dia: 2,
      max_comensales_por_reserva: 12,
      min_comensales_por_reserva: 1,
      dias_max_antelacion: 60,
      telefono_obligatorio: true,
      email_obligatorio: false,
      auto_confirmar: false,
    },
  });

  useEffect(() => {
    if (config) {
      form.reset({
        minutos_corte_antes_servicio: config.minutos_corte_antes_servicio,
        max_reservas_por_telefono_dia: config.max_reservas_por_telefono_dia,
        max_reservas_por_email_dia: config.max_reservas_por_email_dia,
        max_comensales_por_reserva: config.max_comensales_por_reserva,
        min_comensales_por_reserva: config.min_comensales_por_reserva,
        dias_max_antelacion: config.dias_max_antelacion,
        telefono_obligatorio: config.telefono_obligatorio,
        email_obligatorio: config.email_obligatorio,
        auto_confirmar: config.auto_confirmar,
      });
    }
  }, [config, form]);

  const onSubmit = async (values: ConfigFormValues) => {
    try {
      await actualizarMutation.mutateAsync(values);
      toast.success("Configuración guardada correctamente");
    } catch (error) {
      toast.error("Error al guardar la configuración");
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Reglas Generales de Reservas</CardTitle>
        </div>
        <CardDescription>
          Controla los límites, requisitos y comportamiento del sistema de reservas
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Tiempo de corte */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Tiempo y disponibilidad
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6">
                <FormField
                  control={form.control}
                  name="minutos_corte_antes_servicio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cierre de reservas antes del servicio</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={1440}
                            className="w-24"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                          />
                          <span className="text-sm text-muted-foreground">minutos</span>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Si el servicio empieza a las 13:00 y pones 60 min, las reservas web cierran a las 12:00
                      </FormDescription>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dias_max_antelacion"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Máximo de días de antelación</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            max={365}
                            className="w-24"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                          />
                          <span className="text-sm text-muted-foreground">días</span>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Los clientes no podrán reservar con más de esta antelación
                      </FormDescription>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* Límites por contacto */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4 text-muted-foreground" />
                Límites por contacto y comensales
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6">
                <FormField
                  control={form.control}
                  name="max_reservas_por_telefono_dia"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5" />
                        Máx. reservas por teléfono/día
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={50}
                          className="w-24"
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                        />
                      </FormControl>
                      <FormDescription>
                        Un mismo teléfono no podrá hacer más reservas por día
                      </FormDescription>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="max_reservas_por_email_dia"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5" />
                        Máx. reservas por email/día
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={50}
                          className="w-24"
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                        />
                      </FormControl>
                      <FormDescription>
                        Un mismo email no podrá hacer más reservas por día
                      </FormDescription>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="min_comensales_por_reserva"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mínimo de comensales</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={50}
                          className="w-24"
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="max_comensales_por_reserva"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Máximo de comensales</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          className="w-24"
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                        />
                      </FormControl>
                      <FormDescription>
                        Reservas con más comensales requerirán contacto directo
                      </FormDescription>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* Requisitos y comportamiento */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                Requisitos y comportamiento
              </div>
              <div className="space-y-3 pl-6">
                <FormField
                  control={form.control}
                  name="telefono_obligatorio"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Teléfono obligatorio</FormLabel>
                        <FormDescription>
                          Requerir teléfono en el formulario de reserva
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email_obligatorio"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Email obligatorio</FormLabel>
                        <FormDescription>
                          Requerir email en el formulario de reserva
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="auto_confirmar"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Auto-confirmar reservas</FormLabel>
                        <FormDescription>
                          Las reservas se confirman automáticamente sin pasar por "pendiente"
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={actualizarMutation.isPending}>
                {actualizarMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  "Guardar configuración"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
