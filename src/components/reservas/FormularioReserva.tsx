import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format, addDays, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, CalendarIcon, CheckCircle, ShieldBan } from "lucide-react";
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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { verificarAforoTurno } from "@/hooks/useDisponibilidad";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useVerificarBlacklist, BlacklistEntry } from "@/hooks/useBlacklist";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useConfiguracionTurnos, ConfiguracionTurno } from "@/hooks/useConfiguracionTurnos";

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

// Horarios de respaldo si `configuracion_turnos` no devuelve nada para ese día.
const HORARIOS_POR_DEFECTO = [
  "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
  "20:00", "20:30", "21:00", "21:30", "22:00", "22:30",
];

// Genera los huecos de un día a partir de los periodos configurados en `configuracion_turnos`.
const generarHorarios = (turnos: ConfiguracionTurno[] | undefined, fecha: Date | undefined): string[] => {
  if (!fecha) return [];

  const diaSemana = fecha.getDay();
  const periodos = (turnos ?? []).filter(
    (turno) => turno.activo && turno.espacio_id === null && turno.dias_semana?.includes(diaSemana)
  );

  if (periodos.length === 0) return HORARIOS_POR_DEFECTO;

  const horas = new Set<string>();

  for (const periodo of periodos) {
    const [inicioH, inicioM] = periodo.hora_inicio.split(":").map(Number);
    const [finH, finM] = periodo.hora_fin.split(":").map(Number);
    const paso = periodo.intervalo_base_minutos || 30;

    let minutos = inicioH * 60 + inicioM;
    const fin = finH * 60 + finM;

    while (minutos < fin) {
      const h = Math.floor(minutos / 60);
      const m = minutos % 60;
      horas.add(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`);
      minutos += paso;
    }
  }

  return Array.from(horas).sort();
};

interface FormularioReservaProps {
  onSuccess?: () => void;
  isPublic?: boolean;
  datosPreseleccionados?: {
    fecha?: Date;
    hora?: string;
  } | null;
}

export const FormularioReserva = ({ onSuccess, isPublic = false, datosPreseleccionados }: FormularioReservaProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [disponibilidadInfo, setDisponibilidadInfo] = useState<{
    disponible: boolean;
    mensaje: string;
  } | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [blacklistEntry, setBlacklistEntry] = useState<BlacklistEntry | null>(null);
  const [limiteAlcanzado, setLimiteAlcanzado] = useState<string | null>(null);
  const verificarBlacklist = useVerificarBlacklist();
  const { data: configReservas } = useConfiguracionReservas();
  const { data: configTurnos } = useConfiguracionTurnos();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      numero_comensales: 2,
      fecha: datosPreseleccionados?.fecha,
      hora: datosPreseleccionados?.hora ?? "",
    },
  });

  // Actualizar formulario cuando cambien los datos preseleccionados
  useEffect(() => {
    if (datosPreseleccionados?.fecha) {
      form.setValue("fecha", datosPreseleccionados.fecha);
    }
    if (datosPreseleccionados?.hora) {
      form.setValue("hora", datosPreseleccionados.hora);
    }
  }, [datosPreseleccionados, form]);

  const watchedFecha = form.watch("fecha");
  const watchedHora = form.watch("hora");
  const watchedComensales = form.watch("numero_comensales");
  const watchedEmail = form.watch("email");
  const watchedTelefono = form.watch("telefono");

  const horariosDisponibles = useMemo(
    () => generarHorarios(configTurnos, watchedFecha),
    [configTurnos, watchedFecha]
  );

  // Si la hora elegida deja de existir al cambiar de día, se limpia para no enviar un hueco inválido.
  useEffect(() => {
    if (watchedHora && horariosDisponibles.length > 0 && !horariosDisponibles.includes(watchedHora)) {
      form.setValue("hora", "");
    }
  }, [horariosDisponibles, watchedHora, form]);

  // Verificar el aforo del turno cuando hay fecha, hora y comensales.
  // Es solo una comprobación previa: la validación real la hace el trigger
  // `trg_validar_capacidad` en la base de datos al insertar.
  useEffect(() => {
    if (!watchedFecha || !watchedHora || !watchedComensales) {
      setDisponibilidadInfo(null);
      return;
    }

    let cancelado = false;
    const comprobar = async () => {
      setVerificando(true);
      try {
        const resultado = await verificarAforoTurno(
          format(watchedFecha, "yyyy-MM-dd"),
          watchedHora,
          watchedComensales
        );
        if (!cancelado) {
          setDisponibilidadInfo({ disponible: resultado.disponible, mensaje: resultado.mensaje });
        }
      } catch (error) {
        console.error("Error verificando aforo del turno:", error);
        // Si no se puede comprobar, no se bloquea el alta: la base de datos sigue validando.
        if (!cancelado) {
          setDisponibilidadInfo({
            disponible: true,
            mensaje: "No se pudo comprobar el aforo. Se validará al guardar la reserva.",
          });
        }
      } finally {
        if (!cancelado) setVerificando(false);
      }
    };

    const timeout = setTimeout(comprobar, 400);
    return () => {
      cancelado = true;
      clearTimeout(timeout);
    };
  }, [watchedFecha, watchedHora, watchedComensales]);

  useEffect(() => {
    const checkBlacklist = async () => {
      if (watchedEmail || watchedTelefono) {
        try {
          const result = await verificarBlacklist.mutateAsync({
            email: watchedEmail,
            telefono: watchedTelefono,
          });
          setBlacklistEntry(result);
        } catch (error) {
          // No bloquea el formulario: la comprobación definitiva se repite al enviar.
          console.error("Error comprobando la lista negra:", error);
          setBlacklistEntry(null);
        }
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
      const { count, error } = await supabase
        .from("reservas" as any)
        .select("id", { count: "exact", head: true })
        .eq("telefono", telefono)
        .eq("fecha", fecha)
        .not("estado", "in", "(cancelada,no_show)");

      if (error) throw error;

      if (count && count >= configReservas.max_reservas_por_telefono_dia) {
        return `Este teléfono ya tiene ${count} reserva(s) para ese día (máx: ${configReservas.max_reservas_por_telefono_dia})`;
      }
    }

    if (email && configReservas.max_reservas_por_email_dia > 0) {
      const { count, error } = await supabase
        .from("reservas" as any)
        .select("id", { count: "exact", head: true })
        .eq("email", email)
        .eq("fecha", fecha)
        .not("estado", "in", "(cancelada,no_show)");

      if (error) throw error;

      if (count && count >= configReservas.max_reservas_por_email_dia) {
        return `Este email ya tiene ${count} reserva(s) para ese día (máx: ${configReservas.max_reservas_por_email_dia})`;
      }
    }

    return null;
  };

  const onSubmit = async (values: FormValues) => {
    try {
      // Validate required fields based on config
      if (configReservas?.telefono_obligatorio && (!values.telefono || values.telefono.length < 9)) {
        form.setError("telefono", { message: "El teléfono es obligatorio" });
        toast.error("El teléfono es obligatorio");
        return;
      }
      if (configReservas?.email_obligatorio && (!values.email || !values.email.includes("@"))) {
        form.setError("email", { message: "El email es obligatorio" });
        toast.error("El email es obligatorio");
        return;
      }

      // Validate comensales limits
      if (configReservas) {
        if (values.numero_comensales < configReservas.min_comensales_por_reserva) {
          form.setError("numero_comensales", {
            message: `Mínimo ${configReservas.min_comensales_por_reserva} comensal(es)`,
          });
          toast.error(`Mínimo ${configReservas.min_comensales_por_reserva} comensal(es)`);
          return;
        }
        if (values.numero_comensales > configReservas.max_comensales_por_reserva) {
          form.setError("numero_comensales", {
            message: `Máximo ${configReservas.max_comensales_por_reserva} comensales por reserva`,
          });
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

      // Los estados válidos los fija el CHECK `reservas_estado_check`:
      // pendiente | verificada | confirmada | cancelada | completada | no_show.
      // Un cliente en blacklist entra como `pendiente` con `en_blacklist = true`
      // para que el equipo la revise a mano (antes se usaba "rechazada", que no existe
      // en el CHECK y hacía fallar el INSERT con el error 23514).
      const estadoInicial = blacklisted
        ? "pendiente"
        : (configReservas?.auto_confirmar ? "confirmada" : "pendiente");

      const { error } = await supabase.from("reservas" as any).insert({
        nombre: values.nombre,
        telefono: values.telefono || null,
        email: values.email || null,
        fecha: fechaStr,
        hora: values.hora,
        numero_comensales: values.numero_comensales,
        notas_cliente: values.notas_cliente || null,
        estado: estadoInicial,
        canal: isPublic ? "web" : "manual",
        en_blacklist: !!blacklisted,
      });

      if (error) throw error;

      // Refrescar todo lo que muestra reservas del día, ocupación y disponibilidad:
      // sin esto la reserva se crea pero no aparece en ninguna pantalla y el hueco
      // recién ocupado se sigue ofreciendo como libre.
      [
        "reservas-hoy",
        "reservas-kanban",
        "reservas_mes",
        "reservas_hoy_todas",
        "ocupacion_hoy",
        "ocupacion-reservas-hoy",
        "today-reservations",
        "today-confirmed-reservations",
        "dashboard-stats",
        "disponibilidad",
        "disponibilidad-detallada",
        "disponibilidad-rango",
        "resumen-ocupacion-hoy-completo",
      ].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

      if (blacklisted) {
        toast.info("Reserva registrada como pendiente de revisión (cliente en lista negra)");
      } else {
        toast.success("¡Reserva creada exitosamente!");
      }

      form.reset({ numero_comensales: 2, hora: "" });
      setLimiteAlcanzado(null);
      setDisponibilidadInfo(null);

      if (isPublic) {
        // No existe ninguna página de confirmación en el panel; se vuelve al listado.
        navigate("/reservas");
      } else if (onSuccess) {
        onSuccess();
      }
    } catch (error: any) {
      console.error("Error creando reserva:", error);
      // 23514 = check_violation. Lo lanza el trigger `trg_validar_capacidad` cuando
      // se supera el aforo del turno, y también los CHECK de la tabla.
      const mensaje = error?.code === "23514" && String(error?.message || "").includes("Aforo")
        ? "No hay aforo suficiente en ese turno. Elige otra hora o reduce los comensales."
        : `Error al crear la reserva: ${error?.message ?? "error desconocido"}`;
      toast.error(mensaje);
    }
  };

  // Errores de validación visibles: sin esto el botón parecía no hacer nada.
  const erroresValidacion = Object.values(form.formState.errors)
    .map((error) => error?.message)
    .filter(Boolean) as string[];

  const maxFecha = configReservas?.dias_max_antelacion
    ? addDays(new Date(), configReservas.dias_max_antelacion)
    : undefined;

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
          <FormField
            control={form.control}
            name="fecha"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Fecha</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {field.value
                          ? format(field.value, "EEEE, d 'de' MMMM yyyy", { locale: es })
                          : "Seleccionar fecha"}
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      disabled={(date) =>
                        date < startOfDay(new Date()) || (!!maxFecha && date > maxFecha)
                      }
                      initialFocus
                      locale={es}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="hora"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Hora</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={!watchedFecha}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={watchedFecha ? "Seleccionar hora" : "Elige antes una fecha"}
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {horariosDisponibles.map((hora) => (
                      <SelectItem key={hora} value={hora}>
                        {hora}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
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

        {erroresValidacion.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Faltan datos para crear la reserva:</strong>
              <ul className="list-disc pl-4 mt-1">
                {erroresValidacion.map((mensaje) => (
                  <li key={mensaje}>{mensaje}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

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
          disabled={
            verificando ||
            form.formState.isSubmitting ||
            (disponibilidadInfo !== null && !disponibilidadInfo.disponible)
          }
        >
          {verificando
            ? "Verificando..."
            : form.formState.isSubmitting
              ? "Creando..."
              : "Crear Reserva"}
        </Button>
      </form>
    </Form>
  );
};
