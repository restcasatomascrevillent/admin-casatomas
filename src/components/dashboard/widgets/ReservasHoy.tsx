import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarCheck, Clock, Users, TrendingUp, ShieldBan, MessageSquare, AlertTriangle, Utensils, Moon } from "lucide-react";
import { useTodayReservations } from "@/hooks/useDashboardStats";
import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

export function ReservasHoy() {
  const { data: reservas } = useTodayReservations();
  const { data: ocupacion } = useResumenOcupacionHoy();

  const ahora = new Date();
  const horaActual = ahora.getHours();

  // Desglose por turno (Comida < 17:00, Cena >= 17:00)
  const reservasComida = reservas?.filter(r => {
    const hora = parseInt(r.hora.split(':')[0]);
    return hora < 17;
  }) || [];
  
  const reservasCena = reservas?.filter(r => {
    const hora = parseInt(r.hora.split(':')[0]);
    return hora >= 17;
  }) || [];

  const comensalesComida = reservasComida.reduce((acc, r) => acc + r.numero_comensales, 0);
  const comensalesCena = reservasCena.reduce((acc, r) => acc + r.numero_comensales, 0);

  // Blacklist y notas
  const reservasBlacklist = reservas?.filter(r => r.en_blacklist) || [];
  const reservasConNotas = reservas?.filter(r => r.notas_cliente && r.notas_cliente.trim() !== '') || [];

  // Estados
  const reservasConfirmadas = reservas?.filter(r => r.estado === "confirmada").length || 0;
  const reservasPendientes = reservas?.filter(r => r.estado === "pendiente").length || 0;
  const reservasVerificadas = reservas?.filter(r => r.estado === "verificada").length || 0;

  // Reservas en riesgo (pendientes dentro de 1 hora)
  const reservasEnRiesgo = reservas?.filter(r => {
    if (r.estado !== "pendiente") return false;
    const [h, m] = r.hora.split(':').map(Number);
    const horaReserva = new Date();
    horaReserva.setHours(h, m, 0, 0);
    const diffMs = horaReserva.getTime() - ahora.getTime();
    return diffMs > 0 && diffMs <= 60 * 60 * 1000;
  }) || [];

  // Próximas reservas (próximas 2 horas)
  const proximasReservas = reservas?.filter(r => {
    const [h, m] = r.hora.split(':').map(Number);
    const horaReserva = new Date();
    horaReserva.setHours(h, m, 0, 0);
    const diffMs = horaReserva.getTime() - ahora.getTime();
    return diffMs > 0 && diffMs <= 2 * 60 * 60 * 1000;
  }).slice(0, 4) || [];

  // Color según ocupación
  const getOcupacionColor = (porcentaje: number) => {
    if (porcentaje < 50) return "bg-green-500";
    if (porcentaje < 80) return "bg-amber-500";
    return "bg-red-500";
  };

  const getOcupacionBg = (porcentaje: number) => {
    if (porcentaje < 50) return "bg-green-500/20";
    if (porcentaje < 80) return "bg-amber-500/20";
    return "bg-red-500/20";
  };

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
            <Popover>
              <PopoverTrigger asChild>
                <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-secondary/80 transition-colors">
                  <MessageSquare className="h-3 w-3" />
                  {reservasConNotas.length}
                </Badge>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="end">
                <div className="p-3 border-b">
                  <h4 className="font-semibold text-sm">Reservas con notas especiales</h4>
                  <p className="text-xs text-muted-foreground">{reservasConNotas.length} reservas tienen peticiones</p>
                </div>
                <ScrollArea className="max-h-64">
                  <div className="p-2 space-y-2">
                    {reservasConNotas.map((r) => (
                      <div key={r.id} className="p-2 bg-muted/50 rounded-lg text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{r.nombre || "Sin nombre"}</span>
                          <Badge variant="outline" className="text-[10px]">{r.hora.substring(0, 5)}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground italic">"{r.notas_cliente}"</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          )}
          {reservasEnRiesgo.length > 0 && (
            <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              {reservasEnRiesgo.length}
            </Badge>
          )}
          <CalendarCheck className="h-5 w-5 text-primary" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Desglose por Turno */}
        <div className="grid grid-cols-2 gap-3">
          <div className={`p-3 rounded-lg border ${horaActual < 17 ? 'border-primary bg-primary/5' : 'bg-muted/30'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Utensils className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-medium">Comida</span>
              {horaActual < 17 && <Badge variant="default" className="text-[10px] px-1.5 py-0">Ahora</Badge>}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{reservasComida.length}</span>
              <span className="text-xs text-muted-foreground">reservas</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <Users className="h-3 w-3" />
              {comensalesComida} comensales
            </div>
          </div>
          
          <div className={`p-3 rounded-lg border ${horaActual >= 17 ? 'border-primary bg-primary/5' : 'bg-muted/30'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Moon className="h-4 w-4 text-indigo-500" />
              <span className="text-sm font-medium">Cena</span>
              {horaActual >= 17 && <Badge variant="default" className="text-[10px] px-1.5 py-0">Ahora</Badge>}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{reservasCena.length}</span>
              <span className="text-xs text-muted-foreground">reservas</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <Users className="h-3 w-3" />
              {comensalesCena} comensales
            </div>
          </div>
        </div>

        {/* Estados */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2 bg-primary/10 rounded-lg">
            <div className="text-xl font-bold text-primary">{reservas?.length || 0}</div>
            <p className="text-[10px] text-muted-foreground">Total</p>
          </div>
          <div className="text-center p-2 bg-green-500/10 rounded-lg">
            <div className="text-xl font-bold text-green-600">{reservasConfirmadas + reservasVerificadas}</div>
            <p className="text-[10px] text-muted-foreground">Confirmadas</p>
          </div>
          <div className="text-center p-2 bg-amber-500/10 rounded-lg">
            <div className="text-xl font-bold text-amber-600">{reservasPendientes}</div>
            <p className="text-[10px] text-muted-foreground">Pendientes</p>
          </div>
        </div>

        {/* Ocupación por Sala */}
        {ocupacion && ocupacion.espacios && ocupacion.espacios.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> Ocupación por espacio
            </p>
            <div className="space-y-1.5">
              {ocupacion.espacios.slice(0, 4).map((espacio) => (
                <div key={espacio.espacio_id} className="flex items-center gap-2">
                  <span className="text-xs w-20 truncate" title={espacio.espacio_nombre}>
                    {espacio.espacio_nombre}
                  </span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${getOcupacionColor(espacio.porcentaje_ocupacion)} transition-all`}
                      style={{ width: `${Math.min(100, espacio.porcentaje_ocupacion)}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium w-10 text-right">
                    {espacio.porcentaje_ocupacion}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Próximas Reservas */}
        {proximasReservas.length > 0 && (
          <div className="pt-3 border-t space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Próximas 2 horas
            </p>
            {proximasReservas.map((r) => {
              const esRiesgo = reservasEnRiesgo.some(rr => rr.id === r.id);
              const esBlacklist = r.en_blacklist;
              const tieneNotas = r.notas_cliente && r.notas_cliente.trim() !== '';
              
              return (
                <div 
                  key={r.id} 
                  className={`flex items-center justify-between text-sm p-2 rounded ${
                    esBlacklist ? 'bg-red-500/10 border border-red-500/30' : 
                    esRiesgo ? 'bg-amber-500/10 border border-amber-500/30' : 
                    'bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {esBlacklist && <ShieldBan className="h-3.5 w-3.5 text-red-500" />}
                    {esRiesgo && !esBlacklist && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                    <div>
                      <span className="font-medium">{r.nombre || "Sin nombre"}</span>
                      <span className="text-muted-foreground ml-2">· {r.numero_comensales} pax</span>
                    </div>
                    {tieneNotas && <MessageSquare className="h-3 w-3 text-muted-foreground" />}
                  </div>
                  <Badge variant="outline">{r.hora.substring(0, 5)}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
