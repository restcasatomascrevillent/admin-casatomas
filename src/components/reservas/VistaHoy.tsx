import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users, CalendarCheck, TrendingUp, MapPin, Clock, Phone, Mail, ShieldBan, List, Search, Star, LayoutGrid } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { BlacklistModal } from "./BlacklistModal";
import { GestorReservasKanban } from "./GestorReservasKanban";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";

interface VistaHoyProps {
  onEspacioClick: (espacioId: string) => void;
}

// Estados admitidos por el CHECK `reservas_estado_check` de la base de datos.
// Ojo: la clave de "no show" es `no_show` (con guion bajo); antes era "no-show"
// y el filtro no casaba nunca. "rechazada" no existe y se ha eliminado.
const ESTADOS_RESERVA = {
  pendiente: { label: "Pendiente", color: "bg-yellow-500" },
  verificada: { label: "Verificada", color: "bg-blue-500" },
  confirmada: { label: "Confirmada", color: "bg-green-500" },
  cancelada: { label: "Cancelada", color: "bg-red-500" },
  completada: { label: "Completada", color: "bg-primary" },
  no_show: { label: "No Show", color: "bg-gray-500" },
};

export function VistaHoy({ onEspacioClick }: VistaHoyProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    data: resumen,
    isLoading,
    isError: errorResumen,
    error: errorResumenDetalle,
    refetch: refetchResumen,
  } = useResumenOcupacionHoy();
  const [filtroEstado, setFiltroEstado] = useState<string>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [blacklistReserva, setBlacklistReserva] = useState<any>(null);
  const [kanbanOpen, setKanbanOpen] = useState(false);
  const hoy = format(new Date(), "yyyy-MM-dd");

  const toggleImportante = async (reserva: any) => {
    const nuevoValor = !reserva.importante;
    // Antes no se comprobaba el error: si RLS o la red fallaban, el empleado leía
    // "marcada como importante" y la estrella se quedaba apagada.
    const { error } = await supabase
      .from("reservas")
      .update({ importante: nuevoValor })
      .eq("id", reserva.id);

    if (error) {
      console.error("Error actualizando la reserva:", error);
      toast.error("No se pudo actualizar la reserva: " + error.message);
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["reservas-hoy"] });
    toast.success(nuevoValor ? "Reserva marcada como importante" : "Reserva desmarcada");
  };

  const {
    data: reservasHoy,
    isLoading: loadingReservas,
    isError: errorReservas,
    error: errorReservasDetalle,
    refetch: refetchReservas,
  } = useQuery({
    queryKey: ["reservas-hoy", hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservas")
        .select("*")
        .eq("fecha", hoy)
        .order("hora", { ascending: true });

      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 sm:p-5">
                <div className="h-16 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (errorResumen) {
    return (
      <EstadoErrorCarga
        titulo="el resumen de ocupación de hoy"
        error={errorResumenDetalle}
        onReintentar={() => refetchResumen()}
      />
    );
  }

  const today = new Date();
  const reservasCanceladas = resumen?.reservasCanceladas ?? 0;

  return (
    <div className="space-y-6">
      {/* Header con fecha + Botón Gestor */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-3 rounded-xl bg-primary/10">
            <CalendarCheck className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          </div>
          <div>
            <h3 className="text-lg sm:text-2xl font-bold">
              {format(today, "EEEE, d 'de' MMMM", { locale: es })}
            </h3>
            <p className="text-muted-foreground text-xs sm:text-sm">Resumen de ocupación del día</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0 bg-destructive text-destructive-foreground hover:bg-destructive/90 w-full sm:w-auto"
          onClick={() => setKanbanOpen(true)}
        >
          <LayoutGrid className="h-4 w-4" />
          Gestor Reservas
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">

        <Card className="border-l-4 border-l-primary">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm font-medium text-muted-foreground">
                  Reservas Hoy
                </p>
                <p className="text-2xl sm:text-3xl font-bold">{resumen?.totalReservas || 0}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                  activas{reservasCanceladas > 0 ? ` · ${reservasCanceladas} cancelada(s)` : ""}
                </p>
              </div>
              <div className="p-2 sm:p-3 rounded-full bg-primary/10">
                <CalendarCheck className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-accent">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm font-medium text-muted-foreground">
                  Comensales Esperados
                </p>
                <p className="text-2xl sm:text-3xl font-bold">{resumen?.totalComensales || 0}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                  sin canceladas
                </p>
              </div>
              <div className="p-2 sm:p-3 rounded-full bg-accent/10">
                <Users className="h-4 w-4 sm:h-5 sm:w-5 text-accent" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-secondary">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm font-medium text-muted-foreground">
                  Capacidad Total
                </p>
                <p className="text-2xl sm:text-3xl font-bold">{resumen?.capacidadTotal || 0}</p>
              </div>
              <div className="p-2 sm:p-3 rounded-full bg-secondary/10">
                <MapPin className="h-4 w-4 sm:h-5 sm:w-5 text-secondary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm font-medium text-muted-foreground">
                  Ocupación del día
                </p>
                <p className="text-2xl sm:text-3xl font-bold">{resumen?.porcentajeTotal || 0}%</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                  {resumen?.totalComensales || 0}/{resumen?.capacidadTotal || 0} plazas
                </p>
              </div>
              <div className="p-2 sm:p-3 rounded-full bg-green-500/10">
                <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
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
          ) : errorReservas ? (
            <EstadoErrorCarga
              titulo="las reservas de hoy"
              error={errorReservasDetalle}
              onReintentar={() => refetchReservas()}
            />
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
                  <>
                    {/* Mobile card view */}
                    <div className="space-y-3 sm:hidden">
                      {reservasFiltradas.map((reserva) => {
                        const estadoInfo = ESTADOS_RESERVA[reserva.estado as keyof typeof ESTADOS_RESERVA] || { label: reserva.estado, color: "bg-gray-500" };
                        return (
                          <div key={reserva.id} className={cn("p-3 rounded-lg border", reserva.en_blacklist && "bg-destructive/5")}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                                <span className="font-mono font-medium">
                                  {typeof reserva.hora === 'string' ? reserva.hora.substring(0, 5) : reserva.hora}
                                </span>
                              </div>
                              <Badge className={cn("text-white", estadoInfo.color)}>
                                {estadoInfo.label}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                              <button onClick={() => toggleImportante(reserva)} className="shrink-0">
                                <Star className={cn("h-4 w-4", reserva.importante ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
                              </button>
                              <span className="font-medium text-sm">{reserva.nombre || "Sin nombre"}</span>
                              {reserva.en_blacklist && <ShieldBan className="h-4 w-4 text-destructive" />}
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <div className="flex items-center gap-3">
                                <span className="flex items-center gap-1"><Users className="h-3 w-3" />{reserva.numero_comensales}</span>
                                {reserva.telefono && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{reserva.telefono}</span>}
                              </div>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setBlacklistReserva(reserva)}>
                                <ShieldBan className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop table view */}
                    <div className="hidden sm:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Hora</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead>Contacto</TableHead>
                            <TableHead>Comensales</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead className="w-[50px]"></TableHead>
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
                                    <button onClick={() => toggleImportante(reserva)} className="shrink-0 hover:scale-110 transition-transform">
                                      <Star className={cn("h-4 w-4", reserva.importante ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-amber-400")} />
                                    </button>
                                    <span className="font-medium">{reserva.nombre || "Sin nombre"}</span>
                                    {reserva.en_blacklist && <ShieldBan className="h-4 w-4 text-destructive" />}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                                    {reserva.telefono && <div className="flex items-center gap-1"><Phone className="h-3 w-3" />{reserva.telefono}</div>}
                                    {reserva.email && <div className="flex items-center gap-1"><Mail className="h-3 w-3" />{reserva.email}</div>}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1"><Users className="h-4 w-4 text-muted-foreground" />{reserva.numero_comensales}</div>
                                </TableCell>
                                <TableCell>
                                  <Badge className={cn("text-white", estadoInfo.color)}>{estadoInfo.label}</Badge>
                                </TableCell>
                                <TableCell>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10" onClick={() => setBlacklistReserva(reserva)}>
                                    <ShieldBan className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                );
              })()}
              {/* Este pie cuadra la lista con la tarjeta "Reservas Hoy": la tarjeta
                  cuenta solo las activas y aquí se listan todos los estados. */}
              <div className="mt-4 text-sm text-muted-foreground text-center">
                {filtroEstado === "todos"
                  ? `${reservasHoy.length} reservas en total (${reservasHoy.filter(r => !["cancelada", "no_show"].includes(r.estado)).length} activas)`
                  : `${reservasHoy.filter(r => r.estado === filtroEstado).length} de ${reservasHoy.length} reservas`
                }
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={kanbanOpen} onOpenChange={setKanbanOpen}>
        <DialogContent className="max-w-[98vw] sm:max-w-[95vw] w-full h-[95vh] sm:h-[90vh] max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col p-3 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutGrid className="h-5 w-5" />
              Gestor de Reservas por Espacio
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-hidden flex-1">
            <GestorReservasKanban />
          </div>
        </DialogContent>
      </Dialog>

      <BlacklistModal
        reserva={blacklistReserva}
        open={!!blacklistReserva}
        onOpenChange={(open) => { if (!open) setBlacklistReserva(null); }}
      />
    </div>
  );
}
