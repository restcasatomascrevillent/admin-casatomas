import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Send, Users, FileText, Loader2 } from "lucide-react";
import { useNewsletterSuscriptores, useNewsletterEnvios } from "@/hooks/useNewsletterSuscriptores";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton";

export function GestionCorreos() {
  const { toast } = useToast();
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { totalSuscriptores, isLoading: loadingSuscriptores } = useNewsletterSuscriptores();
  const { envios, isLoading: loadingEnvios, refetch: refetchEnvios } = useNewsletterEnvios();

  const handleEnviarCorreo = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!asunto || !mensaje) {
      toast({
        title: "Error",
        description: "Por favor completa todos los campos",
        variant: "destructive",
      });
      return;
    }

    if (totalSuscriptores === 0) {
      toast({
        title: "Sin suscriptores",
        description: "No hay suscriptores activos para enviar el newsletter",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(
        "https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/enviar-newsletter",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ asunto, mensaje }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Error al enviar el newsletter");
      }

      toast({
        title: "Newsletter enviado",
        description: `Se envió correctamente a ${result.enviados} suscriptores${result.errores > 0 ? `. ${result.errores} fallos.` : ""}`,
      });
      
      setAsunto("");
      setMensaje("");
      refetchEnvios();
    } catch (error: any) {
      console.error("Error enviando newsletter:", error);
      toast({
        title: "Error",
        description: error.message || "No se pudo enviar el newsletter",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            Enviar Newsletter
          </CardTitle>
          <CardDescription>
            Envía correos a todos los clientes que han realizado reservas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleEnviarCorreo} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="asunto">Asunto del correo</Label>
              <Input
                id="asunto"
                placeholder="Ej: Nuevos platos de temporada"
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
                disabled={isLoading}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="mensaje">Mensaje</Label>
              <Textarea
                id="mensaje"
                placeholder="Escribe el contenido del correo aquí..."
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                rows={10}
                className="resize-none"
                disabled={isLoading}
              />
            </div>

            <Button type="submit" disabled={isLoading || totalSuscriptores === 0} className="w-full">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Enviar a {totalSuscriptores} suscriptores
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-primary" />
              Suscriptores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              {loadingSuscriptores ? (
                <Skeleton className="h-10 w-20 mx-auto" />
              ) : (
                <p className="text-4xl font-bold text-primary">{totalSuscriptores}</p>
              )}
              <p className="text-sm text-muted-foreground mt-1">
                emails de clientes con reservas
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-primary" />
              Últimos Envíos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingEnvios ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : envios.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Aún no has enviado ningún newsletter
              </p>
            ) : (
              <div className="space-y-3">
                {envios.map((envio, index) => (
                  <div 
                    key={envio.id} 
                    className={`border-l-4 pl-3 ${index === 0 ? "border-primary" : "border-muted"}`}
                  >
                    <p className="font-medium text-sm truncate">{envio.asunto}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(envio.created_at), { addSuffix: true, locale: es })} 
                      {" · "}{envio.total_destinatarios} destinatarios
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
