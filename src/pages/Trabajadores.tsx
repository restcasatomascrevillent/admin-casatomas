import { useState } from "react";
import { Plus, UserCog, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ListaTrabajadores } from "@/components/trabajadores/ListaTrabajadores";
import { FormularioTrabajador } from "@/components/trabajadores/FormularioTrabajador";
import { CalendarioTurnos } from "@/components/trabajadores/CalendarioTurnos";
import { CalendarioTurnosSemanal } from "@/components/trabajadores/CalendarioTurnosSemanal";
import { GenerarTurnosFicticios } from "@/components/trabajadores/GenerarTurnosFicticios";
import { GenerarAreasFicticias } from "@/components/trabajadores/GenerarAreasFicticias";
import { AsignarAreasAutomaticamente } from "@/components/trabajadores/AsignarAreasAutomaticamente";
import { DialogTurno } from "@/components/trabajadores/DialogTurno";
import { GenerarDatosFicticios } from "@/components/trabajadores/GenerarDatosFicticios";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Trabajadores() {
  const [dialogAbierto, setDialogAbierto] = useState(false);
  const [dialogTurnoAbierto, setDialogTurnoAbierto] = useState(false);
  const [trabajadorEditando, setTrabajadorEditando] = useState<string | null>(null);
  const [vistaTurnos, setVistaTurnos] = useState<"diaria" | "semanal">("semanal");

  const handleNuevoTrabajador = () => {
    setTrabajadorEditando(null);
    setDialogAbierto(true);
  };

  const handleEditarTrabajador = (id: string) => {
    setTrabajadorEditando(id);
    setDialogAbierto(true);
  };

  const handleCerrarDialog = () => {
    setDialogAbierto(false);
    setTrabajadorEditando(null);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Gestión de Personal</h1>
            <p className="text-muted-foreground">
              Administra trabajadores, turnos y horarios
            </p>
          </div>
          <div className="flex gap-2">
            <GenerarDatosFicticios />
            <GenerarTurnosFicticios />
            <GenerarAreasFicticias />
            <AsignarAreasAutomaticamente />
            <Button
              variant="outline"
              onClick={() => setDialogTurnoAbierto(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Crear Turno
            </Button>
            <Button onClick={handleNuevoTrabajador}>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Trabajador
            </Button>
          </div>
        </div>

        <Tabs defaultValue="trabajadores" className="space-y-4">
          <TabsList>
            <TabsTrigger value="trabajadores">
              <UserCog className="mr-2 h-4 w-4" />
              Trabajadores
            </TabsTrigger>
            <TabsTrigger value="turnos">
              <Clock className="mr-2 h-4 w-4" />
              Turnos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="trabajadores">
            <Card>
              <CardHeader>
                <CardTitle>Personal del Restaurante</CardTitle>
                <CardDescription>
                  Lista de todos los trabajadores registrados
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ListaTrabajadores onEditar={handleEditarTrabajador} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="turnos" className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant={vistaTurnos === "diaria" ? "default" : "outline"}
                onClick={() => setVistaTurnos("diaria")}
              >
                Vista Diaria
              </Button>
              <Button
                variant={vistaTurnos === "semanal" ? "default" : "outline"}
                onClick={() => setVistaTurnos("semanal")}
              >
                Vista Semanal
              </Button>
            </div>
            
            {vistaTurnos === "diaria" ? (
              <CalendarioTurnos />
            ) : (
              <CalendarioTurnosSemanal />
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={dialogAbierto} onOpenChange={setDialogAbierto}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {trabajadorEditando ? "Editar Trabajador" : "Nuevo Trabajador"}
              </DialogTitle>
              <DialogDescription>
                Completa la información del trabajador
              </DialogDescription>
            </DialogHeader>
            <FormularioTrabajador
              trabajadorId={trabajadorEditando}
              onSuccess={handleCerrarDialog}
            />
          </DialogContent>
        </Dialog>

        <DialogTurno
          open={dialogTurnoAbierto}
          onOpenChange={setDialogTurnoAbierto}
          turnoId={null}
          turnoData={null}
        />
      </div>
    </DashboardLayout>
  );
}
