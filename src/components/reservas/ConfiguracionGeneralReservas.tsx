import { useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ShieldCheck, Clock, Users, Mail, Phone, CalendarDays, Loader2, UtensilsCrossed, Timer, LayoutGrid } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useForm, type Resolver, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  useConfiguracionReservas,
  useActualizarConfiguracionReservas,
} from "@/hooks/useConfiguracionReservas";
import { useEspaciosReserva, type EspacioReserva } from "@/hooks/useEspaciosReserva";
import { useMesas, type Mesa } from "@/hooks/useMesas";
import {
  VENTANA_HORAS_MAX,
  VENTANA_HORAS_MIN,
  VENTANA_HORAS_POR_DEFECTO,
  configAsignacionDesde,
  crearEsquemaConfigAsignacion,
  excluirSala,
  incluirSala,
} from "@/lib/reservas/ventanaAsignacion";
import { salaAdmiteReservas } from "@/lib/reservas/negocios";
import { GestionMesasEspacios } from "./GestionMesasEspacios";

const baseSchema = z.object({
  minutos_corte_antes_servicio: z.number().min(0).max(1440),
  max_reservas_por_telefono_dia: z.number().min(1).max(50),
  max_reservas_por_email_dia: z.number().min(1).max(50),
  max_comensales_por_reserva: z.number().min(1).max(100),
  min_comensales_por_reserva: z.number().min(1).max(50),
  dias_max_antelacion: z.number().min(1).max(365),
  telefono_obligatorio: z.boolean(),
  email_obligatorio: z.boolean(),
  auto_confirmar: z.boolean(),
  // Modo servicio (Fase 4): umbrales de tiempo del plano en vivo. Columnas
  // nuevas de configuracion_reservas (20260926150000_modo_servicio_config_y_salida.sql).
  estancia_comida_minutos: z.number().min(15).max(480),
  estancia_cena_minutos: z.number().min(15).max(480),
  retraso_gracia_minutos: z.number().min(0).max(180),
});

/**
 * Esquema completo: el base + los cuatro campos del panel de asignación
 * (reservas-sin-salas, Fase B). Depende de las mesas porque una mesa usable de
 * una sala no usable se rechaza (ver `crearEsquemaConfigAsignacion`).
 */
const crearConfigSchema = (mesas: readonly { id: string; espacio_id: string }[]) =>
  baseSchema.and(crearEsquemaConfigAsignacion(mesas));

type ConfigFormValues = z.infer<ReturnType<typeof crearConfigSchema>>;

const ordenNatural = (a: { nombre: string }, b: { nombre: string }) =>
  a.nombre.localeCompare(b.nombre, "es", { numeric: true });

export function ConfiguracionGeneralReservas() {
  const { data: config, isLoading } = useConfiguracionReservas();
  const actualizarMutation = useActualizarConfiguracionReservas();
  const { data: espaciosData } = useEspaciosReserva();
  const { data: mesasData } = useMesas();

  // Salas activas de Casa Tomás: Touza no admite reservas (decisión del dueño,
  // 2026-10-01), así que sus salas no se ofrecen al asignar ni se enseñan.
  const espaciosActivos = useMemo(
    () =>
      ((espaciosData ?? []) as EspacioReserva[])
        .filter((e) => e.activa !== false && salaAdmiteReservas(e))
        .sort(ordenNatural),
    [espaciosData],
  );
  const mesas = useMemo(() => [...((mesasData ?? []) as Mesa[])].sort(ordenNatural), [mesasData]);

  // El esquema depende de las mesas, que llegan después que el formulario: el
  // resolver lee siempre las últimas a través de la ref.
  const mesasRef = useRef<readonly Mesa[]>(mesas);
  mesasRef.current = mesas;
  const resolver = useMemo<Resolver<ConfigFormValues>>(
    () => (valores, contexto, opciones) =>
      zodResolver(crearConfigSchema(mesasRef.current))(valores, contexto, opciones),
    [],
  );

  const form = useForm<ConfigFormValues>({
    resolver,
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
      estancia_comida_minutos: 105,
      estancia_cena_minutos: 120,
      retraso_gracia_minutos: 15,
      asignacion_ventana_horas: VENTANA_HORAS_POR_DEFECTO,
      asignacion_aviso_activo: true,
      asignacion_espacios_excluidos: [],
      asignacion_mesas_excluidas: [],
    },
  });

  useEffect(() => {
    if (config) {
      const asignacion = configAsignacionDesde(config);
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
        // Ausentes si la migración de modo servicio aún no está aplicada: caen
        // en el default del producto, nunca en `undefined`/`null` en el form.
        estancia_comida_minutos: config.estancia_comida_minutos ?? 105,
        estancia_cena_minutos: config.estancia_cena_minutos ?? 120,
        retraso_gracia_minutos: config.retraso_gracia_minutos ?? 15,
        // Igual con las de asignación (migración 20260930110000).
        asignacion_ventana_horas: asignacion.ventanaHoras,
        asignacion_aviso_activo: asignacion.avisoActivo,
        asignacion_espacios_excluidos: asignacion.espaciosExcluidos,
        asignacion_mesas_excluidas: asignacion.mesasExcluidas,
      });
    }
  }, [config, form]);

  const onSubmit = async (values: ConfigFormValues) => {
    try {
      const guardada = await actualizarMutation.mutateAsync(values);
      // Si la migración de asignación aún no está aplicada, el hook guarda el
      // resto y descarta esas columnas: se dice, para no dar por guardado lo
      // que no lo está.
      if (guardada && !("asignacion_ventana_horas" in guardada)) {
        toast.warning("Configuración guardada, salvo la de asignación", {
          description: "Los ajustes de asignación de salas y mesas aún no están disponibles en la base de datos.",
        });
      } else {
        toast.success("Configuración guardada correctamente");
      }
    } catch (error) {
      toast.error("Error al guardar la configuración");
    }
  };

  // Las reglas generales y la gestión de mesas son dos tarjetas independientes
  // de esta misma pestaña: si las reglas todavía están cargando, la de mesas
  // (que tiene sus propias consultas) se pinta igualmente en vez de quedarse
  // toda la pestaña detrás de un spinner.
  if (isLoading) {
    return (
      <>
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
        <GestionMesasEspacios />
      </>
    );
  }

  return (
    <>
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
                            type="number" inputMode="numeric"
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
                            type="number" inputMode="numeric"
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
                          type="number" inputMode="numeric"
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
                          type="number" inputMode="numeric"
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
                          type="number" inputMode="numeric"
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
                          type="number" inputMode="numeric"
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
                          Requerir teléfono en la web de reservas (en el panel siempre es obligatorio)
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
                          Requerir email en la web de reservas (en el panel es opcional)
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
                          No afecta a las reservas creadas desde el panel: si tienen email, el cliente recibe un correo para confirmarlas
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

            <Separator />

            {/* Modo servicio (Fase 4): umbrales de tiempo del plano en vivo */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Timer className="h-4 w-4 text-muted-foreground" />
                Modo servicio (plano en vivo)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6">
                <FormField
                  control={form.control}
                  name="estancia_comida_minutos"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <UtensilsCrossed className="h-3.5 w-3.5" />
                        Estancia estimada · Comida
                      </FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number" inputMode="numeric"
                            min={15}
                            max={480}
                            className="w-24"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 15)}
                          />
                          <span className="text-sm text-muted-foreground">minutos</span>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Pasado este tiempo desde que se sentó, el plano marca la mesa como "por liberar"
                      </FormDescription>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="estancia_cena_minutos"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <UtensilsCrossed className="h-3.5 w-3.5" />
                        Estancia estimada · Cena
                      </FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number" inputMode="numeric"
                            min={15}
                            max={480}
                            className="w-24"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 15)}
                          />
                          <span className="text-sm text-muted-foreground">minutos</span>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Las cenas suelen alargarse más que las comidas: por eso es un valor aparte
                      </FormDescription>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="retraso_gracia_minutos"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        Margen antes de marcar retraso
                      </FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number" inputMode="numeric"
                            min={0}
                            max={180}
                            className="w-24"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                          />
                          <span className="text-sm text-muted-foreground">minutos</span>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Minutos tras la hora de la reserva antes de que el plano la pinte "retrasada". No cancela ni modifica la reserva.
                      </FormDescription>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* Asignación interna (reservas-sin-salas, Fase B) */}
            <SeccionAsignacion form={form} espacios={espaciosActivos} mesas={mesas} />

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

    {/* Mesas por espacio + aviso de descuadre entre capacidad declarada y
        plazas de las mesas. Vive aquí y no en `Reservas.tsx` para no tocar el
        enrutado de pestañas: esta tarjeta ya se pinta dentro de la pestaña
        Configuración. */}
    <GestionMesasEspacios />
    </>
  );
}

// ----------------------------------------------------------------------------
// Asignación interna de salas y mesas
// ----------------------------------------------------------------------------

/**
 * Ventana del panel "Asignación", aviso en la campana y qué salas y mesas se
 * ofrecen al asignar. Las listas se guardan como EXCLUSIONES (una sala nueva
 * es usable sin tocar nada) y nunca cambian el aforo del turno.
 */
function SeccionAsignacion({
  form,
  espacios,
  mesas,
}: {
  form: UseFormReturn<ConfigFormValues>;
  espacios: EspacioReserva[];
  mesas: Mesa[];
}) {
  const espaciosExcluidos = form.watch("asignacion_espacios_excluidos");
  const mesasExcluidas = form.watch("asignacion_mesas_excluidas");
  const salasFuera = new Set(espaciosExcluidos);
  const mesasFuera = new Set(mesasExcluidas);

  const alternarSala = (espacioId: string, usable: boolean) => {
    const actuales = { espaciosExcluidos, mesasExcluidas };
    const siguiente = usable ? incluirSala(actuales, espacioId, mesas) : excluirSala(actuales, espacioId, mesas);
    form.setValue("asignacion_espacios_excluidos", siguiente.espaciosExcluidos, { shouldDirty: true });
    form.setValue("asignacion_mesas_excluidas", siguiente.mesasExcluidas, { shouldDirty: true, shouldValidate: true });
  };

  const alternarMesa = (mesaId: string, usable: boolean) => {
    const siguiente = usable ? mesasExcluidas.filter((id) => id !== mesaId) : [...mesasExcluidas, mesaId];
    form.setValue("asignacion_mesas_excluidas", siguiente, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <LayoutGrid className="h-4 w-4 text-muted-foreground" />
        Asignación interna de salas y mesas
      </div>
      <div className="space-y-4 pl-6">
        <p className="text-sm text-muted-foreground">
          El cliente solo reserva una hora; la sala y la mesa las decide el equipo desde la pestaña «Próximas reservas».
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="asignacion_ventana_horas"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Resaltar reservas de las próximas</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" inputMode="numeric"
                      min={VENTANA_HORAS_MIN}
                      max={VENTANA_HORAS_MAX}
                      step={1}
                      className="w-24"
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={Number.isFinite(field.value) ? field.value : ""}
                      // Vacío -> NaN, para que la validación lo rechace en vez
                      // de guardarlo como 0 o como el mínimo sin avisar.
                      onChange={(e) => field.onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
                    />
                    <span className="text-sm text-muted-foreground">horas</span>
                  </div>
                </FormControl>
                <FormDescription>
                  Salen arriba del panel. Solo resalta: se puede asignar cualquier reserva, esté o no en la ventana.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="asignacion_aviso_activo"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="space-y-0.5">
                  <FormLabel>Avisar en la campana</FormLabel>
                  <FormDescription>
                    Un aviso por reserva que entre en la ventana sin sala o sin mesa
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="asignacion_mesas_excluidas"
          render={() => (
            <FormItem className="space-y-3">
              <div className="space-y-0.5">
                <FormLabel>Salas y mesas que se ofrecen al asignar</FormLabel>
                <FormDescription>
                  Desmarca las que no quieras que se usen. No cambia el aforo del turno, y las reservas que ya estén
                  en una sala desmarcada se quedan en ella (el panel las señala).
                </FormDescription>
              </div>
              {espacios.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay salas activas.</p>
              ) : (
                <div className="space-y-2">
                  {espacios.map((espacio) => {
                    const salaUsable = !salasFuera.has(espacio.id);
                    const mesasSala = mesas.filter((m) => m.espacio_id === espacio.id);
                    const idSala = `usable-sala-${espacio.id}`;
                    return (
                      <div key={espacio.id} className="space-y-2 rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={idSala}
                            checked={salaUsable}
                            onCheckedChange={(v) => alternarSala(espacio.id, v === true)}
                          />
                          <label htmlFor={idSala} className="text-sm font-medium">
                            {espacio.nombre}
                          </label>
                          <span className="text-xs text-muted-foreground">
                            {salaUsable ? "Se ofrece" : "No se ofrece"}
                          </span>
                        </div>
                        {mesasSala.length > 0 && (
                          <div className="flex flex-wrap gap-x-4 gap-y-2 pl-6">
                            {mesasSala.map((mesa) => {
                              const idMesa = `usable-mesa-${mesa.id}`;
                              return (
                                <div key={mesa.id} className="flex items-center gap-1.5">
                                  <Checkbox
                                    id={idMesa}
                                    checked={salaUsable && !mesasFuera.has(mesa.id)}
                                    disabled={!salaUsable}
                                    onCheckedChange={(v) => alternarMesa(mesa.id, v === true)}
                                  />
                                  <label
                                    htmlFor={idMesa}
                                    className={cn("text-sm tabular-nums", !salaUsable && "text-muted-foreground")}
                                  >
                                    {mesa.nombre}
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
