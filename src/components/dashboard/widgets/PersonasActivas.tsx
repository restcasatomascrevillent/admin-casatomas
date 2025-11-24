import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import { useActiveStaff } from "@/hooks/useDashboardStats";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Personal Activo</CardTitle>
        <Users className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex gap-6">
            <div>
              <div className="text-2xl font-bold text-primary">{cocina.length}</div>
              <p className="text-xs text-muted-foreground">Cocina</p>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary">{sala.length}</div>
              <p className="text-xs text-muted-foreground">Sala</p>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t">
            {activeStaff?.slice(0, 5).map((staff) => {
              const trabajador = staff.trabajadores as any;
              const turno = staff.turnos as any;
              return (
                <div key={staff.id} className="flex items-center justify-between text-sm">
                  <div className="flex-1">
                    <div className="font-medium">
                      {trabajador?.nombre} {trabajador?.apellidos}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {trabajador?.puesto} · Entrada: {format(new Date(staff.hora_entrada), "HH:mm")}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {turno ? `${turno.hora_inicio} - ${turno.hora_fin}` : "Sin turno"}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
