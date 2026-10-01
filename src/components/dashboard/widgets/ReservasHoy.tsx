import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarCheck, Users, ShieldBan, MessageSquare, AlertTriangle, Utensils, Moon, Clock, SquarePen } from "lucide-react";
import { CentroNotificaciones } from "@/components/notificaciones/CentroNotificaciones";
import { useTodayReservations, useTodayConfirmedReservations } from "@/hooks/useDashboardStats";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { ConMotivo } from "@/components/reservas/ConMotivo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { sumarCapacidadPorMarca } from "@/hooks/useDisponibilidad";
import { marcaDeEspacio, MARCA_POR_DEFECTO } from "@/lib/reservas/negocios";

/**
 * Aforo de Casa Tomás: suma de sus salas activas, igual que el trigger
 * `validar_capacidad_reserva` (que suma por marca). Solo Casa Tomás admite
 * reservas (decisión del dueño, 2026-10-01): las salas de Touza que queden
 * activas no suman, y las reservas de Touza ya no llegan aquí
 * (`useTodayReservations` las descarta). Antes la tarjeta daba un bloque de
 * ocupación por negocio.
 */
function useEspaciosCapacidad() {
  return useQuery({
    queryKey: ["ocupacion-reservas-hoy-espacios"],
    queryFn: async () => {
      const { data: espacios, error } = await supabase
        .from("espacios_reserva")
        .select("capacidad_maxima, caracteristicas")
        .eq("activa", true);

      if (error) throw error;
      return ((espacios ?? []) as any[]).map((e) => ({
        capacidad_maxima: Number(e.capacidad_maxima) || 0,
        marca: marcaDeEspacio(e),
      }));
    },
    refetchInterval: 60000,
  });
}

const getStatusColor = (p: number) => {
  if (p < 50) return { bg: "bg-green-500/10", text: "text-green-600", bar: "bg-green-500", label: "Baja" };
  if (p < 80) return { bg: "bg-amber-500/10", text: "text-amber-600", bar: "bg-amber-500", label: "Moderada" };
  return { bg: "bg-red-500/10", text: "text-red-600", bar: "bg-red-500", label: "Alta" };
};

export function ReservasHoy() {
  const navigate = useNavigate();
  // Editar una reserva desde el popup de notas (2026-09-30). El popup pasa a ser
  // controlado para poder cerrarlo al abrir el editor (dos diálogos uno encima
  // de otro no se entienden). Hooks ANTES del `return` de error de más abajo.
  const [notasAbiertas, setNotasAbiertas] = useState(false);
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { editarReserva, dialogoEdicion } = useEdicionReserva();
  const todasQuery = useTodayReservations();
  const confirmadasQuery = useTodayConfirmedReservations();
  const capacidadQuery = useEspaciosCapacidad();

  const { data: todasReservas } = todasQuery;
  const { data: reservasConfirmadas } = confirmadasQuery;
  const espaciosCapacidad = capacidadQuery.data ?? [];

  const hayError = todasQuery.isError || confirmadasQuery.isError || capacidadQuery.isError;
  const errorDetalle = todasQuery.error || confirmadasQuery.error || capacidadQuery.error;

  const ahora = new Date();
  const horaActual = ahora.getHours();
  const horaActualStr = format(ahora, "HH:mm:ss");

  // Reservas que ocupan plaza. Mismo criterio que el trigger `trg_validar_capacidad`
  // de la base de datos y que la pestaña "Hoy" de Reservas: antes la barra de ocupación
  // contaba solo confirmadas mientras las tarjetas de al lado contaban otra cosa.
  const reservasActivas = todasReservas?.filter(r =>
    ["pendiente", "verificada", "confirmada"].includes(r.estado)
  ) || [];

  // Desglose por turno (umbral 17:00, el mismo que usa el trigger)
  const reservasComida = reservasActivas.filter(r => parseInt(r.hora.split(':')[0]) < 17);
  const reservasCena = reservasActivas.filter(r => parseInt(r.hora.split(':')[0]) >= 17);
  const comensalesComida = reservasComida.reduce((acc, r) => acc + r.numero_comensales, 0);
  const comensalesCena = reservasCena.reduce((acc, r) => acc + r.numero_comensales, 0);
  const comensalesActivos = reservasActivas.reduce((acc, r) => acc + r.numero_comensales, 0);

  // Ocupación de Casa Tomás contra su aforo (como el trigger).
  const capacidad = sumarCapacidadPorMarca(espaciosCapacidad, MARCA_POR_DEFECTO);
  const porcentaje = capacidad > 0 ? Math.round((comensalesActivos / capacidad) * 100) : 0;
  const colors = getStatusColor(porcentaje);

  // Alertas
  const reservasBlacklist = todasReservas?.filter(r => r.en_blacklist) || [];
  const reservasConNotas = todasReservas?.filter(r => r.notas_cliente && r.notas_cliente.trim() !== '') || [];

  // Estados
  const numConfirmadas = todasReservas?.filter(r => r.estado === "confirmada").length || 0;
  const reservasPendientes = todasReservas?.filter(r => r.estado === "pendiente").length || 0;
  const reservasVerificadas = todasReservas?.filter(r => r.estado === "verificada").length || 0;

  // Un fallo de red o de permisos no puede pintarse como "0 reservas, 0% de ocupación".
  if (hayError) {
    return (
      <EstadoErrorCarga
        titulo="las reservas de hoy"
        error={errorDetalle}
        onReintentar={() => {
          todasQuery.refetch();
          confirmadasQuery.refetch();
          capacidadQuery.refetch();
        }}
        className="h-full"
      />
    );
  }

  // Reservas en riesgo
  const reservasEnRiesgo = todasReservas?.filter(r => {
    if (r.estado !== "pendiente") return false;
    const [h, m] = r.hora.split(':').map(Number);
    const horaReserva = new Date();
    horaReserva.setHours(h, m, 0, 0);
    const diffMs = horaReserva.getTime() - ahora.getTime();
    return diffMs > 0 && diffMs <= 60 * 60 * 1000;
  }) || [];

  // Próxima reserva confirmada
  const proximaReserva = (reservasConfirmadas || [])
    .filter(r => r.hora >= horaActualStr)
    .sort((a, b) => a.hora.localeCompare(b.hora))[0];

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-semibold">Reservas de Hoy</CardTitle>
        <div className="flex items-center gap-2">
          {reservasBlacklist.length > 0 && (
            <Badge variant="destructive" className="gap-1">
              <ShieldBan className="h-3 w-3" />
              {reservasBlacklist.length}
            </Badge>
          )}
          {reservasConNotas.length > 0 && (
            <Dialog open={notasAbiertas} onOpenChange={setNotasAbiertas}>
              <DialogTrigger asChild>
                <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-secondary/80 transition-colors">
                  <MessageSquare className="h-3 w-3" />
                  {reservasConNotas.length}
                </Badge>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-primary" />
                    Notas y peticiones especiales
                  </DialogTitle>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh]">
                  <div className="space-y-3 pr-4">
                    {reservasConNotas.map(r => (
                      <div key={r.id} className="p-3 bg-muted/50 rounded-lg border">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <span className="font-medium">{r.nombre || "Sin nombre"}</span>
                            <span className="text-muted-foreground text-sm ml-2">· {r.numero_comensales} pax</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline">{r.hora.substring(0, 5)}</Badge>
                            {/* Editar datos, día, hora, comensales, sala o notas de esta
                                reserva, sea cual sea su estado. Cierra el popup antes. El
                                botón deshabilitado no recibe el ratón: el motivo se ve en
                                el envoltorio. */}
                            <ConMotivo motivo={puedeEditar ? undefined : "No tienes permiso para editar reservas"}>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground"
                                disabled={!puedeEditar}
                                aria-label={`Editar la reserva de ${r.nombre || "este cliente"}`}
                                title={puedeEditar ? "Editar la reserva" : "No tienes permiso para editar reservas"}
                                onClick={() => {
                                  setNotasAbiertas(false);
                                  editarReserva(r.id);
                                }}
                              >
                                <SquarePen className="h-3.5 w-3.5" />
                              </Button>
                            </ConMotivo>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground bg-background p-2 rounded italic">
                          "{r.notas_cliente}"
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          )}
          {reservasEnRiesgo.length > 0 && (
            <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              {reservasEnRiesgo.length}
            </Badge>
          )}
          <CalendarCheck className="h-5 w-5 text-primary" />
          {/* La campana vivía en la cabecera del menú lateral (AppSidebar.tsx);
              se mudó aquí para que el cubierto decorativo del sidebar pudiera
              volver, a petición del dueño. */}
          <CentroNotificaciones className="h-7 w-7" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Ocupación de hoy contra el aforo del restaurante */}
        <div className="space-y-2">
          <div className={`p-3 rounded-lg ${colors.bg}`}>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-2xl font-bold ${colors.text}`}>{porcentaje}%</span>
                <Badge variant="outline" className={`${colors.text} border-current text-[10px]`}>
                  {colors.label}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {comensalesActivos}/{capacidad} pax · {reservasActivas.length} res.
              </span>
            </div>
            <div className="h-2 bg-background/50 rounded-full overflow-hidden">
              <div
                className={`h-full ${colors.bar} transition-all duration-500`}
                style={{ width: `${Math.min(100, porcentaje)}%` }}
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {reservasActivas.length} reservas activas ({comensalesActivos} pax, sin canceladas) = {numConfirmadas} confirmadas
            + {reservasVerificadas} verificadas + {reservasPendientes} pendientes
          </p>
        </div>

        {/* Desglose por turno */}
        <div className="grid grid-cols-1 xs:grid-cols-2 gap-2 sm:gap-3">
          <div className={`p-2 sm:p-3 rounded-lg border ${horaActual < 17 ? 'border-primary bg-primary/5' : 'bg-muted/30'}`}>
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
              <Utensils className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-600" />
              <span className="text-xs sm:text-sm font-medium">Comida</span>
              {horaActual < 17 && <Badge variant="default" className="text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0">Ahora</Badge>}
            </div>
            <div className="flex items-baseline gap-1.5 sm:gap-2">
              <span className="text-xl sm:text-2xl font-bold">{reservasComida.length}</span>
              <span className="text-[10px] sm:text-xs text-muted-foreground">reservas</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
              <Users className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
              {comensalesComida} comensales
            </div>
          </div>

          <div className={`p-2 sm:p-3 rounded-lg border ${horaActual >= 17 ? 'border-primary bg-primary/5' : 'bg-muted/30'}`}>
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
              <Moon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-indigo-500" />
              <span className="text-xs sm:text-sm font-medium">Cena</span>
              {horaActual >= 17 && <Badge variant="default" className="text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0">Ahora</Badge>}
            </div>
            <div className="flex items-baseline gap-1.5 sm:gap-2">
              <span className="text-xl sm:text-2xl font-bold">{reservasCena.length}</span>
              <span className="text-[10px] sm:text-xs text-muted-foreground">reservas</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
              <Users className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
              {comensalesCena} comensales
            </div>
          </div>
        </div>

        {/* Estados + Próxima reserva */}
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
          <div className="text-center p-2 sm:p-3 bg-primary/10 rounded-lg">
            <div className="text-lg sm:text-2xl font-bold text-primary">{reservasActivas.length}</div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">Activas</p>
          </div>
          <div className="text-center p-2 sm:p-3 bg-green-500/10 rounded-lg">
            <div className="text-lg sm:text-2xl font-bold text-green-600">{numConfirmadas}</div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">Confirmadas</p>
          </div>
          <div
            className="text-center p-2 sm:p-3 bg-amber-500/10 rounded-lg cursor-pointer hover:bg-amber-500/20 transition-colors"
            onClick={() => navigate('/reservas?tab=reservas&status=pendiente&date=today')}
          >
            <div className="text-lg sm:text-2xl font-bold text-amber-600">{reservasPendientes}</div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">Pendientes</p>
          </div>
          {proximaReserva ? (
            <div className="text-center p-2 sm:p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-center gap-1">
                <Clock className="h-3 w-3 text-muted-foreground" />
              </div>
              <div className="text-lg sm:text-xl font-bold">{proximaReserva.hora.slice(0, 5)}</div>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">Próxima</p>
            </div>
          ) : (
            <div className="text-center p-2 sm:p-3 bg-muted/50 rounded-lg">
              <div className="text-lg sm:text-2xl font-bold text-muted-foreground">—</div>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">Próxima</p>
            </div>
          )}
        </div>
      </CardContent>
      {/* Editor de la reserva elegida en el popup de notas. `null` hasta que se pide. */}
      {dialogoEdicion}
    </Card>
  );
}
