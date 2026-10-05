import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEstadisticasCorreos } from "@/hooks/useEmailEventos";
import { Send, CheckCircle, Mail, MousePointerClick, AlertTriangle, RefreshCw, TrendingUp } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

// Todas las cifras de esta pestaña salen de UNA cuenta (`resumirEventosCorreo`,
// lib/newsletter/estadisticasCorreos.ts): cada correo cuenta una vez en cada
// estado y los porcentajes son siempre sobre los enviados. Antes las tarjetas
// sumaban conjuntos que se solapan (39 «entregados» de 30 enviados) y no
// cuadraban con el desglose. Ver la cabecera de ese fichero.

const ESTILO_TOOLTIP = {
  backgroundColor: "hsl(var(--background))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
} as const;

export function EstadisticasNewsletter() {
  const { data, isLoading, isError, refetch, isFetching } = useEstadisticasCorreos();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <p className="font-medium">No se pudieron cargar las estadísticas</p>
            <Button onClick={() => refetch()} className="mt-4 min-h-11" variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Reintentar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { cifras, tasas, porDia, truncado } = data;
  const deEnviados = (n: number) => `${n} de ${cifras.enviados} correos`;
  const hayTendencia = porDia.some((d) => d.enviados || d.entregados || d.abiertos || d.clics);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">Estadísticas de los correos</h3>
          <p className="text-sm text-muted-foreground">
            Cuenta todos los correos que envía el restaurante: los de las reservas y los de la newsletter. Cada correo
            cuenta una sola vez y los porcentajes son sobre los enviados. Se actualizan solas cada minuto.
          </p>
          {truncado && (
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              Hay tantos datos que solo se cuentan los más recientes; los correos más antiguos pueden faltar.
            </p>
          )}
        </div>
        <Button onClick={() => refetch()} variant="outline" className="min-h-11 shrink-0" disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Enviados</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{cifras.enviados}</div>
            <p className="text-xs text-muted-foreground">correos enviados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Entregados</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{tasas.entrega}%</div>
            <p className="text-xs text-muted-foreground">{deEnviados(cifras.entregados)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Abiertos</CardTitle>
            <Mail className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{tasas.apertura}%</div>
            <p className="text-xs text-muted-foreground">{deEnviados(cifras.abiertos)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Con clic</CardTitle>
            <MousePointerClick className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{tasas.clics}%</div>
            <p className="text-xs text-muted-foreground">{deEnviados(cifras.clics)}</p>
          </CardContent>
        </Card>
      </div>

      {hayTendencia && (
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
                <LineChart data={porDia}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="fecha"
                    tickFormatter={(value) => format(parseISO(value), "d MMM", { locale: es })}
                    className="text-xs"
                  />
                  <YAxis className="text-xs" allowDecimals={false} />
                  <Tooltip
                    labelFormatter={(value) => format(parseISO(String(value)), "d MMMM yyyy", { locale: es })}
                    contentStyle={ESTILO_TOOLTIP}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="enviados" name="Enviados" stroke="#64748b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="entregados" name="Entregados" stroke="#22c55e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="abiertos" name="Abiertos" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="clics" name="Con clic" stroke="#a855f7" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Desglose</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{cifras.enviados}</div>
              <div className="text-xs text-muted-foreground">Enviados</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-green-50 dark:bg-green-950">
              <div className="text-2xl font-bold text-green-600">{cifras.entregados}</div>
              <div className="text-xs text-muted-foreground">Entregados</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-blue-50 dark:bg-blue-950">
              <div className="text-2xl font-bold text-blue-600">{cifras.abiertos}</div>
              <div className="text-xs text-muted-foreground">Abiertos</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-purple-50 dark:bg-purple-950">
              <div className="text-2xl font-bold text-purple-600">{cifras.clics}</div>
              <div className="text-xs text-muted-foreground">Con clic</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-orange-50 dark:bg-orange-950">
              <div className="text-2xl font-bold text-orange-600">{cifras.noEntregados}</div>
              <div className="text-xs text-muted-foreground">No entregados</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-red-50 dark:bg-red-950">
              <div className="text-2xl font-bold text-red-600">{cifras.spam}</div>
              <div className="text-xs text-muted-foreground">Marcados como spam</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
