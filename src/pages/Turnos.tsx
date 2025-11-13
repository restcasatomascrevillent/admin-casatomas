import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Turnos() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Turnos</h2>
          <p className="text-muted-foreground">Gestión de turnos y asignaciones</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Calendario de Turnos</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Próximamente: sistema de gestión de turnos con drag & drop
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
