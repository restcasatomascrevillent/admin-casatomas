import { useMemo, useState } from "react";
import { ConfiguracionGeneralReservas } from "./ConfiguracionGeneralReservas";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Clock, TrendingUp, Settings, Layers } from "lucide-react";
import { toast } from "sonner";
import {
  useConfiguracionTurnos,
  useCrearConfiguracionTurno,
  useActualizarConfiguracionTurno,
  useEliminarConfiguracionTurno,
  ConfiguracionTurno,
} from "@/hooks/useConfiguracionTurnos";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { EscaleraTurnoEditor } from "./EscaleraTurnoEditor";
import { MARCA_POR_DEFECTO, salaAdmiteReservas } from "@/lib/reservas/negocios";
import { leerNivelesCrudos, NIVELES_POR_DEFECTO, etiquetaNivelLocal } from "./escaleraTexto";
// El mismo módulo puro que usan la web y el teléfono. Se usa aquí solo para
// LEER (derivar la escalera equivalente de las columnas antiguas al migrar,
// y para pintar el resumen de cada tarjeta) — nunca se reimplementa la regla.
import {
  resolverEscalera,
  sumarCapacidadPorMarca,
  type ConfiguracionTurnoInput,
  type NivelEscalera,
  type BaseUmbral,
} from "../../../supabase/functions/_shared/disponibilidad";

const diasSemana = [
  { id: 0, label: "Dom" },
  { id: 1, label: "Lun" },
  { id: 2, label: "Mar" },
  { id: 3, label: "Mié" },
  { id: 4, label: "Jue" },
  { id: 5, label: "Vie" },
  { id: 6, label: "Sáb" },
];

// La escalera NO se valida a la fuerza aquí (ver `EscaleraTurnoEditor`): el
// motor tiene un comportamiento documentado para cada configuración "rara"
// (umbrales desordenados, 0%, 100%...) y la pantalla avisa en vez de
// bloquear. Solo se exigen los límites DUROS del CHECK de la migración
// (1..8 niveles, minutos entero >=1, umbral 0..100) para no generar un
// payload que la base de datos rechazaría de todas formas.
const nivelEscaleraSchema = z.object({
  minutos: z.number().int().min(1).max(1440),
  umbral: z.number().min(0).max(100),
});

const formSchema = z.object({
  nombre_periodo: z.string().min(1, "El nombre es requerido"),
  hora_inicio: z.string().min(1, "La hora de inicio es requerida"),
  hora_fin: z.string().min(1, "La hora de fin es requerida"),
  intervalo_base_minutos: z.number().min(15).max(60),
  umbral_apertura_secundario: z.number().min(0).max(100),
  dias_semana: z.array(z.number()).min(1, "Selecciona al menos un día"),
  activo: z.boolean(),
  espacio_id: z.string().nullable(),
  ocultar_primario_si_secundario: z.boolean(),
  // NUEVO — escalera de niveles configurable (migración 20260921000000).
  // `modo_escalera` es un campo solo de pantalla (no se guarda tal cual):
  // decide si se envía la forma antigua (2 columnas) o la nueva (lista).
  modo_escalera: z.enum(["legacy", "avanzado"]),
  niveles_escalera: z.array(nivelEscaleraSchema).min(1).max(8),
  ocultar_nivel_anterior: z.boolean(),
  base_umbral: z.enum(["aforo_total", "reparto_nivel_base"]),
});

type FormValues = z.infer<typeof formSchema>;

export function ConfiguracionTurnos() {
  const [dialogOpen, setDialogOpen] = useState(false);
  // Borrar un periodo pide confirmación en un AlertDialog (el `confirm()` nativo del navegador
  // no pega con el resto, y en la tablet sale como un cuadro del sistema).
  const [idAEliminar, setIdAEliminar] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<ConfiguracionTurno | null>(null);
  // De dónde salió la escalera que se ve AHORA MISMO en la pestaña avanzada
  // al abrir el diálogo: "niveles_escalera" = ya existía tal cual;
  // "legacy" = se acaba de derivar de las columnas antiguas para poder
  // ofrecer la migración. Solo gobierna el aviso informativo de la pestaña.
  const [origenEscaleraAlAbrir, setOrigenEscaleraAlAbrir] = useState<"niveles_escalera" | "legacy">(
    "niveles_escalera",
  );

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
      ocultar_primario_si_secundario: false,
      modo_escalera: "avanzado",
      niveles_escalera: NIVELES_POR_DEFECTO,
      ocultar_nivel_anterior: false,
      base_umbral: "reparto_nivel_base",
    },
  });

  // Aforo del turno para la previsualización: la suma de `capacidad_maxima` de
  // las salas ACTIVAS de Casa Tomás, igual que `leerDatosDelDia` en
  // `useDisponibilidad.ts` y que el trigger `validar_capacidad_reserva` (que
  // suma por marca): es la cifra que el motor usa siempre para el aforo y para
  // repartir el umbral. Solo Casa Tomás admite reservas (decisión del dueño,
  // 2026-10-01): las salas de Touza que queden activas no suman ni se ofrecen
  // en «Aplicar a».
  const capacidadTotalActiva = useMemo(
    () =>
      sumarCapacidadPorMarca(
        (espacios ?? [])
          .filter((e: any) => e.activa)
          .map((e: any) => ({ capacidad_maxima: Number(e.capacidad_maxima) || 0, marca: e.caracteristicas?.marca })),
        MARCA_POR_DEFECTO,
      ),
    [espacios],
  );
  const salasDeCasaTomas = useMemo(() => (espacios ?? []).filter((e: any) => salaAdmiteReservas(e)), [espacios]);

  const openCreateDialog = () => {
    setEditingConfig(null);
    setOrigenEscaleraAlAbrir("niveles_escalera");
    form.reset({
      nombre_periodo: "",
      hora_inicio: "13:00",
      hora_fin: "17:00",
      intervalo_base_minutos: 30,
      umbral_apertura_secundario: 70,
      dias_semana: [0, 1, 2, 3, 4, 5, 6],
      activo: true,
      espacio_id: null,
      ocultar_primario_si_secundario: false,
      // Un periodo nuevo nace directamente en modo avanzado: no hay datos
      // antiguos que preservar y es la forma que queremos que se use.
      modo_escalera: "avanzado",
      niveles_escalera: NIVELES_POR_DEFECTO,
      ocultar_nivel_anterior: false,
      base_umbral: "reparto_nivel_base",
    });
    setDialogOpen(true);
  };

  const openEditDialog = (config: ConfiguracionTurno) => {
    setEditingConfig(config);

    // Se lee tal cual lo guardado (sin normalizar) para no reescribirle a
    // nadie lo que escribió; si no hay nada aprovechable, se ofrece la
    // migración derivando la escalera EQUIVALENTE con el propio motor, así
    // que activarla no cambia ni una hora de lo que ya se ofrece hoy.
    const crudos = leerNivelesCrudos(config.niveles_escalera);
    const origen: "niveles_escalera" | "legacy" = crudos ? "niveles_escalera" : "legacy";
    const derivadaDeLegacy = crudos
      ? null
      : resolverEscalera(config as ConfiguracionTurnoInput, new Set<string>()).escalera;
    setOrigenEscaleraAlAbrir(origen);

    const ocultarNivelAnterior =
      typeof config.ocultar_nivel_anterior === "boolean"
        ? config.ocultar_nivel_anterior
        : config.ocultar_primario_si_secundario;
    const baseUmbral: BaseUmbral = config.base_umbral === "aforo_total" ? "aforo_total" : "reparto_nivel_base";

    form.reset({
      nombre_periodo: config.nombre_periodo,
      hora_inicio: config.hora_inicio,
      hora_fin: config.hora_fin,
      intervalo_base_minutos: config.intervalo_base_minutos,
      umbral_apertura_secundario: config.umbral_apertura_secundario,
      dias_semana: config.dias_semana,
      activo: config.activo,
      espacio_id: config.espacio_id,
      ocultar_primario_si_secundario: config.ocultar_primario_si_secundario,
      modo_escalera: origen === "niveles_escalera" ? "avanzado" : "legacy",
      niveles_escalera: crudos ?? derivadaDeLegacy ?? NIVELES_POR_DEFECTO,
      ocultar_nivel_anterior: ocultarNivelAnterior,
      base_umbral: baseUmbral,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    try {
      const base = {
        nombre_periodo: values.nombre_periodo,
        hora_inicio: values.hora_inicio,
        hora_fin: values.hora_fin,
        dias_semana: values.dias_semana,
        activo: values.activo,
        espacio_id: values.espacio_id,
      };
      // En modo avanzado se guarda la escalera nueva y las columnas viejas
      // se dejan tal cual estén (el motor prioriza `niveles_escalera` en
      // cuanto existe, así que no hace falta mantenerlas sincronizadas).
      // En modo simple se guarda EXACTAMENTE como antes de esta pantalla —
      // y si el periodo ya tenía una escalera nueva guardada, se limpia
      // (`niveles_escalera: null`) para que la nueva no siga mandando por
      // encima de las columnas simples que se acaban de editar.
      const payload =
        values.modo_escalera === "avanzado"
          ? {
              ...base,
              // Cast: react-hook-form tipa los arrays de objetos anidados de
              // forma parcial en algunos puntos de su inferencia genérica;
              // el shape real (validado por `nivelEscaleraSchema`) es
              // exactamente `NivelEscalera[]`.
              niveles_escalera: values.niveles_escalera as NivelEscalera[],
              ocultar_nivel_anterior: values.ocultar_nivel_anterior,
              base_umbral: values.base_umbral,
            }
          : {
              ...base,
              intervalo_base_minutos: values.intervalo_base_minutos,
              umbral_apertura_secundario: values.umbral_apertura_secundario,
              ocultar_primario_si_secundario: values.ocultar_primario_si_secundario,
              ...(editingConfig && origenEscaleraAlAbrir === "niveles_escalera" ? { niveles_escalera: null } : {}),
            };

      if (editingConfig) {
        await actualizarMutation.mutateAsync({
          id: editingConfig.id,
          ...payload,
        });
        toast.success("Configuración actualizada");
      } else {
        await crearMutation.mutateAsync(payload);
        toast.success("Configuración creada");
      }
      setDialogOpen(false);
    } catch (error) {
      // Los errores de guardado de la escalera (p. ej. migración pendiente,
      // ver `useConfiguracionTurnos.ts`) traen un mensaje ya en lenguaje
      // llano — se muestra tal cual en vez de taparlo con uno genérico.
      const mensaje = error instanceof Error ? error.message : "Error al guardar la configuración";
      toast.error(mensaje);
    }
  };

  const handleDelete = async (id: string) => {
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

  // Vista de cada tarjeta: si el periodo tiene una escalera nueva guardada
  // se resume esa (niveles + base_umbral + ocultar); si no, se sigue
  // mostrando exactamente lo que ya se mostraba (modo simple).
  const configuracionesConEscalera = useMemo(() => {
    return (configuraciones ?? []).map((config) => {
      const crudos = leerNivelesCrudos(config.niveles_escalera);
      if (!crudos) return { config, enAvanzado: false as const };
      const niveles = [...crudos].sort((a, b) => b.minutos - a.minutos);
      const baseUmbral: BaseUmbral = config.base_umbral === "aforo_total" ? "aforo_total" : "reparto_nivel_base";
      const ocultar =
        typeof config.ocultar_nivel_anterior === "boolean"
          ? config.ocultar_nivel_anterior
          : config.ocultar_primario_si_secundario;
      return { config, enAvanzado: true as const, niveles, baseUmbral, ocultar };
    });
  }, [configuraciones]);

  if (isLoading) {
    return <div className="p-4">Cargando configuración...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Configuración general de reservas */}
      <ConfiguracionGeneralReservas />

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
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
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
                  name="dias_semana"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Días activos</FormLabel>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {diasSemana.map((dia) => (
                          <label
                            key={dia.id}
                            className={`
                              flex items-center justify-center w-10 h-10 pointer-coarse:w-11 pointer-coarse:h-11 rounded-full cursor-pointer border-2 text-sm font-medium
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
                          <SelectItem value="all">Todos los espacios (generales)</SelectItem>
                          {salasDeCasaTomas.map((espacio: any) => (
                            <SelectItem key={espacio.id} value={espacio.id}>
                              {espacio.nombre}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Los generales valen para todo el restaurante. Un espacio con turnos propios usa los suyos; si no, los generales.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Escalera de horas: modo simple (2 columnas, como hasta hoy) o
                    avanzado (lista de niveles, migración 20260921000000). */}
                <FormField
                  control={form.control}
                  name="modo_escalera"
                  render={({ field }) => (
                    <FormItem>
                      <Tabs value={field.value} onValueChange={(v) => field.onChange(v as "legacy" | "avanzado")}>
                        <TabsList className="grid w-full grid-cols-2">
                          <TabsTrigger value="legacy">Modo simple</TabsTrigger>
                          <TabsTrigger value="avanzado">
                            <Layers className="h-3.5 w-3.5 mr-1.5" />
                            Escalera avanzada
                          </TabsTrigger>
                        </TabsList>

                        <TabsContent value="legacy" className="space-y-4 pt-4">
                          <FormField
                            control={form.control}
                            name="intervalo_base_minutos"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Intervalo base (minutos)</FormLabel>
                                <Select value={field.value.toString()} onValueChange={(v) => field.onChange(parseInt(v))}>
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
                                <FormLabel>Umbral de ocupación para abrir turno intermedio: {field.value}%</FormLabel>
                                <FormControl>
                                  <Slider
                                    value={[field.value]}
                                    onValueChange={(v) => field.onChange(v[0])}
                                    min={0}
                                    max={100}
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
                            name="ocultar_primario_si_secundario"
                            render={({ field }) => (
                              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                                <div className="space-y-0.5">
                                  <FormLabel>Ocultar turno primario al abrir secundario</FormLabel>
                                  <FormDescription>
                                    Si está activo, cuando se abra un turno intermedio (ej: 13:15), el turno primario (13:00) dejará de mostrarse
                                  </FormDescription>
                                </div>
                                <FormControl>
                                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                                </FormControl>
                              </FormItem>
                            )}
                          />

                          <p className="text-xs text-muted-foreground">
                            Solo dos niveles: horas en punto y un intermedio. Para más niveles (por ejemplo, cuartos de
                            hora), pasa a "Escalera avanzada" — no se pierde nada al cambiar.
                          </p>
                        </TabsContent>

                        <TabsContent value="avanzado" className="pt-4">
                          <EscaleraTurnoEditor
                            niveles={form.watch("niveles_escalera") as NivelEscalera[]}
                            onChangeNiveles={(n) => form.setValue("niveles_escalera", n, { shouldDirty: true })}
                            ocultarNivelAnterior={form.watch("ocultar_nivel_anterior")}
                            onChangeOcultar={(v) => form.setValue("ocultar_nivel_anterior", v, { shouldDirty: true })}
                            baseUmbral={form.watch("base_umbral")}
                            onChangeBaseUmbral={(v) => form.setValue("base_umbral", v, { shouldDirty: true })}
                            horaInicio={form.watch("hora_inicio")}
                            horaFin={form.watch("hora_fin")}
                            espacioId={form.watch("espacio_id")}
                            capacidadTotal={capacidadTotalActiva}
                            migradaDeLegacy={origenEscaleraAlAbrir === "legacy"}
                          />
                        </TabsContent>
                      </Tabs>
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
                <li>El turno ofrece primero horas en punto. Cada nivel más fino (medias, cuartos...) se abre solo cuando el nivel anterior llega a su umbral de ocupación</li>
                <li>Un nivel fino nunca aparece si el nivel del que depende no se está ofreciendo</li>
                <li>En "Escalera avanzada" puedes añadir tantos niveles como necesites (hasta 8) en vez de los dos fijos del modo simple, y ver una previsualización en vivo de qué horas se ofrecerían</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de configuraciones */}
      <div className="grid gap-4 lg:grid-cols-2">
        {configuracionesConEscalera.map(({ config, enAvanzado, ...escalera }) => (
          <Card key={config.id} className={!config.activo ? "opacity-60" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{config.nombre_periodo}</CardTitle>
                </div>
                <div className="flex items-center gap-2 pointer-coarse:gap-3">
                  <Switch
                    checked={config.activo}
                    onCheckedChange={() => handleToggleActivo(config)}
                    aria-label={`Periodo ${config.nombre_periodo} activo`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(config)}
                    aria-label={`Editar el periodo ${config.nombre_periodo}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIdAEliminar(config.id)}
                    aria-label={`Eliminar el periodo ${config.nombre_periodo}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CardDescription className="flex flex-wrap items-center gap-1.5">
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

              {enAvanzado && "niveles" in escalera ? (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5" />
                      Escalera:
                    </span>
                    <div className="flex flex-wrap justify-end gap-1">
                      {escalera.niveles.map((n) => (
                        <Badge key={n.minutos} variant="secondary" className="gap-1">
                          {etiquetaNivelLocal(n.minutos)} · {n.umbral}%
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Umbral medido sobre:</span>
                    <span className="font-medium">
                      {escalera.baseUmbral === "reparto_nivel_base" ? "reparto por hora" : "aforo completo"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Ocultar nivel anterior:</span>
                    <Badge variant={escalera.ocultar ? "default" : "outline"}>{escalera.ocultar ? "Sí" : "No"}</Badge>
                  </div>
                </>
              ) : (
                <>
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
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Ocultar primario:</span>
                    <Badge variant={config.ocultar_primario_si_secundario ? "default" : "outline"}>
                      {config.ocultar_primario_si_secundario ? "Sí" : "No"}
                    </Badge>
                  </div>
                </>
              )}

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

      <AlertDialog open={!!idAEliminar} onOpenChange={(abierto) => !abierto && setIdAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este periodo?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra la configuración del periodo de servicio. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = idAEliminar;
                setIdAEliminar(null);
                if (id) void handleDelete(id);
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
