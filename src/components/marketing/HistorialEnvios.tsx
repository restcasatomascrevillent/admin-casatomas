import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { History } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useHistorialEnvios, type EnvioNewsletter } from "@/hooks/useResendMarketing";

// Historial de envíos del newsletter (newsletter_envios): canal de cada uno y,
// para los Broadcasts, entregas/aperturas/clics/rebotes a partir de los eventos
// que archiva resend-webhook (newsletter_estadisticas_broadcasts). Las
// aperturas son orientativas: los clientes de correo las bloquean o inflan.

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
  if (!s) return <span>{e.total_destinatarios} destinatarios · estadísticas en cuanto Resend las mande</span>;
  return (
    <span>
      {e.total_destinatarios} destinatarios · {s.entregados} entregados · {s.abiertos} abiertos · {s.clics} con clic
      {s.rebotes ? ` · ${s.rebotes} rebotes` : ""}
      {s.quejas ? ` · ${s.quejas} spam` : ""}
    </span>
  );
}

export function HistorialEnvios() {
  const { data: envios, isLoading, error } = useHistorialEnvios();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5 text-primary" />
          Historial de envíos
        </CardTitle>
        <CardDescription>Los últimos newsletters enviados y por dónde salieron.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">No se pudo cargar el historial.</p>
        ) : !envios?.length ? (
          <p className="text-sm text-muted-foreground">Todavía no se ha enviado ningún newsletter.</p>
        ) : (
          <ul className="divide-y">
            {envios.map((e) => (
              <li key={e.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-words">{e.asunto}</span>
                  <Badge variant={e.canal === "broadcast" ? "default" : "secondary"} className="font-normal">
                    {e.canal === "broadcast" ? "Broadcast" : "Directo"}
                  </Badge>
                  {e.estado ? (
                    <Badge variant={e.estado === "fallido" ? "destructive" : "outline"} className="font-normal">
                      {ETIQUETA_ESTADO[e.estado] ?? e.estado}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
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
