import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarCheck, Users, ShieldBan, MessageSquare, AlertTriangle, Utensils, Moon } from "lucide-react";
import { useTodayReservations, useTodayConfirmedReservations } from "@/hooks/useDashboardStats";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigate } from "react-router-dom";
export function ReservasHoy() {
  const navigate = useNavigate();
  const {
    data: todasReservas
  } = useTodayReservations();
  const {
    data: reservasConfirmadas
  } = useTodayConfirmedReservations();
  const ahora = new Date();
  const horaActual = ahora.getHours();

  // Desglose por turno SOLO con reservas confirmadas (Comida < 17:00, Cena >= 17:00)
  const reservasComidaConfirmadas = reservasConfirmadas?.filter(r => {
    const hora = parseInt(r.hora.split(':')[0]);
    return hora < 17;
  }) || [];
  const reservasCenaConfirmadas = reservasConfirmadas?.filter(r => {
    const hora = parseInt(r.hora.split(':')[0]);
    return hora >= 17;
  }) || [];
  const comensalesComida = reservasComidaConfirmadas.reduce((acc, r) => acc + r.numero_comensales, 0);
  const comensalesCena = reservasCenaConfirmadas.reduce((acc, r) => acc + r.numero_comensales, 0);

  // Blacklist y notas - usar todas las reservas no canceladas
  const reservasBlacklist = todasReservas?.filter(r => r.en_blacklist) || [];
  const reservasConNotas = todasReservas?.filter(r => r.notas_cliente && r.notas_cliente.trim() !== '') || [];

  // Estados - usar todas las reservas
  const numConfirmadas = todasReservas?.filter(r => r.estado === "confirmada").length || 0;
  const reservasPendientes = todasReservas?.filter(r => r.estado === "pendiente").length || 0;
  const reservasVerificadas = todasReservas?.filter(r => r.estado === "verificada").length || 0;

  // Reservas en riesgo (pendientes dentro de 1 hora)
  const reservasEnRiesgo = todasReservas?.filter(r => {
    if (r.estado !== "pendiente") return false;
    const [h, m] = r.hora.split(':').map(Number);
    const horaReserva = new Date();
    horaReserva.setHours(h, m, 0, 0);
    const diffMs = horaReserva.getTime() - ahora.getTime();
    return diffMs > 0 && diffMs <= 60 * 60 * 1000;
  }) || [];
  return <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-semibold">Reservas de Hoy</CardTitle>
        <div className="flex items-center gap-2">
          {reservasBlacklist.length > 0 && <Badge variant="destructive" className="gap-1">
              <ShieldBan className="h-3 w-3" />
              {reservasBlacklist.length}
            </Badge>}
          {reservasConNotas.length > 0 && <Dialog>
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
                    {reservasConNotas.map(r => <div key={r.id} className="p-3 bg-muted/50 rounded-lg border">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <span className="font-medium">{r.nombre || "Sin nombre"}</span>
                            <span className="text-muted-foreground text-sm ml-2">· {r.numero_comensales} pax</span>
                          </div>
                          <Badge variant="outline">{r.hora.substring(0, 5)}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground bg-background p-2 rounded italic">
                          "{r.notas_cliente}"
                        </p>
                      </div>)}
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>}
          {reservasEnRiesgo.length > 0 && <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              {reservasEnRiesgo.length}
            </Badge>}
          <CalendarCheck className="h-5 w-5 text-primary" />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Desglose por Turno */}
        <div className="grid grid-cols-1 xs:grid-cols-2 gap-2 sm:gap-3">
          <div className={`p-2 sm:p-3 rounded-lg border ${horaActual < 17 ? 'border-primary bg-primary/5' : 'bg-muted/30'}`}>
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
              <Utensils className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-600" />
              <span className="text-xs sm:text-sm font-medium">Comida</span>
              {horaActual < 17 && <Badge variant="default" className="text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0">Ahora</Badge>}
            </div>
            <div className="flex items-baseline gap-1.5 sm:gap-2">
              <span className="text-xl sm:text-2xl font-bold">{reservasComidaConfirmadas.length}</span>
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
              <span className="text-xl sm:text-2xl font-bold">{reservasCenaConfirmadas.length}</span>
              <span className="text-[10px] sm:text-xs text-muted-foreground">reservas</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
              <Users className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
              {comensalesCena} comensales
            </div>
          </div>
        </div>

        {/* Estados */}
        <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
          <div className="text-center p-2 sm:p-3 bg-primary/10 rounded-lg">
            <div className="text-lg sm:text-2xl font-bold text-primary">{todasReservas?.length || 0}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 text-center">Total</p>
          </div>
          <div className="text-center p-2 sm:p-3 bg-green-500/10 rounded-lg">
            <div className="text-lg sm:text-2xl font-bold text-green-600">{numConfirmadas + reservasVerificadas}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 text-center">Confirmadas</p>
          </div>
          <div className="text-center p-2 sm:p-3 bg-amber-500/10 rounded-lg cursor-pointer hover:bg-amber-500/20 transition-colors" onClick={() => navigate('/reservas?tab=lista&status=pendiente&date=today')}>
            <div className="text-lg sm:text-2xl font-bold text-amber-600">{reservasPendientes}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 text-center">Pendientes</p>
          </div>
        </div>

      </CardContent>
    </Card>;
}