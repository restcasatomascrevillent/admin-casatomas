import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Send, Users, FileText } from "lucide-react";

export function GestionCorreos() {
  const { toast } = useToast();
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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

    setIsLoading(true);
    
    // Simular envío
    setTimeout(() => {
      toast({
        title: "Correo enviado",
        description: "El correo se ha enviado correctamente a todos los suscriptores",
      });
      setAsunto("");
      setMensaje("");
      setIsLoading(false);
    }, 1500);
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
            Crea y envía correos a tus suscriptores con las últimas novedades
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
              />
            </div>

            <Button type="submit" disabled={isLoading} className="w-full">
              <Send className="mr-2 h-4 w-4" />
              {isLoading ? "Enviando..." : "Enviar Newsletter"}
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
              <p className="text-4xl font-bold text-primary">1,247</p>
              <p className="text-sm text-muted-foreground mt-1">
                suscriptores activos
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-primary" />
              Últimas Campañas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="border-l-4 border-primary pl-3">
                <p className="font-medium text-sm">Menú de Navidad</p>
                <p className="text-xs text-muted-foreground">Hace 3 días</p>
              </div>
              <div className="border-l-4 border-muted pl-3">
                <p className="font-medium text-sm">Oferta Especial</p>
                <p className="text-xs text-muted-foreground">Hace 1 semana</p>
              </div>
              <div className="border-l-4 border-muted pl-3">
                <p className="font-medium text-sm">Nuevo Chef</p>
                <p className="text-xs text-muted-foreground">Hace 2 semanas</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
