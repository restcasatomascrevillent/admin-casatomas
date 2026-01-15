import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ChefHat, ConciergeBell, Clock, ArrowRightCircle, ArrowLeftCircle } from "lucide-react";
import { useActiveStaff, useUpcomingShiftChanges } from "@/hooks/useDashboardStats";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export function PersonasActivas() {
  const { data: activeStaff } = useActiveStaff();
  const { data: shiftChanges } = useUpcomingShiftChanges();

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

  const formatTime = (time: string) => time?.slice(0, 5) || "";

  const getPuestoLabel = (puesto: string) => {
    const labels: Record<string, string> = {
      cocinero: "Cocinero",
      ayudante_cocina: "Ayud. Cocina",
      camarero: "Camarero",
      ayudante_camarero: "Ayud. Camarero",
      encargado: "Encargado",
      limpieza: "Limpieza",
    };
    return labels[puesto] || puesto;
  };

  const hasShiftChanges = (shiftChanges?.ending?.length || 0) > 0 || (shiftChanges?.starting?.length || 0) > 0;

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-semibold">Personal Activo</CardTitle>
        <Users className="h-5 w-5 text-primary" />
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Contadores por departamento */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2 bg-orange-500/10 rounded-lg">
            <div className="flex items-center justify-center gap-1 mb-1">
              <ChefHat className="h-4 w-4 text-orange-600" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-orange-600">{cocina.length}</div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground">Cocina</p>
          </div>
          <div className="text-center p-2 bg-blue-500/10 rounded-lg">
            <div className="flex items-center justify-center gap-1 mb-1">
              <ConciergeBell className="h-4 w-4 text-blue-600" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-blue-600">{sala.length}</div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground">Sala</p>
          </div>
          <div className="text-center p-2 bg-purple-500/10 rounded-lg">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Users className="h-4 w-4 text-purple-600" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-purple-600">{otros.length}</div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground">Otros</p>
          </div>
        </div>

        {/* Total */}
        <div className="text-center py-2 bg-muted/50 rounded-lg">
          <div className="text-xl sm:text-2xl font-bold">{activeStaff?.length || 0}</div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground">Total trabajando ahora</p>
        </div>

        {/* Próximos cambios de turno */}
        {hasShiftChanges && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Próximos cambios
            </div>
            <ScrollArea className="h-[80px]">
              <div className="space-y-1.5 pr-2">
                {shiftChanges?.ending?.slice(0, 3).map((shift: any) => (
                  <div
                    key={`end-${shift.id}`}
                    className="flex items-center gap-2 p-1.5 rounded bg-red-500/10 text-xs"
                  >
                    <ArrowLeftCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    <span className="font-medium text-red-600">{formatTime(shift.hora_fin)}</span>
                    <span className="truncate flex-1">
                      {shift.trabajadores?.nombre} {shift.trabajadores?.apellidos?.charAt(0)}.
                    </span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                      {getPuestoLabel(shift.trabajadores?.puesto)}
                    </Badge>
                  </div>
                ))}
                {shiftChanges?.starting?.slice(0, 3).map((shift: any) => (
                  <div
                    key={`start-${shift.id}`}
                    className="flex items-center gap-2 p-1.5 rounded bg-green-500/10 text-xs"
                  >
                    <ArrowRightCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    <span className="font-medium text-green-600">{formatTime(shift.hora_inicio)}</span>
                    <span className="truncate flex-1">
                      {shift.trabajadores?.nombre} {shift.trabajadores?.apellidos?.charAt(0)}.
                    </span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                      {getPuestoLabel(shift.trabajadores?.puesto)}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Lista de personal activo */}
        {activeStaff && activeStaff.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              En turno ahora
            </div>
            <ScrollArea className="h-[80px]">
              <div className="space-y-1 pr-2">
                {activeStaff.map((staff: any) => (
                  <div
                    key={staff.id}
                    className="flex items-center justify-between text-xs p-1.5 rounded bg-muted/30"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-medium truncate">
                        {staff.trabajadores?.nombre} {staff.trabajadores?.apellidos?.charAt(0)}.
                      </span>
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                        {getPuestoLabel(staff.trabajadores?.puesto)}
                      </Badge>
                    </div>
                    <span className="text-muted-foreground shrink-0">
                      {formatTime(staff.turnos?.hora_inicio || staff.hora_entrada)} - {formatTime(staff.turnos?.hora_fin || "")}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
