import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Search, 
  Users,
  Calendar,
  MapPin,
  Loader2
} from "lucide-react";
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { ModalVerificacionReserva } from "./ModalVerificacionReserva";

interface Reservation {
  id: string;
  fecha: string;
  hora: string;
  numero_comensales: number;
  estado: string;
  notas_cliente: string | null;
  nombre: string;
  telefono: string;
  email: string | null;
  sala_id: string;
  espacios_reserva: {
    nombre: string;
  } | null;
}

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
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [verificacionModalOpen, setVerificacionModalOpen] = useState(false);
  const [selectedReservaForVerification, setSelectedReservaForVerification] = useState<Reservation | null>(null);
  
  // Filtros - inicializar con props si vienen de URL
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter || "all");
  const [espacioFilter, setEspacioFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<Date | undefined>(initialDateFilter);

  const { data: espacios } = useEspaciosReserva();

  useEffect(() => {
    fetchReservations();
  }, []);

  const fetchReservations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("reservas")
      .select(`
        id,
        fecha,
        hora,
        numero_comensales,
        estado,
        notas_cliente,
        nombre,
        telefono,
        email,
        sala_id,
        espacios_reserva!reservas_sala_id_fkey (nombre)
      `)
      .order("fecha", { ascending: false })
      .order("hora", { ascending: true });

    if (error) {
      toast.error("Error al cargar reservas");
      console.error(error);
    } else {
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
    
    // Filtro de espacio
    if (espacioFilter !== "all" && r.sala_id !== espacioFilter) {
      return false;
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

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-center">
            {/* Búsqueda */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

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
                <Button variant="outline" className="min-w-[150px]">
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

            {/* Filtro de espacio */}
            <Select value={espacioFilter} onValueChange={setEspacioFilter}>
              <SelectTrigger className="w-[180px]">
                <MapPin className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Espacio" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los espacios</SelectItem>
                {espacios?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Filtro de estado */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
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

            {/* Contador de resultados */}
            <Badge variant="secondary" className="ml-auto">
              {filteredReservations.length} reservas
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Tabla de reservas */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Hora</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Comensales</TableHead>
                <TableHead>Espacio</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReservations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No se encontraron reservas con los filtros aplicados
                  </TableCell>
                </TableRow>
              ) : (
                filteredReservations.map((reservation) => (
                  <TableRow key={reservation.id}>
                    <TableCell>
                      {new Date(reservation.fecha).toLocaleDateString("es-ES")}
                    </TableCell>
                    <TableCell>{reservation.hora}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{reservation.nombre || "Sin nombre"}</p>
                        {reservation.telefono && (
                          <p className="text-xs text-muted-foreground">{reservation.telefono}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        {reservation.numero_comensales}
                      </div>
                    </TableCell>
                    <TableCell>
                      {reservation.espacios_reserva?.nombre ? (
                        <Button
                          variant="link"
                          className="p-0 h-auto font-normal"
                          onClick={() => onEspacioClick?.(reservation.sala_id)}
                        >
                          {reservation.espacios_reserva.nombre}
                        </Button>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(reservation.estado)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {reservation.estado === "pendiente" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedReservaForVerification(reservation);
                              setVerificacionModalOpen(true);
                            }}
                          >
                            Verificar
                          </Button>
                        )}
                        {reservation.estado === "verificada" && (
                          <Button
                            size="sm"
                            disabled={updatingId === reservation.id}
                            onClick={() => updateReservationStatus(reservation.id, "confirmada")}
                          >
                            {updatingId === reservation.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Confirmar"
                            )}
                          </Button>
                        )}
                        {reservation.estado !== "cancelada" && (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={updatingId === reservation.id}
                            onClick={() => updateReservationStatus(reservation.id, "cancelada")}
                          >
                            {updatingId === reservation.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Cancelar"
                            )}
                          </Button>
                        )}
                      </div>
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
    </div>
  );
}
