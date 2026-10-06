import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { History } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useHistorialEnvios, type EnvioNewsletter } from "@/hooks/useResendMarketing";

// Historial de envíos del newsletter (newsletter_envios): cómo salió cada uno y,
// para los envíos por lista (Broadcast), entregas/aperturas/clics/rebotes a
// partir de los eventos que archiva resend-webhook
// (newsletter_estadisticas_broadcasts). Las aperturas son orientativas: los
// clientes de correo las bloquean o inflan.

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: "Pendiente",
  completado: "Enviado",
  parcial: "Enviado en parte",
  fallido: "Fallido",
};

function Cifras({ e }: { e: EnvioNewsletter }) {
  if (e.canal !== "broadcast") {
    return <span>{e.total_destinatarios} destinatarios</span>;
  }
  const s = e.estadisticas;
  if (!s) return <span>{e.total_destinatarios} destinatarios · las estadísticas aparecerán en cuanto lleguen los primeros datos</span>;
  return (
    <span>
      {e.total_destinatarios} destinatarios · {s.entregados} entregados · {s.abiertos} abiertos · {s.clics} con clic
      {s.rebotes ? ` · ${s.rebotes} no entregados` : ""}
      {s.quejas ? ` · ${s.quejas} marcados como spam` : ""}
    </span>
  );
}

// Compacto y con el alto que le dé su contenedor (pestaña Estadísticas, junto a la gráfica): si hay más
// envíos de los que caben, solo la lista hace scroll; si caben, no hay scroll ninguno.
export function HistorialEnvios() {
  const { data: envios, isLoading, error } = useHistorialEnvios();

  return (
    <Card className="flex min-h-[8rem] flex-1 flex-col">
      <CardHeader className="shrink-0 space-y-0.5 p-3 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <History className="h-4 w-4 text-primary" aria-hidden="true" />
          Historial de envíos
        </CardTitle>
        <CardDescription className="text-xs">Las últimas newsletters enviadas y cómo salieron.</CardDescription>
      </CardHeader>
      <CardContent data-testid="lista-historial" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pt-0">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">No se pudo cargar el historial.</p>
        ) : !envios?.length ? (
          <p className="text-sm text-muted-foreground">Todavía no se ha enviado ninguna newsletter.</p>
        ) : (
          <ul className="divide-y">
            {envios.map((e) => (
              <li key={e.id} className="py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium break-words">{e.asunto}</span>
                  <Badge variant={e.canal === "broadcast" ? "default" : "secondary"} className="font-normal">
                    {e.canal === "broadcast" ? "Lista de envío" : "Correo directo"}
                  </Badge>
                  {e.estado ? (
                    <Badge variant={e.estado === "fallido" ? "destructive" : "outline"} className="font-normal">
                      {ETIQUETA_ESTADO[e.estado] ?? e.estado}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {format(new Date(e.created_at), "d MMM yyyy, HH:mm", { locale: es })} · <Cifras e={e} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
