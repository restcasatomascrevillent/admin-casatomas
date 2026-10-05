import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Mail, Info, UserMinus, ShieldCheck } from "lucide-react";
import { useNewsletterSuscriptores } from "@/hooks/useNewsletterSuscriptores";
import { Skeleton } from "@/components/ui/skeleton";
import { ListaSuscriptores } from "./ListaSuscriptores";
import { SincronizacionResend } from "./SincronizacionResend";

export function GestionCorreos() {
  // Activos y bajas en una sola consulta (se refresca sola cada minuto). Las
  // bajas las escriben newsletter-baja y resend-webhook con fecha_baja y
  // origen_baja; el personal no da de baja ni reactiva a nadie.
  const { suscriptores, totalSuscriptores, bajas, totalBajas, isLoading } = useNewsletterSuscriptores();

  return (
    <div className="space-y-4">
      {/* Origen de los suscriptores. Altas (doble opt-in): triggers newsletter_alta_reserva_verificada_*
          sobre `reservas`, solo si la reserva trae consentimiento_newsletter = true (casilla del formulario
          web, también si la reserva sale de una solicitud) Y el cliente ha verificado el email pulsando
          «Confirmo» en el correo (email_verificado_at). Ver
          supabase/migrations/20261003184500_newsletter_doble_optin_y_email_normalizado.sql. */}
      <Card className="border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-sky-600 mt-0.5 shrink-0" />
            <div className="text-sm text-sky-900 dark:text-sky-200">
              <p className="font-medium">Cómo se apunta la gente</p>
              <p className="mt-1">
                Se apuntan al reservar en la web marcando la casilla de la newsletter, y quedan suscritos cuando
                confirman su reserva desde el email. Quien se da de baja no vuelve a recibirla salvo que se apunte de
                nuevo.
              </p>
              <p className="mt-1">
                Las reservas por teléfono o apuntadas desde el panel no suscriben a nadie: el cliente tiene que
                marcar la casilla él mismo en la web.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Baja automática (encargo del dueño, 2026-10-03). Pie y cabeceras: enviar-newsletter/plantillas.ts;
          baja: newsletter-baja y resend-webhook; protección: migración 20261003171500. */}
      <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
            <div className="text-sm text-emerald-900 dark:text-emerald-200">
              <p className="font-medium">Las bajas se hacen solas</p>
              <p className="mt-1">
                Cada newsletter incluye un enlace para darse de baja (y el botón «Cancelar suscripción» de Gmail,
                Outlook o Yahoo), sin que tengas que añadir nada. Quien lo pulsa deja de recibirla al momento. También
                se da de baja a quien marca un correo nuestro como spam o tiene un email que no existe.
              </p>
              <p className="mt-1">
                Las bajas aparecen aquí solas (en un minuto como mucho), con su fecha y el motivo. No se pueden volver a
                activar desde el panel.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-primary" />
              Suscriptores activos
            </CardTitle>
            <CardDescription>
              Reciben la newsletter
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              {isLoading ? (
                <Skeleton className="h-10 w-20 mx-auto" />
              ) : (
                <p className="text-4xl font-bold text-primary">{totalSuscriptores}</p>
              )}
              <p className="text-sm text-muted-foreground mt-1">
                emails de clientes
              </p>
            </div>
            <div className="mt-4 pt-4 border-t flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <UserMinus className="h-4 w-4" />
              {isLoading ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <span>{totalBajas} dados de baja (no reciben nada)</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Lista de suscriptores
            </CardTitle>
            <CardDescription>
              Para enviar una newsletter, ve a la pestaña «Enviar Newsletter».
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ListaSuscriptores activos={suscriptores} bajas={bajas} isLoading={isLoading} />
          </CardContent>
        </Card>
      </div>

      {/* Fase 2: lista de envío (conexión con Resend Marketing, newsletter-sync-resend). */}
      <SincronizacionResend />
    </div>
  );
}
