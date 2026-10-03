import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Mail, Info, UserMinus, ShieldCheck } from "lucide-react";
import { useNewsletterSuscriptores } from "@/hooks/useNewsletterSuscriptores";
import { Skeleton } from "@/components/ui/skeleton";
import { ListaSuscriptores } from "./ListaSuscriptores";

export function GestionCorreos() {
  // Activos y bajas en una sola consulta (se refresca sola cada minuto). Las
  // bajas las escriben newsletter-baja y resend-webhook con fecha_baja y
  // origen_baja; el personal no da de baja ni reactiva a nadie.
  const { suscriptores, totalSuscriptores, bajas, totalBajas, isLoading } = useNewsletterSuscriptores();

  return (
    <div className="space-y-4">
      {/* Origen de los suscriptores. Altas: trigger agregar_suscriptor_al_reservar_consentida
          sobre `reservas`, solo si la reserva trae consentimiento_newsletter = true (lo rellena
          reservas-web desde la casilla del formulario web; ver
          supabase/migrations/20261003143000_reserva_web_prueba_consentimiento.sql). */}
      <Card className="border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-sky-600 mt-0.5 shrink-0" />
            <div className="text-sm text-sky-900 dark:text-sky-200">
              <p className="font-medium">Altas solo desde la reserva web, con consentimiento explícito</p>
              <p className="mt-1">
                Solo se da de alta quien, al reservar en la web de Casa Tomás, marca la casilla opcional
                para recibir el newsletter. La propia reserva guarda la constancia de ese consentimiento.
                Si alguien que se había dado de baja vuelve a marcarla en una reserva nueva, se le
                reactiva; si no la marca, no se le vuelve a suscribir.
              </p>
              <p className="mt-1">
                Por teléfono todavía no se pide el consentimiento y este panel no tiene alta manual. Hasta
                enero se añadía automáticamente a todo el que reservaba mesa, sin pedirle permiso; se quitó
                por RGPD.
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
              <p className="font-medium">La baja es automática</p>
              <p className="mt-1">
                Todos los newsletters llevan, sin que tengas que añadir nada, un enlace personal para darse de baja
                en el pie y el botón «Cancelar suscripción» de Gmail, Outlook o Yahoo. Quien lo pulsa queda dado de
                baja al momento. También se da de baja solo a quien marca un correo nuestro como spam o tiene una
                dirección que no existe.
              </p>
              <p className="mt-1">
                Las bajas aparecen aquí solas (en un minuto como mucho), con su fecha y el motivo. Los dados de baja
                no reciben ningún envío y no se pueden volver a activar desde el panel: solo vuelven si marcan otra
                vez la casilla del newsletter en una reserva nueva.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-primary" />
              Suscriptores activos
            </CardTitle>
            <CardDescription>
              Reciben el newsletter
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

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Lista de Suscriptores
            </CardTitle>
            <CardDescription>
              El envío se hace desde la pestaña "Crear Newsletter" de este panel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ListaSuscriptores activos={suscriptores} bajas={bajas} isLoading={isLoading} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
