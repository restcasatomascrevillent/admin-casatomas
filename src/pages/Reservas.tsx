import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle, XCircle, Clock } from "lucide-react";

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
  salas: {
    nombre: string;
  } | null;
}

export default function Reservas() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [filter, setFilter] = useState<string>("all");

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
      setReservations(data || []);
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

  const filteredReservations = reservations.filter((r) =>
    filter === "all" ? true : r.estado === filter
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Reservas</h2>
            <p className="text-muted-foreground">Gestiona las reservas del restaurante</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
          >
            Todas
          </Button>
          <Button
            variant={filter === "pendiente" ? "default" : "outline"}
            onClick={() => setFilter("pendiente")}
          >
            Pendientes
          </Button>
          <Button
            variant={filter === "verificada" ? "default" : "outline"}
            onClick={() => setFilter("verificada")}
          >
            Verificadas
          </Button>
          <Button
            variant={filter === "confirmada" ? "default" : "outline"}
            onClick={() => setFilter("confirmada")}
          >
            Confirmadas
          </Button>
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
      </div>
    </DashboardLayout>
  );
}
