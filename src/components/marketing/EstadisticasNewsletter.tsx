import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEmailEventosStats, useEmailEventosRecientes, useEmailEventosPorDia } from "@/hooks/useEmailEventos";
import { 
  Send, 
  CheckCircle, 
  Mail, 
  MousePointerClick, 
  AlertTriangle, 
  RefreshCw,
  TrendingUp,
  Clock,
  XCircle,
  AlertCircle
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const eventoBadgeVariant: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  sent: { color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", icon: <Send className="h-3 w-3" />, label: "Enviado" },
  delivered: { color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300", icon: <CheckCircle className="h-3 w-3" />, label: "Entregado" },
  opened: { color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", icon: <Mail className="h-3 w-3" />, label: "Abierto" },
  clicked: { color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300", icon: <MousePointerClick className="h-3 w-3" />, label: "Clic" },
  bounced: { color: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300", icon: <XCircle className="h-3 w-3" />, label: "No entregado" },
  complained: { color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300", icon: <AlertCircle className="h-3 w-3" />, label: "Marcado como spam" },
};

export function EstadisticasNewsletter() {
  const { data: statsData, isLoading: loadingStats, isError: errorStats, refetch: refetchStats, isFetching } = useEmailEventosStats();
  const { data: eventosRecientes, isLoading: loadingRecientes } = useEmailEventosRecientes(8);
  const { data: eventosPorDia } = useEmailEventosPorDia(7);

  if (loadingStats) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (errorStats) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <p className="font-medium">No se pudieron cargar las estadísticas</p>
            <Button onClick={() => refetchStats()} className="mt-4" variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Reintentar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const stats = statsData?.stats;
  const rates = statsData?.rates;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Estadísticas de los correos</h3>
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Se actualizan solas cuando llegan los datos de cada correo
          </p>
        </div>
        <Button 
          onClick={() => refetchStats()} 
          variant="outline" 
          size="sm"
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      {/* Main stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total enviados</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.sent || 0}</div>
            <p className="text-xs text-muted-foreground">correos enviados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Entregados</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{rates?.deliveryRate || 0}%</div>
            <p className="text-xs text-muted-foreground">
              {(stats?.delivered || 0) + (stats?.opened || 0) + (stats?.clicked || 0)} entregados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Abiertos</CardTitle>
            <Mail className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{rates?.openRate || 0}%</div>
            <p className="text-xs text-muted-foreground">
              {(stats?.opened || 0) + (stats?.clicked || 0)} abiertos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Con clic</CardTitle>
            <MousePointerClick className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{rates?.clickRate || 0}%</div>
            <p className="text-xs text-muted-foreground">
              {stats?.clicked || 0} clics
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico de tendencia */}
      {eventosPorDia && eventosPorDia.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Últimos 7 días
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={eventosPorDia}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="fecha" 
                    tickFormatter={(value) => format(new Date(value), "d MMM", { locale: es })}
                    className="text-xs"
                  />
                  <YAxis className="text-xs" />
                  <Tooltip 
                    labelFormatter={(value) => format(new Date(value), "d MMMM yyyy", { locale: es })}
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--background))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="sent" name="Enviados" stroke="#64748b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="delivered" name="Entregados" stroke="#22c55e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="opened" name="Abiertos" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="clicked" name="Clics" stroke="#a855f7" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detailed breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Desglose</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{stats?.sent || 0}</div>
              <div className="text-xs text-muted-foreground">Enviados</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-green-50 dark:bg-green-950">
              <div className="text-2xl font-bold text-green-600">{stats?.delivered || 0}</div>
              <div className="text-xs text-muted-foreground">Entregados</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-blue-50 dark:bg-blue-950">
              <div className="text-2xl font-bold text-blue-600">{stats?.opened || 0}</div>
              <div className="text-xs text-muted-foreground">Abiertos</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-purple-50 dark:bg-purple-950">
              <div className="text-2xl font-bold text-purple-600">{stats?.clicked || 0}</div>
              <div className="text-xs text-muted-foreground">Clics</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-orange-50 dark:bg-orange-950">
              <div className="text-2xl font-bold text-orange-600">{stats?.bounced || 0}</div>
              <div className="text-xs text-muted-foreground">No entregados</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-red-50 dark:bg-red-950">
              <div className="text-2xl font-bold text-red-600">{stats?.complained || 0}</div>
              <div className="text-xs text-muted-foreground">Marcados como spam</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Eventos recientes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Últimos movimientos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingRecientes ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : eventosRecientes && eventosRecientes.length > 0 ? (
            <div className="space-y-3">
              {eventosRecientes.map((evento) => {
                const config = eventoBadgeVariant[evento.tipo_evento] || eventoBadgeVariant.sent;
                return (
                  <div key={evento.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Badge className={`${config.color} gap-1`}>
                        {config.icon}
                        {config.label}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {evento.email_destinatario || "Email no disponible"}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {evento.timestamp_evento 
                        ? format(new Date(evento.timestamp_evento), "d MMM, HH:mm", { locale: es })
                        : "-"}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Todavía no hay movimientos</p>
              <p className="text-sm mt-1">Aparecerán aquí en cuanto se envíe una newsletter.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info notice */}
      <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium">Las aperturas y los clics son orientativos</p>
              <p className="mt-1">
                Algunos programas de correo bloquean o inflan estos datos, así que úsalos como referencia, no como cifra exacta.
              </p>
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer select-none py-2">Detalle técnico</summary>
                <p className="break-words">
                  Los datos llegan por un webhook de Resend (resend.com/webhooks) que apunta a{" "}
                  <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">
                    https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/resend-webhook
                  </code>
                </p>
              </details>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
