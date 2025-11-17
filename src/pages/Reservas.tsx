import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle, XCircle, Clock, Plus, CalendarIcon } from "lucide-react";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import { CalendarioDisponibilidad } from "@/components/reservas/CalendarioDisponibilidad";
import { GenerarReservasFicticias } from "@/components/reservas/GenerarReservasFicticias";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

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
  salas: {
    nombre: string;
  } | null;
}

export default function Reservas() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<"upcoming" | "all" | "specific">("upcoming");
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [openDialog, setOpenDialog] = useState(false);

  useEffect(() => {
    fetchReservations();
  }, []);

  const fetchReservations = async () => {
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
        salas!reservas_sala_id_fkey (nombre)
      `)
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true });

    if (error) {
      toast.error("Error al cargar reservas");
      console.error(error);
    } else {
      setReservations((data as any) || []);
    }
  };

  const updateReservationStatus = async (id: string, newStatus: string) => {
    const { error } = await supabase
      .from("reservas")
      .update({ estado: newStatus })
      .eq("id", id);

    if (error) {
      toast.error("Error al actualizar estado");
    } else {
      toast.success("Estado actualizado correctamente");
      fetchReservations();
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

  const filteredReservations = reservations.filter((r) => {
    const statusMatch = filter === "all" ? true : r.estado === filter;
    
    if (dateFilter === "upcoming") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const reservationDate = new Date(r.fecha);
      return statusMatch && reservationDate >= today;
    }
    
    if (dateFilter === "specific" && selectedDate) {
      const reservationDate = new Date(r.fecha);
      const targetDate = new Date(selectedDate);
      reservationDate.setHours(0, 0, 0, 0);
      targetDate.setHours(0, 0, 0, 0);
      return statusMatch && reservationDate.getTime() === targetDate.getTime();
    }
    
    return statusMatch;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Reservas</h2>
            <p className="text-muted-foreground">Gestiona las reservas del restaurante</p>
          </div>
          <div className="flex gap-2">
            <GenerarReservasFicticias />
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Nueva Reserva
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Crear Nueva Reserva</DialogTitle>
                </DialogHeader>
                <FormularioReserva
                  onSuccess={() => {
                    setOpenDialog(false);
                    fetchReservations();
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Tabs defaultValue="lista" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="lista">Lista de Reservas</TabsTrigger>
            <TabsTrigger value="calendario">Calendario de Ocupación</TabsTrigger>
          </TabsList>

          <TabsContent value="lista" className="space-y-6">
            <div className="flex flex-wrap gap-8 items-center py-2">
              <div className="flex gap-3 items-center">
                <span className="text-sm font-medium text-foreground/70 min-w-[60px]">Período</span>
                <div className="flex gap-2">
                  <Button
                    variant={dateFilter === "upcoming" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setDateFilter("upcoming")}
                  >
                    Desde Hoy
                  </Button>
                  <Button
                    variant={dateFilter === "all" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setDateFilter("all")}
                  >
                    Histórico
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={dateFilter === "specific" ? "default" : "ghost"}
                        size="sm"
                        className={cn(
                          "justify-start text-left font-normal",
                          !selectedDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {selectedDate ? format(selectedDate, "d MMM", { locale: es }) : "Fecha"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={(date) => {
                          setSelectedDate(date);
                          if (date) {
                            setDateFilter("specific");
                          }
                        }}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              
              <div className="h-8 w-px bg-border" />
              
              <div className="flex gap-3 items-center">
                <span className="text-sm font-medium text-foreground/70 min-w-[60px]">Estado</span>
                <div className="flex gap-2">
                  <Button
                    variant={filter === "all" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setFilter("all")}
                  >
                    Todas
                  </Button>
                  <Button
                    variant={filter === "pendiente" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setFilter("pendiente")}
                  >
                    Pendientes
                  </Button>
                  <Button
                    variant={filter === "verificada" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setFilter("verificada")}
                  >
                    Verificadas
                  </Button>
                  <Button
                    variant={filter === "confirmada" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setFilter("confirmada")}
                  >
                    Confirmadas
                  </Button>
                </div>
              </div>
            </div>

            <Card>
          <CardHeader>
            <CardTitle>Lista de Reservas</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Hora</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Comensales</TableHead>
                  <TableHead>Sala</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReservations.map((reservation) => (
                  <TableRow key={reservation.id}>
                    <TableCell>
                      {new Date(reservation.fecha).toLocaleDateString("es-ES")}
                    </TableCell>
                    <TableCell>{reservation.hora}</TableCell>
                    <TableCell>
                      {reservation.nombre || "Sin nombre"}
                    </TableCell>
                    <TableCell>{reservation.numero_comensales}</TableCell>
                    <TableCell>{reservation.salas?.nombre || "-"}</TableCell>
                    <TableCell>{getStatusBadge(reservation.estado)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {reservation.estado === "pendiente" && (
                          <Button
                            size="sm"
                            onClick={() => updateReservationStatus(reservation.id, "verificada")}
                          >
                            Verificar
                          </Button>
                        )}
                        {reservation.estado === "verificada" && (
                          <Button
                            size="sm"
                            onClick={() => updateReservationStatus(reservation.id, "confirmada")}
                          >
                            Confirmar
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => updateReservationStatus(reservation.id, "cancelada")}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="calendario" className="space-y-6">
            <CalendarioDisponibilidad />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
