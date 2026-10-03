import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CloudCog, Loader2, RefreshCw, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useEstadoResend, useSincronizarResend } from "@/hooks/useResendMarketing";
import {
  etiquetaOrigenPasada,
  etiquetaPasada,
  nivelCuota,
  porcentajeCuota,
  textoCanal,
  textoCuota,
} from "@/lib/newsletter/resend";

// Estado de la conexión con Resend Marketing (fase 2 del newsletter). La tabla
// newsletter_suscriptores sigue siendo la fuente de verdad; esto solo enseña
// cómo de cuadrado está Resend y deja forzar una sincronización (la función
// newsletter-sync-resend también se ejecuta sola cada día y antes de cada
// Broadcast). Controles táctiles de ≥ 44 px (h-11), como el resto del panel en tablet.

const COLOR_BARRA = { ok: "bg-emerald-500", aviso: "bg-amber-500", lleno: "bg-destructive" } as const;

function hace(fecha: string | null | undefined): string {
  if (!fecha) return "";
  try {
    return formatDistanceToNow(new Date(fecha), { addSuffix: true, locale: es });
  } catch {
    return "";
  }
}

export function SincronizacionResend() {
  const { data: estado, isLoading, error } = useEstadoResend();
  const { mutate: sincronizar, isPending } = useSincronizarResend();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !estado) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4">
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <CloudCog className="h-5 w-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-foreground">Resend Marketing todavía no está conectado</p>
              <p className="mt-1">
                El newsletter se envía por la vía directa de siempre. Para usar los 1.000 contactos del plan de marketing
                falta desplegar la función de sincronización y aplicar su migración.
              </p>
              {error instanceof Error && error.message ? <p className="mt-1 text-xs">Detalle: {error.message}</p> : null}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const limite = estado.limite_contactos;
  const usados = estado.contactos_resend;
  const nivel = nivelCuota(usados, limite);
  const aviso = textoCuota(usados, limite);
  const ultima = estado.ultima_pasada;
  const sinClave = !estado.configurado.api_key;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <CloudCog className="h-5 w-5 text-primary" />
          Resend Marketing
          <Badge variant={estado.canal === "broadcast" ? "default" : "secondary"} className="font-normal">
            Envío actual: {textoCanal(estado.canal)}
          </Badge>
        </CardTitle>
        <CardDescription>
          La lista de esta página es la que manda. Resend solo reparte: se le copian los activos y se le borran los que se
          dan de baja. Se sincroniza sola cada día y justo antes de cada envío como Broadcast.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Contactos usados en Resend</span>
            <span className="font-semibold tabular-nums">
              {usados ?? "—"} / {limite}
            </span>
          </div>
          <div
            className="mt-2 h-3 w-full overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-label="Contactos usados del plan de Resend"
            aria-valuemin={0}
            aria-valuemax={limite}
            aria-valuenow={usados ?? 0}
          >
            <div className={cn("h-full transition-all", COLOR_BARRA[nivel])} style={{ width: `${porcentajeCuota(usados, limite)}%` }} />
          </div>
          {aviso ? (
            <p className={cn("mt-2 flex items-start gap-2 text-sm", nivel === "lleno" ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              {aviso}
            </p>
          ) : null}
        </div>

        <div className="text-sm text-muted-foreground space-y-1">
          {ultima ? (
            <>
              <p>
                Última sincronización {hace(ultima.terminada_at ?? ultima.iniciada_at)} ({etiquetaOrigenPasada(ultima)}):{" "}
                <span className={cn("font-medium", ultima.estado === "error" ? "text-destructive" : "text-foreground")}>{etiquetaPasada(ultima)}</span>
              </p>
              {ultima.estado !== "en_curso" ? (
                <p>
                  {ultima.destinatarios ?? 0} recibirían el próximo Broadcast · {ultima.altas} añadidos · {ultima.borrados} quitados
                  {ultima.bajas_resend ? ` · ${ultima.bajas_resend} bajas desde Resend` : ""}
                  {ultima.errores ? ` · ${ultima.errores} avisos` : ""}
                  {ultima.pendientes ? ` · ${ultima.pendientes} pendientes` : ""}
                </p>
              ) : null}
              {ultima.mensaje_error ? <p className="text-destructive">{ultima.mensaje_error}</p> : null}
            </>
          ) : (
            <p>Todavía no se ha sincronizado nunca.</p>
          )}
          {sinClave ? <p className="text-destructive">Falta la clave de Resend Marketing (RESEND_MARKETING_API_KEY).</p> : null}
        </div>

        <Button className="h-11 w-full sm:w-auto" variant="outline" onClick={() => sincronizar()} disabled={isPending || sinClave}>
          {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Sincronizar con Resend
        </Button>
      </CardContent>
    </Card>
  );
}

/** Línea para «Enviar Newsletter»: por dónde va a salir el próximo envío. */
export function CanalEnvio() {
  const { data: estado, isError } = useEstadoResend();
  const canal = !isError && estado ? estado.canal : "transaccional";
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      <Send className="h-4 w-4 mt-0.5 shrink-0" />
      <span>
        Saldrá como <strong className="text-foreground">{textoCanal(canal)}</strong>
        {canal === "broadcast"
          ? ". Cada correo lleva el enlace de baja de Resend; las bajas vuelven solas a la lista."
          : ". Limitado para no dejar sin correos a las reservas."}
      </span>
    </div>
  );
}
