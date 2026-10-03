import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Mail, Info, UserMinus } from "lucide-react";
import { useNewsletterSuscriptores } from "@/hooks/useNewsletterSuscriptores";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function GestionCorreos() {
  const { suscriptores, totalSuscriptores, isLoading } = useNewsletterSuscriptores();

  // Bajas registradas (RGPD). Antes la baja no escribía nada en la base de datos
  // (el "webhook de baja" solo devolvía una página de HTML); ahora
  // newsletter-baja deja fecha_baja y origen_baja en cada suscriptor dado de baja.
  const { data: totalBajas, isLoading: isLoadingBajas } = useQuery({
    queryKey: ["newsletter-bajas-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("newsletter_suscriptores")
        .select("id", { count: "exact", head: true })
        .eq("activo", false);
      if (error) throw error;
      return count ?? 0;
    },
  });

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
              {isLoadingBajas ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <span>{totalBajas ?? 0} bajas registradas</span>
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
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : suscriptores.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Aún no hay suscriptores activos.
              </p>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {suscriptores.map((suscriptor) => (
                    <div
                      key={suscriptor.id}
                      className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                    >
                      <div>
                        <p className="font-medium text-sm">{suscriptor.email}</p>
                        {suscriptor.nombre && (
                          <p className="text-xs text-muted-foreground">{suscriptor.nombre}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
