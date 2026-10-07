import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Mail, UserMinus } from "lucide-react";
import { useNewsletterSuscriptores } from "@/hooks/useNewsletterSuscriptores";
import { Skeleton } from "@/components/ui/skeleton";
import { ListaSuscriptores } from "./ListaSuscriptores";
import { SincronizacionResend } from "./SincronizacionResend";
import { contarEmailsActivos } from "@/lib/newsletter/resend";

export function GestionCorreos() {
  // Activos y bajas en una sola consulta (se refresca sola cada minuto). Las
  // bajas las escriben newsletter-baja y resend-webhook con fecha_baja y
  // origen_baja; el personal no da de baja ni reactiva a nadie.
  const { suscriptores, totalSuscriptores, bajas, totalBajas, isLoading, error } = useNewsletterSuscriptores();
  // Para que la lista de envío se actualice sola si no cuadra (SincronizacionResend).
  const activosDistintos = useMemo(() => contarEmailsActivos(suscriptores), [suscriptores]);
  const activosParaLista = isLoading ? undefined : error ? null : activosDistintos;

  return (
    // Llena el alto que le da Marketing.tsx (mide el alto de la pantalla y la pestaña hace scroll por dentro):
    // los contadores y «Lista de envío» van con su alto natural y la lista de suscriptores toma el que sobra,
    // con el scroll DENTRO de la lista y no en la página. Una sola rejilla y ninguna altura fija. Desde `md`
    // (tablet) los contadores van a la izquierda de la lista y «Lista de envío» debajo de las dos. El primer
    // número de `minmax` es el suelo de la fila de la lista (20rem desde `md`, 32rem en el móvil, donde todo va
    // apilado): si ni así cabe (ventana muy baja) la lista no se aplasta más y la pestaña hace scroll.
    <div className="grid h-full grid-cols-1 grid-rows-[auto_minmax(32rem,1fr)_auto] gap-x-6 gap-y-4 md:grid-cols-3 md:grid-rows-[minmax(20rem,1fr)_auto]">
      <Card className="md:self-start">
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

      <Card data-testid="tarjeta-lista-suscriptores" className="flex min-h-0 flex-col md:col-span-2">
        <CardHeader className="shrink-0">
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Lista de suscriptores
          </CardTitle>
          <CardDescription>
            Para enviar una newsletter, ve a la pestaña «Enviar Newsletter».
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
          <ListaSuscriptores activos={suscriptores} bajas={bajas} isLoading={isLoading} />
        </CardContent>
      </Card>

      {/* Fase 2: lista de envío (conexión con Resend Marketing, newsletter-sync-resend). */}
      <div className="md:col-span-3">
        <SincronizacionResend activos={activosParaLista} />
      </div>
    </div>
  );
}
