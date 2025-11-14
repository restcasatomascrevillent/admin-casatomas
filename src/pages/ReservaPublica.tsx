import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import { CalendarioReservaPublica } from "@/components/reservas/CalendarioReservaPublica";
import { Card } from "@/components/ui/card";
import { UtensilsCrossed } from "lucide-react";
import { useState } from "react";

export default function ReservaPublica() {
  const [datosReserva, setDatosReserva] = useState<{
    sala_id: string;
    fecha: Date;
    hora: string;
  } | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center items-center gap-3 mb-4">
            <UtensilsCrossed className="h-12 w-12 text-primary" />
            <h1 className="text-4xl font-bold tracking-tight">Reserva tu Mesa</h1>
          </div>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Selecciona la sala, fecha y hora para tu reserva. Te confirmaremos lo antes posible.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Selector de sala, calendario y horarios */}
          <div className="order-2 lg:order-1">
            <CalendarioReservaPublica
              onSeleccion={(sala_id, fecha, hora) => {
                setDatosReserva({ sala_id, fecha, hora });
              }}
            />
          </div>

          {/* Formulario de reserva */}
          <div className="order-1 lg:order-2">
            <Card className="p-6 sticky top-4">
              <h2 className="text-2xl font-semibold mb-6">Datos de la Reserva</h2>
              <FormularioReserva 
                isPublic 
                datosPreseleccionados={datosReserva}
              />
            </Card>
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-12 text-center">
          <Card className="p-6 bg-muted/50">
            <h3 className="font-semibold mb-2">Información importante</h3>
            <ul className="text-sm text-muted-foreground space-y-1 max-w-2xl mx-auto">
              <li>• Las reservas quedan pendientes de confirmación</li>
              <li>• Te contactaremos por teléfono o email para confirmar</li>
              <li>• Por favor, llega 10 minutos antes de tu hora reservada</li>
              <li>• Para grupos de más de 8 personas, contáctanos directamente</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
