import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AyudaPopover } from "@/components/AyudaPopover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CloudCog, Info, Loader2, RefreshCw, Send } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useEstadoResend, useSincronizarResend } from "@/hooks/useResendMarketing";
import { useCanAccessSection } from "@/hooks/useUserRole";
import {
  etiquetaOrigenPasada,
  etiquetaPasada,
  motivoAutoSincronizacion,
  nivelCuota,
  porcentajeCuota,
  textoCanal,
  textoContactosAjenos,
  textoCuota,
} from "@/lib/newsletter/resend";
import { MENSAJE_NO_DISPONIBLE, formatoNumero, plural } from "@/lib/newsletter/textos";

// Tarjeta «Lista de envío» (por dentro: sincronización con Resend Marketing,
// fase 2 del newsletter). La tabla newsletter_suscriptores sigue siendo la
// fuente de verdad; esto solo enseña cómo de cuadrada está la lista que usa el
// servicio de envío y deja forzar una actualización. La función
// newsletter-sync-resend corre también justo antes de cada envío por Broadcast;
// el cron diario está PREPARADO pero no programado en producción (ver el final
// de la migración 20261003193000 y la sección 9 de
// docs/funcionalidades/newsletter-resend-marketing.md). Por eso la tarjeta se
// actualiza sola al abrirse si la lista no cuadra con los activos, si la última
// actualización correcta tiene más de 24 h o si no hubo ninguna
// (motivoAutoSincronizacion): una vez por montaje, en segundo plano, sin avisos
// emergentes y solo si el usuario puede escribir en Marketing (lo mismo que
// exige la función: can_write_section('marketing')). Los textos son para personal no técnico: nada de nombres de servicios
// ni de variables; el detalle técnico va dentro de un desplegable.
// Controles táctiles de ≥ 44 px (h-11), como el resto del panel en tablet.

const COLOR_BARRA = { ok: "bg-emerald-500", aviso: "bg-amber-500", lleno: "bg-destructive" } as const;

// Explicación de la tarjeta. Antes era una descripción fija bajo el título (2-3 líneas); va tras el (i) del título
// para que la pestaña Suscriptores quepa sin scroll en pantallas bajas (1280x711 al 150 %, tablet apaisada).
const TEXTO_AYUDA =
  "Es la copia de los suscriptores activos que usa el servicio de envío. La lista de esta página es la que manda: se añaden los activos y se quitan los que se dan de baja. Se actualiza sola al abrir esta pestaña y justo antes de cada envío.";

function hace(fecha: string | null | undefined): string {
  if (!fecha) return "";
  try {
    return formatDistanceToNow(new Date(fecha), { addSuffix: true, locale: es });
  } catch {
    return "";
  }
}

interface PropsSincronizacionResend {
  /**
   * Suscriptores activos del panel (emails distintos). `undefined` mientras
   * cargan (no se decide nada todavía); `null` si no se pudieron cargar (solo
   * cuentan la antigüedad y si hubo alguna actualización). Sin la prop, la
   * tarjeta no se actualiza sola.
   */
  activos?: number | null;
  /**
   * Una sola línea (pestaña Suscriptores): contactos con barra fina, última actualización y botón «Actualizar»;
   * el resto del detalle (recibirían el próximo envío, añadidos, quitados, contactos ajenos, errores) va en un
   * popover «Detalle». Mismos datos y misma actualización automática que la tarjeta.
   */
  compacta?: boolean;
}

export function SincronizacionResend({ activos, compacta = false }: PropsSincronizacionResend = {}) {
  const { data: estado, isLoading, error } = useEstadoResend();
  const { mutate: sincronizar, isPending, variables } = useSincronizarResend();
  const { canAccess: puedeSincronizar, loading: cargandoPermiso } = useCanAccessSection("marketing", "edit");

  // Una sola decisión por montaje, cuando ya están el estado, los activos y el
  // permiso: así ni el refresco del estado tras sincronizar ni el sondeo de los
  // suscriptores pueden encadenar otra pasada.
  const decidida = useRef(false);
  useEffect(() => {
    if (decidida.current || isLoading || !estado || activos === undefined || cargandoPermiso) return;
    decidida.current = true;
    if (!puedeSincronizar || isPending) return;
    if (motivoAutoSincronizacion(estado, activos) === null) return;
    sincronizar({ automatica: true });
  }, [estado, isLoading, activos, cargandoPermiso, puedeSincronizar, isPending, sincronizar]);
  const actualizandoSola = isPending && variables?.automatica === true;

  if (isLoading && compacta) {
    return <Skeleton className="h-9 w-full" />;
  }
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

  if ((error || !estado) && compacta) {
    return (
      <div className="flex items-start gap-2 border-t border-border/60 pt-3 text-sm text-muted-foreground">
        <CloudCog className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p>
            <span className="font-medium text-foreground">La lista de envío todavía no está disponible.</span> Por ahora la
            newsletter se envía por correo directo, con un límite de destinatarios. Avisa al equipo técnico para activarla.
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer select-none py-2">Detalle técnico</summary>
            <p>Falta desplegar la función de sincronización con Resend o aplicar su migración.</p>
            {error instanceof Error && error.message ? <p className="mt-1 break-words">{error.message}</p> : null}
          </details>
        </div>
      </div>
    );
  }
  if (error || !estado) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4">
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <CloudCog className="h-5 w-5 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium text-foreground">La lista de envío todavía no está disponible</p>
              <p className="mt-1">
                Por ahora la newsletter se envía por correo directo, con un límite de destinatarios. Avisa al equipo
                técnico para activar la lista de envío, que admite hasta 1.000 contactos.
              </p>
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer select-none py-2">Detalle técnico</summary>
                <p>Falta desplegar la función de sincronización con Resend o aplicar su migración.</p>
                {error instanceof Error && error.message ? <p className="mt-1 break-words">{error.message}</p> : null}
              </details>
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
  // contactos_resend sale de la última pasada terminada: su desglose también.
  const ajenos = textoContactosAjenos(estado.ultima_terminada ?? (ultima?.estado !== "en_curso" ? ultima : null));
  const sinClave = !estado.configurado.api_key;
  // Con poco uso el relleno mediría menos de un píxel y parecería vacío: mínimo visible.
  const anchoRelleno = usados && usados > 0 ? Math.max(porcentajeCuota(usados, limite), 3) : 0;

  if (compacta) {
    const hayError = ultima?.estado === "error" || Boolean(ultima?.mensaje_error);
    return (
      <div data-testid="lista-envio-compacta" className="flex shrink-0 flex-col gap-1.5 border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <CloudCog className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Lista de envío
            <AyudaPopover etiqueta="Qué es la lista de envío">{TEXTO_AYUDA}</AyudaPopover>
          </span>
          <span className="text-xs text-muted-foreground">Envío actual: {textoCanal(estado.canal)}</span>
          <span className="flex items-center gap-2 tabular-nums">
            <span className="text-muted-foreground">Contactos</span>
            <span className="whitespace-nowrap font-semibold">
              {usados ?? "—"} de {formatoNumero(limite)}
            </span>
            <span
              className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Contactos usados del plan"
              aria-valuemin={0}
              aria-valuemax={limite}
              aria-valuenow={usados ?? 0}
            >
              <span className={cn("block h-full rounded-full transition-all", COLOR_BARRA[nivel])} style={{ width: `${anchoRelleno}%` }} />
            </span>
          </span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {actualizandoSola ? (
              <span role="status" className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Actualizando lista de envío…
              </span>
            ) : ultima ? (
              <>
                Actualizada {hace(ultima.terminada_at ?? ultima.iniciada_at)}:{" "}
                <span className={cn("font-medium", ultima.estado === "error" ? "text-destructive" : "text-foreground")}>{etiquetaPasada(ultima)}</span>
              </>
            ) : (
              "Todavía no se ha actualizado nunca."
            )}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {ultima && ultima.estado !== "en_curso" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className={cn("gap-1 text-muted-foreground", hayError && "text-destructive")}>
                    <Info className="h-4 w-4" aria-hidden="true" />
                    Detalle
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] space-y-2 p-3 text-sm">
                  <p>
                    {ultima.destinatarios ?? 0} recibirían el próximo envío · {plural(ultima.altas, "añadido", "añadidos")} ·{" "}
                    {plural(ultima.borrados, "quitado", "quitados")}
                    {ultima.bajas_resend ? ` · ${plural(ultima.bajas_resend, "baja nueva", "bajas nuevas")}` : ""}
                    {ultima.errores ? ` · ${plural(ultima.errores, "aviso", "avisos")}` : ""}
                    {ultima.pendientes ? ` · ${plural(ultima.pendientes, "cambio pendiente", "cambios pendientes")}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">Origen: {etiquetaOrigenPasada(ultima)}.</p>
                  {ajenos ? <p className="text-xs text-muted-foreground">{ajenos}</p> : null}
                  {ultima.mensaje_error ? (
                    <details className="text-destructive">
                      <summary className="cursor-pointer select-none py-2">La última actualización tuvo un problema. Detalle técnico</summary>
                      <p className="break-words">{ultima.mensaje_error}</p>
                    </details>
                  ) : null}
                </PopoverContent>
              </Popover>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => sincronizar({})} disabled={isPending || sinClave} aria-label="Actualizar lista de envío">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Actualizar
            </Button>
          </div>
        </div>
        {aviso ? (
          <p className={cn("flex items-start gap-2 text-sm", nivel === "lleno" ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {aviso}
          </p>
        ) : null}
        {sinClave ? (
          <div className="text-sm text-destructive">
            <p>{MENSAJE_NO_DISPONIBLE}</p>
            <details className="text-xs">
              <summary className="cursor-pointer select-none py-2">Detalle técnico</summary>
              <p>Falta la clave de Resend Marketing (RESEND_MARKETING_API_KEY).</p>
            </details>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <CloudCog className="h-5 w-5 text-primary" />
          Lista de envío
          <Badge variant={estado.canal === "broadcast" ? "default" : "secondary"} className="font-normal">
            Envío actual: {textoCanal(estado.canal)}
          </Badge>
          <AyudaPopover etiqueta="Qué es la lista de envío">{TEXTO_AYUDA}</AyudaPopover>
        </CardTitle>
      </CardHeader>
      {/* Desde `sm` el estado de la última actualización y el botón van en la misma fila (una sola columna debajo). */}
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="sm:col-span-2">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-muted-foreground">Contactos:</span>
            <span className="font-semibold tabular-nums whitespace-nowrap">
              {usados ?? "—"} de {formatoNumero(limite)}
            </span>
            {actualizandoSola ? (
              <span role="status" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Actualizando lista de envío…
              </span>
            ) : null}
          </p>
          {ajenos ? <p className="mt-1 text-xs text-muted-foreground">{ajenos}</p> : null}
          <div
            className="mt-2 h-3 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Contactos usados del plan"
            aria-valuemin={0}
            aria-valuemax={limite}
            aria-valuenow={usados ?? 0}
          >
            <div className={cn("h-full rounded-full transition-all", COLOR_BARRA[nivel])} style={{ width: `${anchoRelleno}%` }} />
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
                Última actualización {hace(ultima.terminada_at ?? ultima.iniciada_at)} ({etiquetaOrigenPasada(ultima)}):{" "}
                <span className={cn("font-medium", ultima.estado === "error" ? "text-destructive" : "text-foreground")}>{etiquetaPasada(ultima)}</span>
              </p>
              {ultima.estado !== "en_curso" ? (
                <p>
                  {ultima.destinatarios ?? 0} recibirían el próximo envío · {plural(ultima.altas, "añadido", "añadidos")} ·{" "}
                  {plural(ultima.borrados, "quitado", "quitados")}
                  {ultima.bajas_resend ? ` · ${plural(ultima.bajas_resend, "baja nueva", "bajas nuevas")}` : ""}
                  {ultima.errores ? ` · ${plural(ultima.errores, "aviso", "avisos")}` : ""}
                  {ultima.pendientes ? ` · ${plural(ultima.pendientes, "cambio pendiente", "cambios pendientes")}` : ""}
                </p>
              ) : null}
              {ultima.mensaje_error ? (
                <details className="text-destructive">
                  <summary className="cursor-pointer select-none py-2">La última actualización tuvo un problema. Detalle técnico</summary>
                  <p className="break-words">{ultima.mensaje_error}</p>
                </details>
              ) : null}
            </>
          ) : (
            <p>La lista de envío todavía no se ha actualizado nunca.</p>
          )}
          {sinClave ? (
            <div className="text-destructive">
              <p>{MENSAJE_NO_DISPONIBLE}</p>
              <details className="text-xs">
                <summary className="cursor-pointer select-none py-2">Detalle técnico</summary>
                <p>Falta la clave de Resend Marketing (RESEND_MARKETING_API_KEY).</p>
              </details>
            </div>
          ) : null}
        </div>

        <Button className="h-11 w-full sm:w-auto" variant="outline" onClick={() => sincronizar({})} disabled={isPending || sinClave}>
          {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Actualizar lista de envío
        </Button>
      </CardContent>
    </Card>
  );
}

/** Línea para «Enviar Newsletter»: cómo va a salir el próximo envío. */
export function CanalEnvio() {
  const { data: estado, isError } = useEstadoResend();
  const canal = !isError && estado ? estado.canal : "transaccional";
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      <Send className="h-4 w-4 mt-0.5 shrink-0" />
      <span>
        Envío: <strong className="text-foreground">{textoCanal(canal).toLowerCase()}</strong>
        {canal === "broadcast"
          ? ". Cada correo incluye un enlace para darse de baja. Las bajas se registran solas en la lista de suscriptores."
          : ". Hay un límite de destinatarios para no dejar sin correos a las reservas."}
      </span>
    </div>
  );
}
