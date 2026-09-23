import { useMemo, useState } from "react";
import { format, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, CalendarIcon, CalendarPlus, Info, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";
import { useOcupacionSalasDia } from "@/hooks/useOcupacionSalasDia";
import {
  calcularOcupacionSalas,
  construirFranjas,
  ETIQUETA_TURNO,
  evaluarUbicacion,
  horaCorta,
} from "@/lib/reservas/ocupacionSalas";
import {
  actualizacionPropuesta,
  diferenciasPeticion,
  fechaLegible,
  peticionGuardada,
  peticionOriginal,
  type PropuestaSolicitud,
} from "@/lib/reservas/solicitudPropuesta";
import { esSolicitudAbierta } from "@/lib/reservas/vistaUnificada";
import { SolicitudCard } from "./GestionSolicitudes";
import { OcupacionSalas } from "./OcupacionSalas";

// ============================================================================
// Diálogo "Solicitud pendiente del bot": tarjeta de siempre + edición de
// día/hora/comensales/sala + rejilla de ocupación de salas para decidir.
// Qué se persiste y dónde: ver cabecera de src/lib/reservas/solicitudPropuesta.ts.
// ============================================================================

const SIN_ASIGNAR = "__sin_asignar__";
const OTRA_HORA = "__otra__";

export interface SolicitudGestionPanelProps {
  solicitud: SolicitudPendiente;
  onUpdateEstado: (id: string, estado: string) => Promise<boolean>;
  onUpdateNotas: (id: string, notas: string) => Promise<boolean>;
  onGuardarPropuesta: (
    id: string,
    cambios: NonNullable<ReturnType<typeof actualizacionPropuesta>>,
  ) => Promise<boolean>;
  /** Si se pasa, aparece "Convertir en reserva" con la propuesta editada. */
  onConvertir?: (solicitud: SolicitudPendiente, propuesta: PropuestaSolicitud) => void;
}

export function SolicitudGestionPanel({
  solicitud,
  onUpdateEstado,
  onUpdateNotas,
  onGuardarPropuesta,
  onConvertir,
}: SolicitudGestionPanelProps) {
  const original = useMemo(() => peticionOriginal(solicitud), [solicitud]);
  const guardada = useMemo(() => peticionGuardada(solicitud), [solicitud]);

  const [propuesta, setPropuesta] = useState<PropuestaSolicitud>(() => ({ ...guardada, espacioId: null }));
  const [guardando, setGuardando] = useState(false);

  const { data, horasBase } = useOcupacionSalasDia(propuesta.fecha);
  const espacios = data?.espacios ?? [];

  const opcionesHora = useMemo(() => {
    const f = construirFranjas(horasBase);
    return [...f.comida, ...f.cena];
  }, [horasBase]);
  const horaPersonalizada = !!data && !!propuesta.hora && !opcionesHora.includes(propuesta.hora);
  const [modoOtraHora, setModoOtraHora] = useState(false);
  const mostrarInputHora = modoOtraHora || horaPersonalizada;

  const evaluacion = useMemo(() => {
    if (!data) return null;
    const ocupacion = calcularOcupacionSalas({
      espacios: data.espacios,
      reservas: data.reservas,
      horasBase: data.horasBase,
      comensales: propuesta.comensales ?? 0,
    });
    return evaluarUbicacion(ocupacion, propuesta.espacioId, propuesta.hora);
  }, [data, propuesta.comensales, propuesta.espacioId, propuesta.hora]);

  const cambiosVsOriginal = diferenciasPeticion(original, propuesta);
  const pendienteDeGuardar = actualizacionPropuesta(solicitud, propuesta);
  const nombreSala = (id: string | null) =>
    id ? espacios.find((e) => e.id === id)?.nombre ?? "Sala" : "Sin asignar";

  const set = (cambios: Partial<PropuestaSolicitud>) => setPropuesta((p) => ({ ...p, ...cambios }));

  const guardar = async () => {
    if (!pendienteDeGuardar) return;
    setGuardando(true);
    try {
      await onGuardarPropuesta(solicitud.id, pendienteDeGuardar);
    } finally {
      setGuardando(false);
    }
  };

  const volverAOriginal = () => {
    setModoOtraHora(false);
    setPropuesta((p) => ({ ...original, espacioId: p.espacioId }));
  };

  const abierta = esSolicitudAbierta(solicitud.estado);
  const fechaDate = propuesta.fecha ? new Date(`${propuesta.fecha}T12:00:00`) : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Columna izquierda: la solicitud + la propuesta editable */}
      <div className="min-w-0 space-y-4">
        <SolicitudCard
          solicitud={solicitud}
          onUpdateEstado={onUpdateEstado}
          onUpdateNotas={onUpdateNotas}
          defaultExpanded
        />

        <section aria-labelledby="propuesta-solicitud-titulo" className="space-y-3 rounded-lg border p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 id="propuesta-solicitud-titulo" className="text-sm font-semibold">
              Propuesta al cliente
            </h3>
            {cambiosVsOriginal.alguna && (
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={volverAOriginal}>
                <RotateCcw className="mr-1 h-3 w-3" aria-hidden />
                Volver a lo que pidió
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="propuesta-fecha">Día</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="propuesta-fecha"
                    type="button"
                    variant="outline"
                    className={cn("w-full justify-start text-left font-normal", !fechaDate && "text-muted-foreground")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" aria-hidden />
                    {fechaDate ? format(fechaDate, "EEE d MMM yyyy", { locale: es }) : "Elegir día"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fechaDate}
                    onSelect={(d) => d && set({ fecha: format(d, "yyyy-MM-dd") })}
                    disabled={(d) => d < startOfDay(new Date())}
                    initialFocus
                    locale={es}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="propuesta-hora">Hora</Label>
              {mostrarInputHora ? (
                <div className="flex gap-2">
                  <Input
                    id="propuesta-hora"
                    type="time"
                    step={300}
                    value={propuesta.hora ?? ""}
                    onChange={(e) => set({ hora: horaCorta(e.target.value) })}
                  />
                  {opcionesHora.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-10 shrink-0 text-xs"
                      onClick={() => {
                        setModoOtraHora(false);
                        if (horaPersonalizada) set({ hora: null });
                      }}
                    >
                      Turnos
                    </Button>
                  )}
                </div>
              ) : (
                <Select
                  value={propuesta.hora ?? undefined}
                  onValueChange={(v) => (v === OTRA_HORA ? setModoOtraHora(true) : set({ hora: v }))}
                >
                  <SelectTrigger id="propuesta-hora">
                    <SelectValue placeholder="Elegir hora" />
                  </SelectTrigger>
                  <SelectContent>
                    {opcionesHora.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTRA_HORA}>Otra hora…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="propuesta-comensales">Comensales</Label>
              <Input
                id="propuesta-comensales"
                type="number"
                inputMode="numeric"
                min={1}
                value={propuesta.comensales ?? ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  set({ comensales: Number.isFinite(n) && n > 0 ? n : null });
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="propuesta-sala">Sala</Label>
              <Select
                value={propuesta.espacioId ?? SIN_ASIGNAR}
                onValueChange={(v) => set({ espacioId: v === SIN_ASIGNAR ? null : v })}
              >
                <SelectTrigger id="propuesta-sala">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_ASIGNAR}>Sin asignar</SelectItem>
                  {espacios.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre} ({e.capacidad_maxima} plazas)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Pidió → Propuesta */}
          <table className="w-full text-xs">
            <caption className="sr-only">Lo que pidió el cliente frente a la propuesta</caption>
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="py-1 text-left font-normal"></th>
                <th scope="col" className="py-1 text-left font-normal">Pidió el cliente</th>
                <th scope="col" className="py-1 text-left font-normal">Propuesta</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[
                { k: "Día", a: fechaLegible(original.fecha), b: fechaLegible(propuesta.fecha), cambia: cambiosVsOriginal.fecha },
                { k: "Hora", a: original.hora ?? "—", b: propuesta.hora ?? "—", cambia: cambiosVsOriginal.hora },
                {
                  k: "Personas",
                  a: original.comensales ?? "—",
                  b: propuesta.comensales ?? "—",
                  cambia: cambiosVsOriginal.comensales,
                },
                { k: "Sala", a: "—", b: nombreSala(propuesta.espacioId), cambia: false },
              ].map((fila) => (
                <tr key={fila.k} className="border-t">
                  <th scope="row" className="py-1 pr-2 text-left font-medium">
                    {fila.k}
                  </th>
                  <td className={cn("py-1 pr-2", fila.cambia && "text-muted-foreground line-through")}>{fila.a}</td>
                  <td className={cn("py-1", fila.cambia && "font-semibold")}>
                    {fila.b}
                    {fila.cambia && (
                      <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px]">
                        cambiado
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {evaluacion && !evaluacion.cabeAforo && (
            <p role="alert" className="flex gap-2 rounded-md bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              El turno de {ETIQUETA_TURNO[evaluacion.turno].toLowerCase()} no tiene aforo para {propuesta.comensales} más (
              {evaluacion.aforo.ocupados}/{evaluacion.aforo.capacidad}): la base de datos rechazará la reserva. Elige
              otra hora u otro día.
            </p>
          )}
          {evaluacion && evaluacion.cabeAforo && !evaluacion.cabeSala && evaluacion.sala && evaluacion.celda && (
            <p role="status" className="flex gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {evaluacion.sala.nombre} quedaría en {evaluacion.celda.tras}/{evaluacion.celda.capacidad} en el turno de{" "}
              {ETIQUETA_TURNO[evaluacion.turno].toLowerCase()}. Se puede crear igualmente.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {onConvertir && abierta && (
              <Button
                type="button"
                size="sm"
                onClick={() => onConvertir(solicitud, propuesta)}
                disabled={!propuesta.fecha || !propuesta.hora || !propuesta.comensales}
              >
                <CalendarPlus className="mr-1 h-4 w-4" aria-hidden />
                Convertir en reserva
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={guardar}
              disabled={!pendienteDeGuardar || guardando}
              title="Guarda día, hora y comensales en la solicitud (la sala se aplica al convertir)"
            >
              {guardando ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Save className="mr-1 h-4 w-4" aria-hidden />
              )}
              Guardar cambios
            </Button>
          </div>
          <p className="flex gap-1.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>
              "Guardar cambios" actualiza día, hora y comensales de la solicitud y anota en las notas internas lo que
              pidió el cliente. La sala no se guarda en la solicitud: se aplica al convertirla en reserva.
            </span>
          </p>
        </section>
      </div>

      {/* Columna derecha: ocupación para decidir */}
      <div className="min-w-0 lg:border-l lg:pl-6">
        <OcupacionSalas
          fecha={propuesta.fecha}
          comensales={propuesta.comensales ?? 0}
          hora={propuesta.hora}
          espacioId={propuesta.espacioId}
          onSeleccionar={(espacioId, hora) => {
            setModoOtraHora(false);
            set({ espacioId, hora });
          }}
        />
      </div>
    </div>
  );
}
