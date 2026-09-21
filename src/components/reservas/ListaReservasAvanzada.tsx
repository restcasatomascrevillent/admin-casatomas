import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
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
  Pencil
} from "lucide-react";
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
}

export function ListaReservasAvanzada({
  onEditReserva,
  onEspacioClick,
  initialStatusFilter,
  initialDateFilter
}: ListaReservasAvanzadaProps) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  // Sin este estado, un fallo de carga se pintaba como
  // "No se encontraron reservas con los filtros aplicados".
  const [loadError, setLoadError] = useState<unknown>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [verificacionModalOpen, setVerificacionModalOpen] = useState(false);
  const [selectedReservaForVerification, setSelectedReservaForVerification] = useState<Reservation | null>(null);
  const [blacklistReserva, setBlacklistReserva] = useState<Reservation | null>(null);
  // Selección para aceptar en bloque — solo pendientes participan.
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [aceptandoBloque, setAceptandoBloque] = useState(false);

  const { canAccess: canEdit } = useCanAccessSection("reservas", "edit");

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



  useEffect(() => {
    fetchReservations();
  }, []);

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
  const fetchReservations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("reservas")
      .select("*")
      .order("fecha", { ascending: false })
      .order("hora", { ascending: true });

    if (error) {
      toast.error("Error al cargar reservas");
      console.error(error);
      setLoadError(error);
    } else {
      setLoadError(null);
      setReservations((data as any) || []);
    }
    setLoading(false);
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
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Aplicar filtros
  const filteredReservations = reservations.filter((r) => {
    // Filtro de búsqueda por nombre
    if (searchQuery && !r.nombre?.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    // Filtro de estado
    if (statusFilter !== "all" && r.estado !== statusFilter) {
      return false;
    }

    // Filtro de canal
    if (canalFilter !== "all") {
      const canalReserva = r.canal || 'web';
      if (canalReserva !== canalFilter) return false;
    }

    // Filtro de fecha
    if (dateFilter) {
      const reservaDate = new Date(r.fecha);
      const filterDate = new Date(dateFilter);
      reservaDate.setHours(0, 0, 0, 0);
      filterDate.setHours(0, 0, 0, 0);
      if (reservaDate.getTime() !== filterDate.getTime()) {
        return false;
      }
    }

    return true;
  });

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
                placeholder="Buscar por nombre..."
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
                <SelectTrigger className="w-[130px] sm:w-[160px]">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pendiente">Pendiente</SelectItem>
                  <SelectItem value="verificada">Verificada</SelectItem>
                  <SelectItem value="confirmada">Confirmada</SelectItem>
                  <SelectItem value="cancelada">Cancelada</SelectItem>
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
        {filteredReservations.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8 text-muted-foreground">
              No se encontraron reservas con los filtros aplicados
            </CardContent>
          </Card>
        ) : (
          filteredReservations.map((reservation) => (
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
                  <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={() => setBlacklistReserva(reservation)}>
                    <ShieldBan className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
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
              {filteredReservations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canEdit ? 9 : 8} className="text-center py-8 text-muted-foreground">
                    No se encontraron reservas con los filtros aplicados
                  </TableCell>
                </TableRow>
              ) : (
                filteredReservations.map((reservation) => (
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
                      <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10" onClick={() => setBlacklistReserva(reservation)}>
                        <ShieldBan className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
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
    </div>
  );
}
