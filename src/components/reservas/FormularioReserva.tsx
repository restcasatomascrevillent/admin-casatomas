import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { CalendarIcon, Clock, AlertTriangle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSalas, usePosicionesSala } from "@/hooks/useSalas";
import { verificarDisponibilidad } from "@/hooks/useDisponibilidad";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { es } from "date-fns/locale";

const formSchema = z.object({
  nombre: z.string().min(2, "El nombre es requerido"),
  telefono: z.string().min(9, "Teléfono inválido"),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  fecha: z.date({ required_error: "Selecciona una fecha" }),
  hora: z.string().min(1, "Selecciona una hora"),
  sala_id: z.string().min(1, "Selecciona una sala"),
  posicion_sala_id: z.string().optional(),
  numero_comensales: z.number().min(1, "Mínimo 1 comensal"),
  numero_mesas: z.number().min(1, "Mínimo 1 mesa"),
  notas_cliente: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface FormularioReservaProps {
  onSuccess?: () => void;
  isPublic?: boolean;
}

export const FormularioReserva = ({ onSuccess, isPublic = false }: FormularioReservaProps) => {
  const [selectedSalaId, setSelectedSalaId] = useState<string>("");
  const [disponibilidadInfo, setDisponibilidadInfo] = useState<{
    disponible: boolean;
    mesasDisponibles: number;
    mensaje: string;
  } | null>(null);
  const [verificando, setVerificando] = useState(false);
  const { data: salas } = useSalas();
  const { data: posiciones } = usePosicionesSala(selectedSalaId || null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      numero_comensales: 2,
      numero_mesas: 1,
    },
  });

  // Verificar disponibilidad automáticamente cuando cambian los campos relevantes
  useEffect(() => {
    const verificar = async () => {
      const fecha = form.watch("fecha");
      const hora = form.watch("hora");
      const salaId = form.watch("sala_id");
      const posicionId = form.watch("posicion_sala_id");
      const numeroMesas = form.watch("numero_mesas");

      // Solo verificar si tenemos todos los datos necesarios
      if (!fecha || !hora || !salaId || !numeroMesas) {
        setDisponibilidadInfo(null);
        return;
      }

      setVerificando(true);
      try {
        const result = await verificarDisponibilidad(
          format(fecha, "yyyy-MM-dd"),
          hora,
          salaId,
          posicionId || null,
          numeroMesas
        );

        if (result.disponible) {
          setDisponibilidadInfo({
            disponible: true,
            mesasDisponibles: result.mesasDisponibles,
            mensaje: `✓ Disponible: ${result.mesasDisponibles} mesas libres de ${result.totalMesas}`,
          });
        } else {
          setDisponibilidadInfo({
            disponible: false,
            mesasDisponibles: result.mesasDisponibles,
            mensaje: `✗ No hay disponibilidad: solo ${result.mesasDisponibles} mesas libres (necesitas ${numeroMesas})`,
          });
        }
      } catch (error) {
        console.error("Error verificando disponibilidad:", error);
        setDisponibilidadInfo(null);
      } finally {
        setVerificando(false);
      }
    };

    verificar();
  }, [
    form.watch("fecha"),
    form.watch("hora"),
    form.watch("sala_id"),
    form.watch("posicion_sala_id"),
    form.watch("numero_mesas"),
  ]);

  const onSubmit = async (values: FormValues) => {
    // Verificar disponibilidad una última vez antes de enviar
    if (disponibilidadInfo && !disponibilidadInfo.disponible) {
      toast.error("No hay disponibilidad para esta reserva");
      return;
    }

    try {
      // En modo público no requerir autenticación
      if (!isPublic) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          toast.error("Debes iniciar sesión");
          return;
        }
      }

      const { error } = await supabase.from("reservas" as any).insert({
        nombre: values.nombre,
        telefono: values.telefono,
        email: values.email || null,
        fecha: format(values.fecha, "yyyy-MM-dd"),
        hora: values.hora,
        sala_id: values.sala_id,
        posicion_sala_id: values.posicion_sala_id || null,
        numero_comensales: values.numero_comensales,
        numero_mesas: values.numero_mesas,
        notas_cliente: values.notas_cliente || null,
        estado: "pendiente",
      });

      if (error) throw error;

      toast.success(
        isPublic 
          ? "¡Reserva recibida! Te contactaremos pronto para confirmarla." 
          : "Reserva creada correctamente"
      );
      form.reset();
      onSuccess?.();
    } catch (error: any) {
      toast.error("Error al crear reserva: " + error.message);
    }
  };

  // Generar opciones de hora cada 30 minutos
  const horasDisponibles = [];
  for (let h = 8; h <= 23; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hora = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
      horasDisponibles.push(hora);
    }
  }

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
              <FormLabel>Email (opcional)</FormLabel>
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
                        variant="outline"
                        className={cn(
                          "pl-3 text-left font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        {field.value ? (
                          format(field.value, "PPP", { locale: es })
                        ) : (
                          <span>Seleccionar fecha</span>
                        )}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      disabled={(date) => date < new Date()}
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
              <FormItem>
                <FormLabel>Hora</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar hora" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {horasDisponibles.map((hora) => (
                      <SelectItem key={hora} value={hora}>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          {hora}
                        </div>
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
          name="sala_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Sala</FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  setSelectedSalaId(value);
                }}
                defaultValue={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar sala" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {salas?.map((sala) => (
                    <SelectItem key={sala.id} value={sala.id}>
                      {sala.nombre} - {sala.numero_mesas} mesas
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {posiciones && posiciones.length > 0 && (
          <FormField
            control={form.control}
            name="posicion_sala_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Posición (opcional)</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar posición" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="">Sin posición específica</SelectItem>
                    {posiciones.map((pos) => (
                      <SelectItem key={pos.id} value={pos.id}>
                        {pos.nombre} - Cap. {pos.capacidad_comensales}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        </div>

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
