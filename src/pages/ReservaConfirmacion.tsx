import { CheckCircle, Clock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function ReservaConfirmacion() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-primary/10 p-3">
              <CheckCircle className="h-12 w-12 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">¡Reserva Realizada!</CardTitle>
          <CardDescription>
            Tu solicitud de reserva ha sido enviada correctamente
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4 flex items-start gap-3">
            <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium">Espera verificación</p>
              <p className="text-sm text-muted-foreground mt-1">
                Nuestro equipo revisará tu solicitud y te contactaremos pronto para confirmar tu reserva.
              </p>
            </div>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            <p>📧 Recibirás un email de confirmación</p>
            <p>📞 Te llamaremos para verificar los detalles</p>
            <p>⏱️ Tiempo estimado de respuesta: 1-2 horas</p>
          </div>

          <Button 
            onClick={() => navigate("/reservar")} 
            className="w-full"
          >
            Hacer otra reserva
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
