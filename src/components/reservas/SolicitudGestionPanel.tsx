import { useMemo, useState } from "react";
import { format, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarIcon,
  CalendarPlus,
  Info,
  Loader2,
  Mail,
  PhoneCall,
  PhoneOff,
  RotateCcw,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ResultadoPropuesta, SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";
import {
  estadoPropuestaVista,
  motivoNoEnviar,
  TEXTO_MOTIVO_NO_ENVIAR,
  tieneColumnasPropuesta,
} from "@/lib/reservas/propuestaCliente";
import { EstadoPropuestaBadge } from "./EstadoPropuestaBadge";
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
  puedePersistirSala,
  type PropuestaSolicitud,
} from "@/lib/reservas/solicitudPropuesta";
import { esSolicitudAbierta } from "@/lib/reservas/vistaUnificada";
import { validarContactoReserva, type ContactoReserva } from "@/lib/reservas/altaPanel";
import { SolicitudCard } from "./GestionSolicitudes";
import { OcupacionSalas } from "./OcupacionSalas";

// ============================================================================
// Diálogo "Solicitud pendiente del bot": tarjeta de siempre + edición de
// día/hora/comensales/sala + rejilla de ocupación de salas para decidir.
// Qué se persiste y dónde: ver cabecera de src/lib/reservas/solicitudPropuesta.ts.
// "Enviar al cliente": correo con la propuesta (emails-reserva) o, si el
// cliente respondió por teléfono, registrar su aceptación/rechazo. Ver
// src/lib/reservas/propuestaCliente.ts y la migración 20260923210000.
// ============================================================================

type AccionConfirmar = "enviar" | "aceptar" | "rechazar" | null;

const SIN_ASIGNAR = "__sin_asignar__";
const OTRA_HORA = "__otra__";

export interface SolicitudGestionPanelProps {
  solicitud: SolicitudPendiente;
  onUpdateEstado: (id: string, estado: string) => Promise<boolean>;
  onUpdateNotas: (id: string, notas: string) => Promise<boolean>;
  onGuardarPropuesta: (
    id: string,
    cambios: NonNullable<ReturnType<typeof actualizacionPropuesta>>,
    opciones?: { silencioso?: boolean },
  ) => Promise<boolean>;
  /** Si se pasa, aparece "Convertir en reserva" con la propuesta editada. */
  onConvertir?: (solicitud: SolicitudPendiente, propuesta: PropuestaSolicitud) => void;
  /** Envía el correo de propuesta (lo guardado en la solicitud). */
  onEnviarPropuesta?: (id: string) => Promise<boolean>;
  /** El cliente aceptó por teléfono: guarda teléfono + email (obligatorios)
   * en la solicitud y crea la reserva con lo guardado; el cliente recibe un
   * correo para confirmarla. */
  onAceptarTelefono?: (id: string, contacto: ContactoReserva) => Promise<ResultadoPropuesta>;
  /** El cliente rechazó por teléfono. */
  onRechazarTelefono?: (id: string) => Promise<ResultadoPropuesta>;
}

export function SolicitudGestionPanel({
  solicitud,
  onUpdateEstado,
  onUpdateNotas,
  onGuardarPropuesta,
  onConvertir,
  onEnviarPropuesta,
  onAceptarTelefono,
  onRechazarTelefono,
}: SolicitudGestionPanelProps) {
  const original = useMemo(() => peticionOriginal(solicitud), [solicitud]);
  const guardada = useMemo(() => peticionGuardada(solicitud), [solicitud]);
  const persistirSala = puedePersistirSala(solicitud);

  const [propuesta, setPropuesta] = useState<PropuestaSolicitud>(() => ({
    ...guardada,
    espacioId: solicitud.espacio_propuesto_id ?? null,
  }));
  const [guardando, setGuardando] = useState(false);
  const [confirmar, setConfirmar] = useState<AccionConfirmar>(null);
  const [ejecutando, setEjecutando] = useState(false);
  // Teléfono y email del paso "aceptó por teléfono" (obligatorios; se
  // prerrellenan con lo que dejó el cliente al bot).
  const [contactoTelefono, setContactoTelefono] = useState(solicitud.telefono ?? "");
  const [contactoEmail, setContactoEmail] = useState(solicitud.email ?? "");
  const [erroresContacto, setErroresContacto] = useState<{ telefono: string | null; email: string | null }>({
    telefono: null,
    email: null,
  });

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
  const pendienteDeGuardar = actualizacionPropuesta(solicitud, propuesta, { persistirSala });
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

  // --- Propuesta al cliente -------------------------------------------------
  const hoy = format(new Date(), "yyyy-MM-dd");
  const conMigracion = tieneColumnasPropuesta(solicitud);
  const vistaEstado = estadoPropuestaVista(solicitud, hoy);
  const propuestaCompleta = !!propuesta.fecha && !!propuesta.hora && !!propuesta.comensales;
  const sinAforo = !!evaluacion && !evaluacion.cabeAforo;
  // Se valida lo que QUEDARÁ guardado (la propuesta en pantalla), no la fila.
  const motivoEnvio = motivoNoEnviar(
    {
      ...solicitud,
      fecha_solicitada: propuesta.fecha,
      hora_solicitada: propuesta.hora,
      numero_comensales: propuesta.comensales,
    },
    hoy,
  );
  const tieneEmail = !!solicitud.email?.trim();
  const yaAceptada = solicitud.propuesta_estado === "aceptada";
  const mostrarRespuesta = conMigracion && abierta && !yaAceptada;

  /** Guarda lo pendiente (en silencio) antes de enviar/aceptar: el correo y
   * la reserva salen de lo GUARDADO en la solicitud. */
  const guardarSiHaceFalta = async () => {
    if (!pendienteDeGuardar) return true;
    return onGuardarPropuesta(solicitud.id, pendienteDeGuardar, { silencioso: true });
  };

  const ejecutarConfirmado = async () => {
    const accion = confirmar;
    if (!accion) return;
    // Antes de nada: teléfono y email válidos. Si faltan, el diálogo sigue
    // abierto con el error en cada campo.
    let contacto: ContactoReserva | null = null;
    if (accion === "aceptar") {
      const validacion = validarContactoReserva({ telefono: contactoTelefono, email: contactoEmail });
      setErroresContacto(validacion.errores);
      if (!validacion.contacto) return;
      contacto = validacion.contacto;
    }
    setEjecutando(true);
    try {
      if (accion === "rechazar") {
        await onRechazarTelefono?.(solicitud.id);
        return;
      }
      if (accion === "aceptar") {
        if (!(await guardarSiHaceFalta())) return;
        await onAceptarTelefono?.(solicitud.id, contacto as ContactoReserva);
        return;
      }
      if (!(await guardarSiHaceFalta())) return;
      await onEnviarPropuesta?.(solicitud.id);
    } finally {
      setEjecutando(false);
      setConfirmar(null);
    }
  };

  const resumenPropuesta = `${fechaLegible(propuesta.fecha)} a las ${propuesta.hora ?? "—"}, ${
    propuesta.comensales ?? "—"
  } personas${propuesta.espacioId ? `, ${nombreSala(propuesta.espacioId)}` : ""}`;

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
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="propuesta-solicitud-titulo" className="text-sm font-semibold">
                Propuesta al cliente
              </h3>
              {vistaEstado && <EstadoPropuestaBadge vista={vistaEstado} />}
            </div>
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
                // (el cliente nunca pide sala: "—" en la columna "Pidió")
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
              title={
                persistirSala
                  ? "Guarda día, hora, comensales y sala en la solicitud"
                  : "Guarda día, hora y comensales en la solicitud (la sala se aplica al convertir)"
              }
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
              {persistirSala
                ? '"Guardar cambios" guarda día, hora, comensales y sala en la solicitud y anota en las notas internas lo que pidió el cliente.'
                : '"Guardar cambios" actualiza día, hora y comensales de la solicitud y anota en las notas internas lo que pidió el cliente. La sala no se guarda hasta aplicar la migración 20260923210000: se aplica al convertirla en reserva.'}
            </span>
          </p>

          {/* Respuesta del cliente: correo con enlace o registro por teléfono */}
          {mostrarRespuesta && (
            <div role="group" className="space-y-2 border-t pt-3" aria-labelledby="respuesta-cliente-titulo">
              <h4 id="respuesta-cliente-titulo" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Respuesta del cliente
              </h4>
              {vistaEstado && <p className="text-xs text-muted-foreground">{vistaEstado.detalle}</p>}
              {solicitud.propuesta_error === "sin_aforo" && (
                <p role="alert" className="text-xs text-red-700 dark:text-red-300">
                  El último intento de aceptar falló por falta de aforo en el turno.
                </p>
              )}
              {!tieneEmail && (
                <p className="flex gap-1.5 rounded-md bg-muted p-2 text-xs">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {TEXTO_MOTIVO_NO_ENVIAR.sin_email}
                </p>
              )}
              {sinAforo && (
                <p className="text-xs text-red-700 dark:text-red-300">Sin aforo en ese turno: cambia la propuesta antes de enviarla o aceptarla.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {tieneEmail && onEnviarPropuesta && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setConfirmar("enviar")}
                    disabled={!!motivoEnvio || sinAforo || ejecutando}
                    title={motivoEnvio ? TEXTO_MOTIVO_NO_ENVIAR[motivoEnvio] : undefined}
                  >
                    <Mail className="mr-1 h-4 w-4" aria-hidden />
                    {solicitud.propuesta_estado === "enviada" ? "Reenviar propuesta" : "Enviar propuesta por email"}
                  </Button>
                )}
                {onAceptarTelefono && (
                  <Button
                    type="button"
                    size="sm"
                    variant={tieneEmail ? "outline" : "default"}
                    onClick={() => {
                      setContactoTelefono(solicitud.telefono ?? "");
                      setContactoEmail(solicitud.email ?? "");
                      setErroresContacto({ telefono: null, email: null });
                      setConfirmar("aceptar");
                    }}
                    disabled={!propuestaCompleta || sinAforo || ejecutando}
                  >
                    <PhoneCall className="mr-1 h-4 w-4" aria-hidden />
                    Registrar que aceptó por teléfono
                  </Button>
                )}
                {onRechazarTelefono && solicitud.propuesta_estado !== "rechazada" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmar("rechazar")}
                    disabled={ejecutando}
                  >
                    <PhoneOff className="mr-1 h-4 w-4" aria-hidden />
                    Rechazó
                  </Button>
                )}
              </div>
              {motivoEnvio && tieneEmail && motivoEnvio !== "sin_email" && (
                <p className="text-[11px] text-muted-foreground">{TEXTO_MOTIVO_NO_ENVIAR[motivoEnvio]}</p>
              )}
            </div>
          )}
          {!conMigracion && abierta && (onEnviarPropuesta || onAceptarTelefono) && (
            <p className="flex gap-1.5 border-t pt-3 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {TEXTO_MOTIVO_NO_ENVIAR.sin_migracion} Mientras tanto, usa "Convertir en reserva".
            </p>
          )}
        </section>

        <AlertDialog open={!!confirmar} onOpenChange={(open) => !open && !ejecutando && setConfirmar(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmar === "enviar"
                  ? "¿Enviar la propuesta al cliente?"
                  : confirmar === "aceptar"
                    ? "¿Crear la reserva?"
                    : "¿Registrar que el cliente rechazó?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmar === "enviar" &&
                  `Se enviará un correo a ${solicitud.email} con ${resumenPropuesta}. Podrá aceptarla o rechazarla desde el enlace; si acepta, la reserva se crea confirmada.${
                    solicitud.propuesta_estado === "enviada" ? " El enlace del correo anterior dejará de funcionar." : ""
                  }`}
                {confirmar === "aceptar" &&
                  `Se creará la reserva de ${solicitud.nombre || "el cliente"}: ${resumenPropuesta}. La solicitud quedará resuelta y se enviará al cliente un correo para que confirme su reserva.`}
                {confirmar === "rechazar" &&
                  "La propuesta quedará como rechazada y la solicitud seguirá abierta para proponer otra cosa o descartarla."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {confirmar === "aceptar" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="aceptar-telefono">Teléfono</Label>
                  <Input
                    id="aceptar-telefono"
                    type="tel"
                    autoComplete="off"
                    value={contactoTelefono}
                    onChange={(e) => setContactoTelefono(e.target.value)}
                    aria-invalid={!!erroresContacto.telefono}
                    aria-describedby={erroresContacto.telefono ? "aceptar-telefono-error" : undefined}
                    disabled={ejecutando}
                  />
                  {erroresContacto.telefono && (
                    <p id="aceptar-telefono-error" role="alert" className="text-xs text-destructive">
                      {erroresContacto.telefono}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="aceptar-email">Email</Label>
                  <Input
                    id="aceptar-email"
                    type="email"
                    autoComplete="off"
                    placeholder="cliente@email.com"
                    value={contactoEmail}
                    onChange={(e) => setContactoEmail(e.target.value)}
                    aria-invalid={!!erroresContacto.email}
                    aria-describedby={erroresContacto.email ? "aceptar-email-error" : undefined}
                    disabled={ejecutando}
                  />
                  {erroresContacto.email && (
                    <p id="aceptar-email-error" role="alert" className="text-xs text-destructive">
                      {erroresContacto.email}
                    </p>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground sm:col-span-2">
                  Los dos son obligatorios y se guardan en la solicitud y en la reserva.
                </p>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={ejecutando}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={ejecutando}
                onClick={(e) => {
                  e.preventDefault();
                  void ejecutarConfirmado();
                }}
              >
                {ejecutando && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
                {confirmar === "enviar" ? "Enviar" : confirmar === "aceptar" ? "Crear reserva" : "Registrar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
