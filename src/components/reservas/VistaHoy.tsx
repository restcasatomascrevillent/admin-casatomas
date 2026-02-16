import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users, CalendarCheck, TrendingUp, MapPin, Clock, Phone, Mail, ShieldBan, List, Search, LayoutGrid } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface VistaHoyProps {
  onEspacioClick: (espacioId: string) => void;
}

const ESTADOS_RESERVA = {
  pendiente: { label: "Pendiente", color: "bg-yellow-500" },
  verificada: { label: "Verificada", color: "bg-blue-500" },
  confirmada: { label: "Confirmada", color: "bg-green-500" },
  cancelada: { label: "Cancelada", color: "bg-red-500" },
  rechazada: { label: "Rechazada", color: "bg-destructive" },
  completada: { label: "Completada", color: "bg-primary" },
  "no-show": { label: "No Show", color: "bg-gray-500" },
};

export function VistaHoy({ onEspacioClick }: VistaHoyProps) {
  const navigate = useNavigate();
  const { data: resumen, isLoading } = useResumenOcupacionHoy();
  const [filtroEstado, setFiltroEstado] = useState<string>("todos");
  const [busqueda, setBusqueda] = useState("");
  const hoy = format(new Date(), "yyyy-MM-dd");

  const { data: reservasHoy, isLoading: loadingReservas } = useQuery({
    queryKey: ["reservas-hoy", hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservas")
        .select(`
          *,
          espacios_reserva:sala_id (nombre)
        `)
        .eq("fecha", hoy)
        .order("hora", { ascending: true });

      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-16 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const today = new Date();

  return (
    <div className="space-y-6">
      {/* Header con fecha */}
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-xl bg-primary/10">
          <CalendarCheck className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h3 className="text-2xl font-bold">
            {format(today, "EEEE, d 'de' MMMM", { locale: es })}
          </h3>
          <p className="text-muted-foreground">Resumen de ocupación del día</p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-5">
        {/* Gestión de salas button */}
        <Card
          className="border-2 border-destructive/50 bg-destructive/5 hover:bg-destructive/10 cursor-pointer transition-all hover:shadow-md hover:scale-[1.02]"
          onClick={() => navigate("/reservas/gestion")}
        >
          <CardContent className="p-6 flex flex-col items-center justify-center h-full">
            <div className="p-3 rounded-full bg-destructive/10 mb-2">
              <LayoutGrid className="h-5 w-5 text-destructive" />
            </div>
            <p className="font-bold text-destructive text-sm text-center">Gestión de Salas</p>
            <p className="text-xs text-muted-foreground text-center mt-1">Asignar reservas</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-primary">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Reservas Hoy
                </p>
                <p className="text-3xl font-bold">{resumen?.totalReservas || 0}</p>
              </div>
              <div className="p-3 rounded-full bg-primary/10">
                <CalendarCheck className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-accent">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Comensales Esperados
                </p>
                <p className="text-3xl font-bold">{resumen?.totalComensales || 0}</p>
              </div>
              <div className="p-3 rounded-full bg-accent/10">
                <Users className="h-5 w-5 text-accent" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-secondary">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Capacidad Total
                </p>
                <p className="text-3xl font-bold">{resumen?.capacidadTotal || 0}</p>
              </div>
              <div className="p-3 rounded-full bg-secondary/10">
                <MapPin className="h-5 w-5 text-secondary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Ocupación Media
                </p>
                <p className="text-3xl font-bold">{resumen?.porcentajeTotal || 0}%</p>
              </div>
              <div className="p-3 rounded-full bg-green-500/10">
                <TrendingUp className="h-5 w-5 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lista de reservas del día */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <List className="h-5 w-5" />
              Reservas de Hoy
            </CardTitle>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-none">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar nombre, email, teléfono..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="pl-9 w-full sm:w-[250px]"
                />
              </div>
              <Select value={filtroEstado} onValueChange={setFiltroEstado}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {Object.entries(ESTADOS_RESERVA).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingReservas ? (
            <div className="text-center py-8 text-muted-foreground">Cargando reservas...</div>
          ) : !reservasHoy?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <CalendarCheck className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No hay reservas para hoy</p>
            </div>
          ) : (
            <>
              {(() => {
                const term = busqueda.toLowerCase();
                const reservasBuscadas = reservasHoy.filter(r => {
                  const matchBusqueda = !term || 
                    (r.nombre || "").toLowerCase().includes(term) ||
                    (r.email || "").toLowerCase().includes(term) ||
                    (r.telefono || "").toLowerCase().includes(term) ||
                    (r.notas_cliente || "").toLowerCase().includes(term);
                  return matchBusqueda;
                });
                const reservasFiltradas = filtroEstado === "todos" 
                  ? reservasBuscadas 
                  : reservasBuscadas.filter(r => r.estado === filtroEstado);

                if (!reservasFiltradas.length) {
                  return (
                    <div className="text-center py-8 text-muted-foreground">
                      No hay reservas con estado "{ESTADOS_RESERVA[filtroEstado as keyof typeof ESTADOS_RESERVA]?.label}"
                    </div>
                  );
                }

                return (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Hora</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Contacto</TableHead>
                         <TableHead>Comensales</TableHead>
                         <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reservasFiltradas.map((reserva) => {
                        const estadoInfo = ESTADOS_RESERVA[reserva.estado as keyof typeof ESTADOS_RESERVA] || { label: reserva.estado, color: "bg-gray-500" };
                        return (
                          <TableRow key={reserva.id} className={cn(reserva.en_blacklist && "bg-destructive/5")}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                                <span className="font-mono font-medium">
                                  {typeof reserva.hora === 'string' ? reserva.hora.substring(0, 5) : reserva.hora}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{reserva.nombre || "Sin nombre"}</span>
                                {reserva.en_blacklist && (
                                  <span title="En lista negra">
                                    <ShieldBan className="h-4 w-4 text-destructive" />
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                                {reserva.telefono && (
                                  <div className="flex items-center gap-1">
                                    <Phone className="h-3 w-3" />
                                    {reserva.telefono}
                                  </div>
                                )}
                                {reserva.email && (
                                  <div className="flex items-center gap-1">
                                    <Mail className="h-3 w-3" />
                                    {reserva.email}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Users className="h-4 w-4 text-muted-foreground" />
                                {reserva.numero_comensales}
                              </div>
                            </TableCell>
                             <TableCell>
                              <Badge className={cn("text-white", estadoInfo.color)}>
                                {estadoInfo.label}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                );
              })()}
              <div className="mt-4 text-sm text-muted-foreground text-center">
                {filtroEstado === "todos" 
                  ? `${reservasHoy.length} reservas en total`
                  : `${reservasHoy.filter(r => r.estado === filtroEstado).length} de ${reservasHoy.length} reservas`
                }
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
