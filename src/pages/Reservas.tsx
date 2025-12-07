import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VistaHoy } from "@/components/reservas/VistaHoy";
import { ListaReservasAvanzada } from "@/components/reservas/ListaReservasAvanzada";
import { CalendarioOcupacion } from "@/components/reservas/CalendarioOcupacion";
import { PlanoEspacio2D } from "@/components/reservas/PlanoEspacio2D";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";

export default function Reservas() {
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedEspacio, setSelectedEspacio] = useState<{ id: string; nombre: string } | null>(null);

  const { data: espacios } = useEspaciosReserva();

  const handleEspacioClick = (espacioId: string) => {
    const espacio = espacios?.find((e) => e.id === espacioId);
    if (espacio) {
      setSelectedEspacio({ id: espacio.id, nombre: espacio.nombre });
    }
  };

  // Si hay un espacio seleccionado, mostrar el plano 2D
  if (selectedEspacio) {
    return (
      <DashboardLayout>
        <PlanoEspacio2D
          espacioId={selectedEspacio.id}
          espacioNombre={selectedEspacio.nombre}
          onBack={() => setSelectedEspacio(null)}
        />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Reservas</h2>
            <p className="text-muted-foreground">Gestiona las reservas del restaurante</p>
          </div>
          <Dialog open={openDialog} onOpenChange={setOpenDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nueva Reserva
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Crear Nueva Reserva</DialogTitle>
              </DialogHeader>
              <FormularioReserva
                onSuccess={() => {
                  setOpenDialog(false);
                  toast.success("Reserva creada correctamente");
                }}
              />
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="hoy" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="hoy">Hoy</TabsTrigger>
            <TabsTrigger value="lista">Lista de Reservas</TabsTrigger>
            <TabsTrigger value="calendario">Calendario</TabsTrigger>
          </TabsList>

          <TabsContent value="hoy" className="space-y-6 mt-6">
            <VistaHoy onEspacioClick={handleEspacioClick} />
          </TabsContent>

          <TabsContent value="lista" className="space-y-6 mt-6">
            <ListaReservasAvanzada onEspacioClick={handleEspacioClick} />
          </TabsContent>

          <TabsContent value="calendario" className="space-y-6 mt-6">
            <CalendarioOcupacion onEspacioClick={handleEspacioClick} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
