import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { MARCA_POR_DEFECTO } from "@/hooks/useDisponibilidad";
import { toast } from "sonner";
import {
  CheckCircle,
  CheckCheck,
  XCircle,
  Clock,
  Search,
  Users,
  Calendar,
  Loader2,
  ShieldBan,
  Star,
  Phone,
  Globe,
  Pencil,
  UserX,
  Inbox,
  CalendarPlus,
  Settings2,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ModalVerificacionReserva } from "./ModalVerificacionReserva";
import { BlacklistModal } from "./BlacklistModal";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useCanAccessSection } from "@/hooks/useUserRole";
import {
  type ReservaParaVerificar,
  aceptarComoSolicitado,
  aceptarVariasComoSolicitado,
} from "@/hooks/useVerificacionReservas";
import type { SolicitudPendiente, useSolicitudesPendientes } from "@/hooks/useSolicitudesPendientes";
import { SolicitudCard, MOTIVO_LABELS, ESTADO_LABELS } from "./GestionSolicitudes";
import { CLAVES_REFRESCO_RESERVAS, FormularioReserva, type ReservaCreadaDesdeFormulario } from "./FormularioReserva";
import { SolicitudGestionPanel } from "./SolicitudGestionPanel";
import { EstadoPropuestaBadge } from "./EstadoPropuestaBadge";
import { estadoPropuestaVista } from "@/lib/reservas/propuestaCliente";
import { actualizacionPropuesta, type PropuestaSolicitud } from "@/lib/reservas/solicitudPropuesta";
import {
  OPCIONES_FILTRO_ESTADO,
  esSolicitudAbierta,
  filtrarFilasUnificadas,
  unificarReservasYSolicitudes,
} from "@/lib/reservas/vistaUnificada";

// Mismo tipo que consume ModalVerificacionReserva.tsx — fuente única del
// contrato con `reservas` (incluye espacio_id y, si la migración
// 20260920010000 ya está aplicada, hora_solicitada/espacio_solicitado_id
// para la comparación "pedido vs. ofrecido").
type Reservation = ReservaParaVerificar;

interface ListaReservasAvanzadaProps {
  onEditReserva?: (reserva: Reservation) => void;
  onEspacioClick?: (espacioId: string) => void;
  initialStatusFilter?: string;
  initialDateFilter?: Date;
  /**
   * Solicitudes que el bot no pudo resolver, mezcladas en la lista como
   * filas "Solicitud". Lo instancia `Reservas.tsx` (una sola vez: ver el
   * aviso de realtime en useSolicitudesPendientes.ts) y lo pasa aquí.
   */
  solicitudesState?: ReturnType<typeof useSolicitudesPendientes>;
}

export function ListaReservasAvanzada({
  onEditReserva,
  onEspacioClick,
  initialStatusFilter,
  initialDateFilter,
  solicitudesState,
}: ListaReservasAvanzadaProps) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [verificacionModalOpen, setVerificacionModalOpen] = useState(false);
  const [selectedReservaForVerification, setSelectedReservaForVerification] = useState<Reservation | null>(null);
  const [blacklistReserva, setBlacklistReserva] = useState<Reservation | null>(null);
  // Selección para aceptar en bloque — solo pendientes participan.
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [aceptandoBloque, setAceptandoBloque] = useState(false);

  const { canAccess: canEdit } = useCanAccessSection("reservas", "edit");
  const queryClient = useQueryClient();
  const refrescarReservas = () =>
    CLAVES_REFRESCO_RESERVAS.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

  const toggleImportante = async (reservation: Reservation) => {
    const nuevoValor = !(reservation as any).importante;
    const { error } = await supabase.from("reservas").update({ importante: nuevoValor }).eq("id", reservation.id);
    if (error) {
      console.error("Error actualizando la reserva:", error);
      toast.error("No se pudo actualizar la reserva: " + error.message);
      return;
    }
    toast.success(nuevoValor ? "Reserva marcada como importante" : "Reserva desmarcada");
    fetchReservations();
  };

  // Filtros - inicializar con props si vienen de URL
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter || "all");
  const [canalFilter, setCanalFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<Date | undefined>(initialDateFilter);
  // Solicitud del bot que se está convirtiendo en reserva / gestionando.
  const [solicitudAConvertir, setSolicitudAConvertir] = useState<SolicitudPendiente | null>(null);
  // Día/hora/pax/sala editados en el diálogo de gestión (SolicitudGestionPanel).
  // `null` = convertir tal cual está guardada la solicitud.
  const [propuestaConversion, setPropuestaConversion] = useState<PropuestaSolicitud | null>(null);
  const abrirConversion = (s: SolicitudPendiente, propuesta: PropuestaSolicitud | null = null) => {
    setPropuestaConversion(propuesta);
    setSolicitudAConvertir(s);
  };
  const [solicitudGestionId, setSolicitudGestionId] = useState<string | null>(null);

  // `select("*")` a propósito, no una lista de columnas: `hora_solicitada`/
  // `espacio_solicitado_id` (migración 20260920010000) todavía no están en
  // los tipos generados, y nombrarlas explícitamente en un `.select(...)`
  // literal hace que el propio compilador de Supabase infiera
  // `SelectQueryError<"column ... does not exist">` para TODA la consulta
  // (falla en build, no solo en runtime). `*` no tiene ese problema — trae
  // lo que exista en la tabla en cada momento, ni más ni menos — y es el
  // mismo patrón que ya usa `useBlacklist.ts` para las columnas nuevas de
  // `blacklist`. Si la migración no está aplicada, las dos columnas
  // simplemente no vienen en cada fila: `ReservaParaVerificar` las declara
  // opcionales y el resto del código (objetivoAceptarComoSolicitado,
  // difiereSolicitudDeOferta) ya trata su ausencia como "sin contraoferta
  // todavía", no como un error.
  //
  // React Query (antes useState + fetch manual) con clave "reservas-lista":
  // así las acciones de otras partes de la pestaña — "Ha llegado" en
  // "Reservas de hoy", mover de espacio en el Gestor, alta nueva — refrescan
  // también esta lista (useAccionesServicioReserva / FormularioReserva
  // invalidan por prefijo), y un fallo de carga sigue sin pintarse como
  // "No se encontraron reservas".
  const {
    data: reservasData,
    isLoading: loading,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ["reservas-lista"],
    queryFn: async () => {
      // Solo Casa Tomás (Touza no tiene reservas, decisión del dueño
      // 2026-09-23). `as any`: `marca` no está en los tipos generados y
      // `.eq("marca", ...)` dispara "Type instantiation is excessively deep"
      // (mismo recurso que GestorReservasKanban / useDisponibilidad).
      const { data, error } = await (supabase.from("reservas" as any) as any)
        .select("*")
        .eq("marca", MARCA_POR_DEFECTO)
        .order("fecha", { ascending: false })
        .order("hora", { ascending: true });
      if (error) {
        toast.error("Error al cargar reservas");
        console.error(error);
        throw error;
      }
      return (data as unknown as Reservation[]) || [];
    },
  });
  const reservations = useMemo(() => reservasData ?? [], [reservasData]);
  const fetchReservations = () => {
    void refetch();
  };

  const solicitudes = useMemo(() => solicitudesState?.solicitudes ?? [], [solicitudesState?.solicitudes]);
  const solicitudGestion = solicitudGestionId ? solicitudes.find((s) => s.id === solicitudGestionId) ?? null : null;

  // Datos para prerrellenar el alta a partir de la solicitud. Memo: el
  // formulario reescribe sus campos cada vez que cambia la identidad.
  const datosConversion = useMemo(() => {
    const s = solicitudAConvertir;
    if (!s) return null;
    const p = propuestaConversion;
    const fecha = p ? p.fecha : s.fecha_solicitada;
    const hora = p ? p.hora : s.hora_solicitada;
    return {
      fecha: fecha ? new Date(`${fecha}T12:00:00`) : undefined,
      hora: hora ? String(hora).substring(0, 5) : undefined,
      nombre: s.nombre ?? undefined,
      telefono: s.telefono ?? undefined,
      email: s.email ?? undefined,
      numero_comensales: (p ? p.comensales : s.numero_comensales) ?? undefined,
      notas_cliente: s.notas_cliente ?? undefined,
      espacio_id: p ? p.espacioId : s.espacio_propuesto_id ?? null,
      // El cliente llamó al bot: la reserva es de canal teléfono y queda
      // enlazada a su solicitud (reservas.solicitud_id).
      canal: "telefono" as const,
      solicitud_id: s.id,
    };
  }, [solicitudAConvertir, propuestaConversion]);

  const handleReservaDesdeSolicitudCreada = async (creada?: ReservaCreadaDesdeFormulario) => {
    const s = solicitudAConvertir;
    setSolicitudAConvertir(null);
    setPropuestaConversion(null);
    if (s && solicitudesState) {
      // Si la reserva final difiere de lo guardado en la solicitud, se deja
      // constancia en la propia solicitud (día/hora/pax/sala + "Petición
      // original" en notas) antes de cerrarla. Sin toast: el de "resuelta" basta.
      const cambios = creada
        ? actualizacionPropuesta(
            s,
            { fecha: creada.fecha, hora: creada.hora, comensales: creada.numero_comensales, espacioId: creada.espacio_id },
            { persistirSala: "espacio_propuesto_id" in s },
          )
        : null;
      if (cambios) await solicitudesState.updatePropuesta(s.id, cambios, { silencioso: true });
      await solicitudesState.marcarConvertida(s.id, creada?.id ?? null);
    }
  };

  const updateReservationStatus = async (id: string, newStatus: string) => {
    setUpdatingId(id);
    try {
      const currentReservation = reservations.find(r => r.id === id);

      const { error } = await supabase
        .from("reservas")
        .update({ estado: newStatus })
        .eq("id", id);

      if (error) {
        toast.error("Error al actualizar estado");
        return;
      }

      toast.success("Estado actualizado correctamente");

      // Enviar datos al webhook
      supabase.functions.invoke('notify-reservation-change', {
        body: { ...currentReservation, estado: newStatus }
      }).catch(err => console.error('Error notifying webhook:', err));

      fetchReservations();
    } finally {
      setUpdatingId(null);
    }
  };

  // Un clic: acepta una solicitud pendiente exactamente como la pidió el
  // cliente (ver useVerificacionReservas.ts). Requisito explícito del dueño
  // ("hay mucho volumen"): esto NO abre el modal de contraoferta.
  const handleAceptarUnaClic = async (reservation: Reservation) => {
    setUpdatingId(reservation.id);
    try {
      const resultado = await aceptarComoSolicitado(reservation);
      if (resultado.ok) fetchReservations();
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleSeleccion = (id: string) => {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pendientesVisibles = () => filteredReservations.filter((r) => r.estado === "pendiente");

  const toggleSeleccionarTodasPendientes = () => {
    const pendientes = pendientesVisibles();
    setSeleccionadas((prev) => {
      const todasYaSeleccionadas = pendientes.length > 0 && pendientes.every((r) => prev.has(r.id));
      if (todasYaSeleccionadas) return new Set();
      return new Set(pendientes.map((r) => r.id));
    });
  };

  // Acción en bloque: no navega ni cambia de filtro al terminar, así que la
  // lista no "salta" — las filas aceptadas simplemente desaparecen del
  // filtro "Pendiente" al refrescar, sin perder el sitio en el resto.
  const handleAceptarSeleccionadas = async () => {
    const elegidas = reservations.filter((r) => seleccionadas.has(r.id));
    if (elegidas.length === 0) return;
    setAceptandoBloque(true);
    try {
      await aceptarVariasComoSolicitado(elegidas);
      setSeleccionadas(new Set());
      fetchReservations();
    } finally {
      setAceptandoBloque(false);
    }
  };

  const getCanalBadge = (canal: string | null) => {
    switch (canal) {
      case 'telefono':
        return (
          <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 gap-1">
            <Phone className="h-3 w-3" />
            Teléfono
          </Badge>
        );
      case 'web':
        return (
          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 gap-1">
            <Globe className="h-3 w-3" />
            Web
          </Badge>
        );
      case 'manual':
        return (
          <Badge className="bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300 gap-1">
            <Pencil className="h-3 w-3" />
            Manual
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground gap-1">
            <Globe className="h-3 w-3" />
            Web
          </Badge>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pendiente":
        return (
          <Badge className="bg-status-pending text-status-pending-foreground">
            <Clock className="mr-1 h-3 w-3" />
            Pendiente
          </Badge>
        );
      case "verificada":
        return (
          <Badge className="bg-status-verified text-status-verified-foreground">
            <CheckCircle className="mr-1 h-3 w-3" />
            Verificada
          </Badge>
        );
      case "confirmada":
        return (
          <Badge className="bg-status-confirmed text-status-confirmed-foreground">
            <CheckCircle className="mr-1 h-3 w-3" />
            Confirmada
          </Badge>
        );
      case "cancelada":
        return (
          <Badge variant="destructive">
            <XCircle className="mr-1 h-3 w-3" />
            Cancelada
          </Badge>
        );
      // 'completada' = el cliente llegó (ver src/lib/reservas/servicioSala.ts).
      case "completada":
        return (
          <Badge className="bg-emerald-600 text-white">
            <CheckCheck className="mr-1 h-3 w-3" />
            Llegó
          </Badge>
        );
      case "no_show":
        return (
          <Badge variant="secondary">
            <UserX className="mr-1 h-3 w-3" />
            No vino
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Aplicar filtros — a reservas Y solicitudes a la vez (lógica pura en
  // src/lib/reservas/vistaUnificada.ts). La fecha se compara como texto
  // "yyyy-MM-dd": antes se hacía `new Date(r.fecha)` (medianoche UTC) contra
  // una fecha local, lo que en husos negativos casaba con el día anterior.
  const filas = useMemo(
    () =>
      filtrarFilasUnificadas(unificarReservasYSolicitudes(reservations, solicitudes), {
        busqueda: searchQuery,
        estado: statusFilter,
        canal: canalFilter,
        fecha: dateFilter ? format(dateFilter, "yyyy-MM-dd") : null,
      }),
    [reservations, solicitudes, searchQuery, statusFilter, canalFilter, dateFilter],
  );
  const filteredReservations = filas.flatMap((f) => (f.tipo === "reserva" ? [f.reserva] : []));
  const numSolicitudesVisibles = filas.length - filteredReservations.length;

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <EstadoErrorCarga
        titulo="el listado de reservas"
        error={loadError}
        onReintentar={() => fetchReservations()}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-stretch sm:items-center">
            {/* Búsqueda */}
            <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar nombre, teléfono o email…"
                aria-label="Buscar reservas y solicitudes"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              {/* Botón Hoy */}
              <Button
                variant={dateFilter && dateFilter.toDateString() === new Date().toDateString() ? "default" : "outline"}
                size="default"
                onClick={() => setDateFilter(new Date())}
              >
                Hoy
              </Button>

              {/* Filtro de fecha */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="min-w-[120px] sm:min-w-[150px]">
                    <Calendar className="mr-2 h-4 w-4" />
                    {dateFilter
                      ? (dateFilter.toDateString() === new Date().toDateString()
                        ? "Hoy"
                        : format(dateFilter, "d MMM yyyy", { locale: es }))
                      : "Fecha"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarUI
                    mode="single"
                    selected={dateFilter}
                    onSelect={setDateFilter}
                    initialFocus
                  />
                  {dateFilter && (
                    <div className="p-2 border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => setDateFilter(undefined)}
                      >
                        Limpiar
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>

              {/* Filtro de estado */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[170px] sm:w-[200px]" aria-label="Filtrar por estado">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  {OPCIONES_FILTRO_ESTADO.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Filtro de canal */}
              <Select value={canalFilter} onValueChange={setCanalFilter}>
                <SelectTrigger className="w-[120px] sm:w-[140px]">
                  <SelectValue placeholder="Canal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="telefono">📞 Tel</SelectItem>
                  <SelectItem value="web">🌐 Web</SelectItem>
                  <SelectItem value="manual">✏️ Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Contador de resultados */}
            <Badge variant="secondary" className="self-center sm:ml-auto">
              {filteredReservations.length} reservas
              {numSolicitudesVisibles > 0 && ` · ${numSolicitudesVisibles} solicitud${numSolicitudesVisibles === 1 ? "" : "es"}`}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Barra de acción en bloque — aceptar varias solicitudes pendientes a
          la vez sin abrir una ficha por cada una. Solo con permiso de edición. */}
      {canEdit && seleccionadas.size > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm font-medium">
              {seleccionadas.size} solicitud{seleccionadas.size === 1 ? "" : "es"} seleccionada{seleccionadas.size === 1 ? "" : "s"}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSeleccionadas(new Set())} disabled={aceptandoBloque}>
                Quitar selección
              </Button>
              <Button size="sm" onClick={handleAceptarSeleccionadas} disabled={aceptandoBloque}>
                {aceptandoBloque ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCheck className="h-4 w-4 mr-1" />}
                Aceptar seleccionadas tal cual
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mobile card view */}
      <div className="sm:hidden space-y-3">
        {filas.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8 text-muted-foreground">
              No se encontraron reservas con los filtros aplicados
            </CardContent>
          </Card>
        ) : (
          filas.map((fila) => fila.tipo === "solicitud" ? (
            solicitudesState && (
              <SolicitudCard
                key={fila.id}
                solicitud={fila.solicitud}
                onUpdateEstado={solicitudesState.updateEstado}
                onUpdateNotas={solicitudesState.updateNotasInternas}
                onConvertir={canEdit ? (s) => abrirConversion(s) : undefined}
                onGestionarPropuesta={(s) => setSolicitudGestionId(s.id)}
              />
            )
          ) : (() => { const reservation = fila.reserva; return (
            <Card key={reservation.id} className={(reservation as any).importante ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {reservation.estado === "pendiente" && canEdit && (
                      <Checkbox
                        checked={seleccionadas.has(reservation.id)}
                        onCheckedChange={() => toggleSeleccion(reservation.id)}
                        className="shrink-0"
                        aria-label="Seleccionar para aceptar en bloque"
                      />
                    )}
                    <button onClick={() => toggleImportante(reservation)} className="shrink-0">
                      <Star className={cn("h-4 w-4", (reservation as any).importante ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
                    </button>
                    <span className="font-medium text-sm">{reservation.nombre || "Sin nombre"}</span>
                  </div>
                  {getStatusBadge(reservation.estado)}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{new Date(reservation.fecha).toLocaleDateString("es-ES")}</span>
                  <span>{reservation.hora}</span>
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" />{reservation.numero_comensales}</span>
                  {getCanalBadge(reservation.canal)}
                </div>
                {reservation.telefono && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" />{reservation.telefono}
                  </p>
                )}
                <div className="flex gap-2 pt-1 flex-wrap">
                  {reservation.estado === "pendiente" && canEdit && (
                    <Button size="sm" className="h-7 text-xs" disabled={updatingId === reservation.id || aceptandoBloque} onClick={() => handleAceptarUnaClic(reservation)}>
                      {updatingId === reservation.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3 mr-1" />}
                      Aceptar
                    </Button>
                  )}
                  {reservation.estado === "pendiente" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                      setSelectedReservaForVerification(reservation);
                      setVerificacionModalOpen(true);
                    }}>Verificar</Button>
                  )}
                  {reservation.estado === "verificada" && canEdit && (
                    <Button size="sm" className="h-7 text-xs" disabled={updatingId === reservation.id} onClick={() => updateReservationStatus(reservation.id, "confirmada")}>
                      {updatingId === reservation.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirmar"}
                    </Button>
                  )}
                  {reservation.estado !== "cancelada" && canEdit && (
                    <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={updatingId === reservation.id} onClick={() => updateReservationStatus(reservation.id, "cancelada")}>
                      {updatingId === reservation.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Cancelar"}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={() => setBlacklistReserva(reservation)} aria-label={`Añadir a ${reservation.nombre || "este cliente"} a la lista negra`}>
                    <ShieldBan className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ); })())
        )}
      </div>

      {/* Desktop table view */}
      <Card className="hidden sm:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {canEdit && (
                  <TableHead className="w-[36px]">
                    <Checkbox
                      checked={pendientesVisibles().length > 0 && pendientesVisibles().every((r) => seleccionadas.has(r.id))}
                      onCheckedChange={toggleSeleccionarTodasPendientes}
                      disabled={pendientesVisibles().length === 0}
                      aria-label="Seleccionar todas las pendientes visibles"
                    />
                  </TableHead>
                )}
                <TableHead>Fecha</TableHead>
                <TableHead>Hora</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Comensales</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Acciones</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canEdit ? 9 : 8} className="text-center py-8 text-muted-foreground">
                    No se encontraron reservas con los filtros aplicados
                  </TableCell>
                </TableRow>
              ) : (
                filas.map((fila) => fila.tipo === "solicitud" ? (
                  <FilaSolicitud
                    key={fila.id}
                    solicitud={fila.solicitud}
                    canEdit={canEdit}
                    onConvertir={() => abrirConversion(fila.solicitud)}
                    onGestionar={() => setSolicitudGestionId(fila.solicitud.id)}
                  />
                ) : (() => { const reservation = fila.reserva; return (
                  <TableRow key={reservation.id} className={(reservation as any).importante ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}>
                    {canEdit && (
                      <TableCell>
                        {reservation.estado === "pendiente" && (
                          <Checkbox
                            checked={seleccionadas.has(reservation.id)}
                            onCheckedChange={() => toggleSeleccion(reservation.id)}
                            aria-label="Seleccionar para aceptar en bloque"
                          />
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {new Date(reservation.fecha).toLocaleDateString("es-ES")}
                    </TableCell>
                    <TableCell>{reservation.hora}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <button onClick={() => toggleImportante(reservation)} className="shrink-0 hover:scale-110 transition-transform">
                          <Star className={cn("h-4 w-4", (reservation as any).importante ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-amber-400")} />
                        </button>
                        <div>
                          <p className="font-medium">{reservation.nombre || "Sin nombre"}</p>
                          {reservation.telefono && <p className="text-xs text-muted-foreground">{reservation.telefono}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1"><Users className="h-4 w-4 text-muted-foreground" />{reservation.numero_comensales}</div>
                    </TableCell>
                    <TableCell>{getCanalBadge(reservation.canal)}</TableCell>
                    <TableCell>{getStatusBadge(reservation.estado)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2 flex-wrap">
                        {reservation.estado === "pendiente" && canEdit && (
                          <Button size="sm" disabled={updatingId === reservation.id || aceptandoBloque} onClick={() => handleAceptarUnaClic(reservation)}>
                            {updatingId === reservation.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                            Aceptar
                          </Button>
                        )}
                        {reservation.estado === "pendiente" && (
                          <Button size="sm" variant="outline" onClick={() => {
                            setSelectedReservaForVerification(reservation);
                            setVerificacionModalOpen(true);
                          }}>Verificar</Button>
                        )}
                        {reservation.estado === "verificada" && canEdit && (
                          <Button size="sm" disabled={updatingId === reservation.id} onClick={() => updateReservationStatus(reservation.id, "confirmada")}>
                            {updatingId === reservation.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
                          </Button>
                        )}
                        {reservation.estado !== "cancelada" && canEdit && (
                          <Button size="sm" variant="destructive" disabled={updatingId === reservation.id} onClick={() => updateReservationStatus(reservation.id, "cancelada")}>
                            {updatingId === reservation.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancelar"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10" onClick={() => setBlacklistReserva(reservation)} aria-label={`Añadir a ${reservation.nombre || "este cliente"} a la lista negra`}>
                        <ShieldBan className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ); })())
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ModalVerificacionReserva
        reserva={selectedReservaForVerification}
        open={verificacionModalOpen}
        onOpenChange={setVerificacionModalOpen}
        onSuccess={fetchReservations}
      />

      <BlacklistModal
        reserva={blacklistReserva}
        open={!!blacklistReserva}
        onOpenChange={(open) => { if (!open) setBlacklistReserva(null); }}
      />

      {/* Convertir una solicitud del bot en reserva: alta manual prerrellenada;
          al crearla, la solicitud pasa a "resuelta". */}
      <Dialog open={!!solicitudAConvertir} onOpenChange={(open) => { if (!open) { setSolicitudAConvertir(null); setPropuestaConversion(null); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Convertir solicitud en reserva</DialogTitle>
            <DialogDescription>
              {propuestaConversion
                ? "Datos de la solicitud con los cambios que has propuesto (día, hora, comensales y sala). Revísalos: al crear la reserva, la solicitud se marcará como resuelta."
                : "Datos tomados de la solicitud que dejó el cliente por teléfono. Revísalos: al crear la reserva, la solicitud se marcará como resuelta."}
            </DialogDescription>
          </DialogHeader>
          {solicitudAConvertir && (
            <FormularioReserva
              datosPreseleccionados={datosConversion}
              onSuccess={handleReservaDesdeSolicitudCreada}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Gestión completa de una solicitud (notas internas, contactado,
          resuelta, descartar…) desde la tabla de escritorio. */}
      <Dialog open={!!solicitudGestion} onOpenChange={(open) => { if (!open) setSolicitudGestionId(null); }}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Solicitud pendiente del bot</DialogTitle>
            <DialogDescription>
              El asistente telefónico no pudo cerrar esta reserva. Ajusta día, hora, comensales y sala mirando la ocupación y envía la propuesta al cliente; cuando la acepte, se crea la reserva.
            </DialogDescription>
          </DialogHeader>
          {solicitudGestion && solicitudesState && (
            <SolicitudGestionPanel
              key={solicitudGestion.id}
              solicitud={solicitudGestion}
              onUpdateEstado={solicitudesState.updateEstado}
              onUpdateNotas={solicitudesState.updateNotasInternas}
              onGuardarPropuesta={(id, cambios, opciones) => solicitudesState.updatePropuesta(id, cambios, opciones)}
              onConvertir={canEdit ? (s, propuesta) => { setSolicitudGestionId(null); abrirConversion(s, propuesta); } : undefined}
              onEnviarPropuesta={canEdit ? solicitudesState.enviarPropuesta : undefined}
              onAceptarTelefono={
                canEdit
                  ? async (id, contacto) => {
                      const res = await solicitudesState.aceptarPropuestaTelefono(id, contacto);
                      if (res.ok) refrescarReservas();
                      return res;
                    }
                  : undefined
              }
              onRechazarTelefono={canEdit ? solicitudesState.rechazarPropuestaTelefono : undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Fila de la tabla (escritorio) para una solicitud pendiente del bot. */
function FilaSolicitud({
  solicitud,
  canEdit,
  onConvertir,
  onGestionar,
}: {
  solicitud: SolicitudPendiente;
  canEdit: boolean;
  onConvertir: () => void;
  onGestionar: () => void;
}) {
  const motivo = MOTIVO_LABELS[solicitud.motivo_rechazo] || MOTIVO_LABELS.otro;
  const abierta = esSolicitudAbierta(solicitud.estado);
  const estadoLabel = ESTADO_LABELS[solicitud.estado]?.label || solicitud.estado;
  const vistaPropuesta = estadoPropuestaVista(solicitud, format(new Date(), "yyyy-MM-dd"));
  return (
    <TableRow className={cn("bg-amber-50/50 dark:bg-amber-950/10", !abierta && "opacity-70")}>
      {canEdit && <TableCell />}
      <TableCell>
        {solicitud.fecha_solicitada
          ? new Date(`${solicitud.fecha_solicitada}T12:00:00`).toLocaleDateString("es-ES")
          : <span className="text-muted-foreground">Sin fecha</span>}
      </TableCell>
      <TableCell>{solicitud.hora_solicitada ? String(solicitud.hora_solicitada).substring(0, 5) : "—"}</TableCell>
      <TableCell>
        <div>
          <p className="font-medium">{solicitud.nombre || "Sin nombre"}</p>
          {solicitud.telefono && (
            <a href={`tel:${solicitud.telefono}`} className="text-xs text-muted-foreground hover:underline">
              {solicitud.telefono}
            </a>
          )}
          {solicitud.descripcion_rechazo && (
            <p className="text-xs text-muted-foreground mt-0.5 max-w-[260px] truncate" title={solicitud.descripcion_rechazo}>
              {solicitud.descripcion_rechazo}
            </p>
          )}
        </div>
      </TableCell>
      <TableCell>
        {solicitud.numero_comensales ? (
          <div className="flex items-center gap-1"><Users className="h-4 w-4 text-muted-foreground" />{solicitud.numero_comensales}</div>
        ) : "—"}
      </TableCell>
      <TableCell>
        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 gap-1">
          <Phone className="h-3 w-3" />
          Bot
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <Badge className="bg-amber-500 text-white gap-1">
            <Inbox className="h-3 w-3" />
            Solicitud · {estadoLabel}
          </Badge>
          <Badge className={cn("text-[10px]", motivo.color)}>{motivo.label}</Badge>
          {vistaPropuesta && vistaPropuesta.clave !== "borrador" && <EstadoPropuestaBadge vista={vistaPropuesta} />}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex gap-2 flex-wrap">
          {canEdit && abierta && (
            <Button size="sm" onClick={onConvertir}>
              <CalendarPlus className="h-4 w-4 mr-1" />
              Convertir en reserva
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onGestionar}>
            <Settings2 className="h-4 w-4 mr-1" />
            Gestionar
          </Button>
        </div>
      </TableCell>
      <TableCell />
    </TableRow>
  );
}
