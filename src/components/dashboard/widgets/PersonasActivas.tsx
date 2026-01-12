import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ChefHat, ConciergeBell } from "lucide-react";
import { useActiveStaff } from "@/hooks/useDashboardStats";

export function PersonasActivas() {
  const { data: activeStaff } = useActiveStaff();

  const cocina = activeStaff?.filter((s) => {
    const puesto = (s.trabajadores as any)?.puesto;
    return puesto === "cocinero" || puesto === "ayudante_cocina";
  }) || [];

  const sala = activeStaff?.filter((s) => {
    const puesto = (s.trabajadores as any)?.puesto;
    return puesto === "camarero" || puesto === "ayudante_camarero";
  }) || [];

  const otros = activeStaff?.filter((s) => {
    const puesto = (s.trabajadores as any)?.puesto;
    return !["cocinero", "ayudante_cocina", "camarero", "ayudante_camarero"].includes(puesto);
  }) || [];

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-semibold">Personal Activo</CardTitle>
        <Users className="h-5 w-5 text-primary" />
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-orange-500/10 rounded-lg">
            <div className="flex items-center justify-center gap-1 mb-2">
              <ChefHat className="h-5 w-5 text-orange-600" />
            </div>
            <div className="text-4xl font-bold text-orange-600">{cocina.length}</div>
            <p className="text-sm text-muted-foreground mt-1">Cocina</p>
          </div>
          <div className="text-center p-4 bg-blue-500/10 rounded-lg">
            <div className="flex items-center justify-center gap-1 mb-2">
              <ConciergeBell className="h-5 w-5 text-blue-600" />
            </div>
            <div className="text-4xl font-bold text-blue-600">{sala.length}</div>
            <p className="text-sm text-muted-foreground mt-1">Sala</p>
          </div>
          <div className="text-center p-4 bg-purple-500/10 rounded-lg">
            <div className="flex items-center justify-center gap-1 mb-2">
              <Users className="h-5 w-5 text-purple-600" />
            </div>
            <div className="text-4xl font-bold text-purple-600">{otros.length}</div>
            <p className="text-sm text-muted-foreground mt-1">Otros</p>
          </div>
        </div>

        <div className="text-center py-4 bg-muted/50 rounded-lg">
          <div className="text-3xl font-bold">{activeStaff?.length || 0}</div>
          <p className="text-sm text-muted-foreground mt-1">Total trabajando ahora</p>
        </div>


      </CardContent>
    </Card>
  );
}
