import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ChefHat, ConciergeBell, Clock } from "lucide-react";
import { useActiveStaff } from "@/hooks/useDashboardStats";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

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

  const getInitials = (nombre: string, apellidos: string) => {
    return `${nombre?.charAt(0) || ""}${apellidos?.charAt(0) || ""}`.toUpperCase();
  };

  const formatHora = (hora: string | Date) => {
    if (typeof hora === 'string' && hora.includes(':')) {
      return hora.substring(0, 5);
    }
    return format(new Date(hora), "HH:mm");
  };

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-semibold">Personal Activo</CardTitle>
        <Users className="h-5 w-5 text-primary" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-orange-500/10 rounded-lg">
            <div className="flex items-center justify-center gap-1 mb-1">
              <ChefHat className="h-4 w-4 text-orange-600" />
            </div>
            <div className="text-3xl font-bold text-orange-600">{cocina.length}</div>
            <p className="text-xs text-muted-foreground">Cocina</p>
          </div>
          <div className="text-center p-3 bg-blue-500/10 rounded-lg">
            <div className="flex items-center justify-center gap-1 mb-1">
              <ConciergeBell className="h-4 w-4 text-blue-600" />
            </div>
            <div className="text-3xl font-bold text-blue-600">{sala.length}</div>
            <p className="text-xs text-muted-foreground">Sala</p>
          </div>
          <div className="text-center p-3 bg-purple-500/10 rounded-lg">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Users className="h-4 w-4 text-purple-600" />
            </div>
            <div className="text-3xl font-bold text-purple-600">{otros.length}</div>
            <p className="text-xs text-muted-foreground">Otros</p>
          </div>
        </div>

        <div className="text-center py-2 bg-muted/50 rounded-lg">
          <div className="text-2xl font-bold">{activeStaff?.length || 0}</div>
          <p className="text-xs text-muted-foreground">Total trabajando ahora</p>
        </div>

        {activeStaff && activeStaff.length > 0 && (
          <div className="pt-3 border-t space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Personal en turno
            </p>
            <div className="space-y-2 max-h-[180px] overflow-y-auto">
              {activeStaff.slice(0, 6).map((staff) => {
                const trabajador = staff.trabajadores as any;
                const turno = staff.turnos as any;
                return (
                  <div key={staff.id} className="flex items-center gap-3 bg-muted/50 p-2 rounded">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {getInitials(trabajador?.nombre, trabajador?.apellidos)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {trabajador?.nombre} {trabajador?.apellidos}
                      </div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {trabajador?.puesto?.replace("_", " ")}
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className="text-xs">
                        {formatHora(staff.hora_entrada)}
                      </Badge>
                      {turno && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          hasta {turno.hora_fin?.substring(0, 5)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
