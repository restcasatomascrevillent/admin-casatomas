import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useResendStats } from "@/hooks/useResendStats";
import { 
  Send, 
  CheckCircle, 
  Mail, 
  MousePointerClick, 
  AlertTriangle, 
  RefreshCw,
  TrendingUp,
  Clock
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function EstadisticasNewsletter() {
  const { data, isLoading, isError, error, refetch, isFetching } = useResendStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <p className="font-medium">Error al cargar estadísticas</p>
            <p className="text-sm mt-1">{error?.message}</p>
            <Button onClick={() => refetch()} className="mt-4" variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Reintentar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const stats = data?.stats;
  const rates = data?.rates;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Estadísticas de Email</h3>
          {data?.lastUpdated && (
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Última actualización: {format(new Date(data.lastUpdated), "d MMM yyyy, HH:mm", { locale: es })}
            </p>
          )}
        </div>
        <Button 
          onClick={() => refetch()} 
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
            <CardTitle className="text-sm font-medium">Total Enviados</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
            <p className="text-xs text-muted-foreground">emails en historial</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasa de Entrega</CardTitle>
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
            <CardTitle className="text-sm font-medium">Tasa de Apertura</CardTitle>
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
            <CardTitle className="text-sm font-medium">Tasa de Clics</CardTitle>
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

      {/* Detailed breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Desglose Detallado
          </CardTitle>
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
              <div className="text-xs text-muted-foreground">Rebotados</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-red-50 dark:bg-red-950">
              <div className="text-2xl font-bold text-red-600">{stats?.complained || 0}</div>
              <div className="text-xs text-muted-foreground">Quejas</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Info notice */}
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <p className="font-medium">Modo de pruebas activo</p>
              <p className="mt-1">
                Estás usando Resend en modo de pruebas. Las estadísticas de apertura y clics 
                solo funcionan con un dominio verificado. Para obtener métricas completas, 
                verifica un dominio en <a href="https://resend.com/domains" target="_blank" rel="noopener" className="underline">resend.com/domains</a>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
