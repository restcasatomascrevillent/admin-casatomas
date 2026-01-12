import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Mail } from "lucide-react";
import { useNewsletterSuscriptores } from "@/hooks/useNewsletterSuscriptores";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

export function GestionCorreos() {
  const { suscriptores, totalSuscriptores, isLoading } = useNewsletterSuscriptores();

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-primary" />
            Suscriptores
          </CardTitle>
          <CardDescription>
            Emails recopilados de reservas
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
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Lista de Suscriptores
          </CardTitle>
          <CardDescription>
            Emails recopilados automáticamente de las reservas. Usa n8n para enviar newsletters.
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
              Aún no hay suscriptores. Los emails se añadirán automáticamente cuando se realicen reservas.
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
  );
}
