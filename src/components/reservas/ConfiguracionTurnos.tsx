import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, Clock, TrendingUp, Settings } from "lucide-react";
import { toast } from "sonner";
import {
  useConfiguracionTurnos,
  useCrearConfiguracionTurno,
  useActualizarConfiguracionTurno,
  useEliminarConfiguracionTurno,
  ConfiguracionTurno,
} from "@/hooks/useConfiguracionTurnos";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";

const diasSemana = [
  { id: 0, label: "Dom" },
  { id: 1, label: "Lun" },
  { id: 2, label: "Mar" },
  { id: 3, label: "Mié" },
  { id: 4, label: "Jue" },
  { id: 5, label: "Vie" },
  { id: 6, label: "Sáb" },
];

const formSchema = z.object({
  nombre_periodo: z.string().min(1, "El nombre es requerido"),
  hora_inicio: z.string().min(1, "La hora de inicio es requerida"),
  hora_fin: z.string().min(1, "La hora de fin es requerida"),
  intervalo_base_minutos: z.number().min(15).max(60),
  umbral_apertura_secundario: z.number().min(50).max(95),
  dias_semana: z.array(z.number()).min(1, "Selecciona al menos un día"),
  activo: z.boolean(),
  espacio_id: z.string().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

export function ConfiguracionTurnos() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ConfiguracionTurno | null>(null);

  const { data: configuraciones, isLoading } = useConfiguracionTurnos();
  const { data: espacios } = useEspaciosReserva();
  const crearMutation = useCrearConfiguracionTurno();
  const actualizarMutation = useActualizarConfiguracionTurno();
  const eliminarMutation = useEliminarConfiguracionTurno();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre_periodo: "",
      hora_inicio: "13:00",
      hora_fin: "17:00",
      intervalo_base_minutos: 30,
      umbral_apertura_secundario: 70,
      dias_semana: [0, 1, 2, 3, 4, 5, 6],
      activo: true,
      espacio_id: null,
    },
  });

  const openCreateDialog = () => {
    setEditingConfig(null);
    form.reset({
      nombre_periodo: "",
      hora_inicio: "13:00",
      hora_fin: "17:00",
      intervalo_base_minutos: 30,
      umbral_apertura_secundario: 70,
      dias_semana: [0, 1, 2, 3, 4, 5, 6],
      activo: true,
      espacio_id: null,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (config: ConfiguracionTurno) => {
    setEditingConfig(config);
    form.reset({
      nombre_periodo: config.nombre_periodo,
      hora_inicio: config.hora_inicio,
      hora_fin: config.hora_fin,
      intervalo_base_minutos: config.intervalo_base_minutos,
      umbral_apertura_secundario: config.umbral_apertura_secundario,
      dias_semana: config.dias_semana,
      activo: config.activo,
      espacio_id: config.espacio_id,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    try {
      if (editingConfig) {
        await actualizarMutation.mutateAsync({
          id: editingConfig.id,
          ...values,
        });
        toast.success("Configuración actualizada");
      } else {
        await crearMutation.mutateAsync({
          nombre_periodo: values.nombre_periodo,
          hora_inicio: values.hora_inicio,
          hora_fin: values.hora_fin,
          intervalo_base_minutos: values.intervalo_base_minutos,
          umbral_apertura_secundario: values.umbral_apertura_secundario,
          dias_semana: values.dias_semana,
          activo: values.activo,
          espacio_id: values.espacio_id,
        });
        toast.success("Configuración creada");
      }
      setDialogOpen(false);
    } catch (error) {
      toast.error("Error al guardar la configuración");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro de eliminar esta configuración?")) return;
    try {
      await eliminarMutation.mutateAsync(id);
      toast.success("Configuración eliminada");
    } catch (error) {
      toast.error("Error al eliminar la configuración");
    }
  };

  const handleToggleActivo = async (config: ConfiguracionTurno) => {
    try {
      await actualizarMutation.mutateAsync({
        id: config.id,
        activo: !config.activo,
      });
      toast.success(config.activo ? "Periodo desactivado" : "Periodo activado");
    } catch (error) {
      toast.error("Error al cambiar el estado");
    }
  };

  const getEspacioNombre = (espacioId: string | null) => {
    if (!espacioId) return "Todos los espacios";
    return espacios?.find((e) => e.id === espacioId)?.nombre || "Espacio desconocido";
  };

  if (isLoading) {
    return <div className="p-4">Cargando configuración...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Configuración de Turnos</h3>
          <p className="text-sm text-muted-foreground">
            Configura los periodos de servicio y el sistema de turnos dinámicos
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Periodo
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingConfig ? "Editar Periodo" : "Nuevo Periodo de Servicio"}
              </DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="nombre_periodo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre del periodo</FormLabel>
                      <FormControl>
                        <Input placeholder="Ej: Comida, Cena..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="hora_inicio"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Hora inicio</FormLabel>
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
                        <FormLabel>Hora fin</FormLabel>
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
                  name="intervalo_base_minutos"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Intervalo base (minutos)</FormLabel>
                      <Select
                        value={field.value.toString()}
                        onValueChange={(v) => field.onChange(parseInt(v))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="30">30 minutos</SelectItem>
                          <SelectItem value="60">60 minutos</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Los turnos intermedios (cada 15 min) se abrirán con alta ocupación
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="umbral_apertura_secundario"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Umbral de ocupación para abrir turno intermedio: {field.value}%
                      </FormLabel>
                      <FormControl>
                        <Slider
                          value={[field.value]}
                          onValueChange={(v) => field.onChange(v[0])}
                          min={50}
                          max={95}
                          step={5}
                          className="mt-2"
                        />
                      </FormControl>
                      <FormDescription>
                        Cuando un turno primario alcance este % de ocupación, se abrirá el turno +15min
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dias_semana"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Días activos</FormLabel>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {diasSemana.map((dia) => (
                          <label
                            key={dia.id}
                            className={`
                              flex items-center justify-center w-10 h-10 rounded-full cursor-pointer border-2 text-sm font-medium
                              ${
                                field.value.includes(dia.id)
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-border hover:border-primary/50"
                              }
                            `}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={field.value.includes(dia.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  field.onChange([...field.value, dia.id].sort());
                                } else {
                                  field.onChange(field.value.filter((d) => d !== dia.id));
                                }
                              }}
                            />
                            {dia.label}
                          </label>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="espacio_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Aplicar a</FormLabel>
                      <Select
                        value={field.value || "all"}
                        onValueChange={(v) => field.onChange(v === "all" ? null : v)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Todos los espacios" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="all">Todos los espacios</SelectItem>
                          {espacios?.map((espacio) => (
                            <SelectItem key={espacio.id} value={espacio.id}>
                              {espacio.nombre}
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
                  name="activo"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Periodo activo</FormLabel>
                        <FormDescription>
                          Los periodos inactivos no generan turnos
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={crearMutation.isPending || actualizarMutation.isPending}>
                    {editingConfig ? "Guardar" : "Crear"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Info card */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Settings className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">¿Cómo funciona?</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Los turnos primarios (XX:00, XX:30) siempre están disponibles</li>
                <li>Los turnos intermedios (XX:15, XX:45) se abren automáticamente cuando el turno primario anterior alcanza el umbral de ocupación configurado</li>
                <li>Esto permite optimizar la capacidad sin sobrecargar los turnos principales</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de configuraciones */}
      <div className="grid gap-4 md:grid-cols-2">
        {configuraciones?.map((config) => (
          <Card key={config.id} className={!config.activo ? "opacity-60" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{config.nombre_periodo}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={config.activo}
                    onCheckedChange={() => handleToggleActivo(config)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(config)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(config.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CardDescription>
                {getEspacioNombre(config.espacio_id)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Horario:</span>
                <span className="font-medium">
                  {config.hora_inicio} - {config.hora_fin}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Intervalo base:</span>
                <span className="font-medium">{config.intervalo_base_minutos} min</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Umbral apertura:</span>
                <Badge variant="secondary" className="gap-1">
                  <TrendingUp className="h-3 w-3" />
                  {config.umbral_apertura_secundario}%
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1 pt-2">
                {diasSemana.map((dia) => (
                  <Badge
                    key={dia.id}
                    variant={config.dias_semana.includes(dia.id) ? "default" : "outline"}
                    className="text-xs"
                  >
                    {dia.label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {configuraciones?.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">
            No hay periodos de servicio configurados. Crea uno para empezar.
          </p>
        </Card>
      )}
    </div>
  );
}
