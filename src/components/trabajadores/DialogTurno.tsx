import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  useCrearTurno,
  useActualizarTurno,
  useEliminarTurno,
  useTrabajadoresActivos,
} from "@/hooks/useTrabajadores";
import { useAreasTrabajoActivas } from "@/hooks/useAreasTrabajo";
import { useSalas } from "@/hooks/useSalas";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2 } from "lucide-react";

const formSchema = z.object({
  trabajador_id: z.string().min(1, "Selecciona un trabajador"),
  fecha: z.string(),
  hora_inicio: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Formato HH:MM"),
  hora_fin: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Formato HH:MM"),
  estado: z.enum(["programado", "activo", "completado", "cancelado"]),
  notas: z.string().optional(),
  areas: z.array(z.string()).optional(),
  salas: z.array(z.string()).optional(),
}).refine((data) => {
  // Validar que hora_fin > hora_inicio
  const [horaI, minI] = data.hora_inicio.split(":").map(Number);
  const [horaF, minF] = data.hora_fin.split(":").map(Number);
  const minutosInicio = horaI * 60 + minI;
  const minutosFin = horaF * 60 + minF;
  return minutosFin > minutosInicio;
}, {
  message: "La hora de fin debe ser posterior a la hora de inicio (no se permiten turnos nocturnos que cruzan medianoche)",
  path: ["hora_fin"],
});

type FormValues = z.infer<typeof formSchema>;

interface DialogTurnoProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turnoId?: string | null;
  turnoData?: any;
  fechaInicial?: string;
  trabajadorIdInicial?: string;
  horaInicialProp?: string;
}

const ESTADOS = [
  { value: "programado", label: "Programado" },
  { value: "activo", label: "Activo" },
  { value: "completado", label: "Completado" },
  { value: "cancelado", label: "Cancelado" },
];

export const DialogTurno = ({
  open,
  onOpenChange,
  turnoId,
  turnoData,
  fechaInicial,
  trabajadorIdInicial,
  horaInicialProp,
}: DialogTurnoProps) => {
  const { data: trabajadores = [] } = useTrabajadoresActivos();
  const { data: areas = [] } = useAreasTrabajoActivas();
  const { data: salas = [] } = useSalas();
  const crearMutation = useCrearTurno();
  const actualizarMutation = useActualizarTurno();
  const eliminarMutation = useEliminarTurno();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      trabajador_id: trabajadorIdInicial || "",
      fecha: fechaInicial || new Date().toISOString().split("T")[0],
      hora_inicio: horaInicialProp || "09:00",
      hora_fin: "17:00",
      estado: "programado",
      notas: "",
      areas: [],
      salas: [],
    },
  });

  useEffect(() => {
    if (turnoData) {
      form.reset({
        trabajador_id: turnoData.trabajador_id,
        fecha: turnoData.fecha,
        hora_inicio: turnoData.hora_inicio,
        hora_fin: turnoData.hora_fin,
        estado: turnoData.estado,
        notas: turnoData.notas || "",
        areas: turnoData.areas_ids || [],
        salas: turnoData.salas_ids || [],
      });
    } else if (fechaInicial || trabajadorIdInicial || horaInicialProp) {
      form.reset({
        trabajador_id: trabajadorIdInicial || "",
        fecha: fechaInicial || new Date().toISOString().split("T")[0],
        hora_inicio: horaInicialProp || "09:00",
        hora_fin: "17:00",
        estado: "programado",
        notas: "",
        areas: [],
        salas: [],
      });
    }
  }, [turnoData, fechaInicial, trabajadorIdInicial, horaInicialProp, form]);

  const onSubmit = async (values: FormValues) => {
    const { areas: areasSeleccionadas, ...turnoValues } = values;
    
    const turnoData = {
      ...turnoValues,
      notas: values.notas || null,
      areas: areasSeleccionadas,
    };

    if (turnoId) {
      await actualizarMutation.mutateAsync({ id: turnoId, ...turnoData });
    } else {
      await crearMutation.mutateAsync(turnoData as any);
    }

    form.reset();
    onOpenChange(false);
  };

  const handleEliminar = async () => {
    if (turnoId && confirm("¿Estás seguro de eliminar este turno?")) {
      await eliminarMutation.mutateAsync(turnoId);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {turnoId ? "Editar Turno" : "Nuevo Turno"}
          </DialogTitle>
          <DialogDescription>
            {turnoId
              ? "Modifica los datos del turno"
              : "Crea un nuevo turno para un trabajador"}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="trabajador_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Trabajador</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un trabajador" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {trabajadores.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.nombre} {t.apellidos} - {t.puesto}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="fecha"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="estado"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estado</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona un estado" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ESTADOS.map((e) => (
                          <SelectItem key={e.value} value={e.value}>
                            {e.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="hora_inicio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hora Inicio</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="hora_fin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hora Fin</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="areas"
              render={() => (
                <FormItem>
                  <FormLabel>Áreas de Trabajo Asignadas (opcional)</FormLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {areas.map((area: any) => (
                      <FormField
                        key={area.id}
                        control={form.control}
                        name="areas"
                        render={({ field }) => {
                          const value = field.value || [];
                          return (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={value.includes(area.id)}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([...value, area.id])
                                      : field.onChange(
                                          value.filter((v: string) => v !== area.id)
                                        );
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">
                                {area.nombre} {area.tipo ? `(${area.tipo})` : ""}
                              </FormLabel>
                            </FormItem>
                          );
                        }}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="salas"
              render={() => (
                <FormItem>
                  <FormLabel>Salas/Ubicaciones Asignadas (opcional)</FormLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {salas.filter((sala: any) => sala.activa).map((sala: any) => (
                      <FormField
                        key={sala.id}
                        control={form.control}
                        name="salas"
                        render={({ field }) => {
                          const value = field.value || [];
                          return (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={value.includes(sala.id)}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([...value, sala.id])
                                      : field.onChange(
                                          value.filter((v: string) => v !== sala.id)
                                        );
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">
                                {sala.nombre}
                              </FormLabel>
                            </FormItem>
                          );
                        }}
                      />
                    ))}
                  </div>
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
                      placeholder="Notas adicionales sobre el turno..."
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-center justify-between pt-4">
              {turnoId && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleEliminar}
                  disabled={eliminarMutation.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar Turno
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={crearMutation.isPending || actualizarMutation.isPending}
                >
                  {turnoId ? "Actualizar" : "Crear"} Turno
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
