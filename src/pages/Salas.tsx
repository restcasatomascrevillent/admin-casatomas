import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Salas() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Salas</h2>
          <p className="text-muted-foreground">Gestión de salas y posiciones</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Configuración de Salas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Próximamente: gestión de salas y posiciones del restaurante
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
