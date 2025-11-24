import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone } from "lucide-react";
import { useCampanasActivas } from "@/hooks/useCampanas";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function CampanasActivas() {
  const { data: campanas } = useCampanasActivas();

  const getEstadoBadge = (estado: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      activa: "default",
      pausada: "secondary",
      finalizada: "destructive",
    };
    return variants[estado] || "default";
  };

  return (
    <Card className="col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Campañas Activas</CardTitle>
        <Megaphone className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        {campanas && campanas.length > 0 ? (
          campanas.slice(0, 5).map((campana) => (
            <div key={campana.id} className="p-3 border border-border rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{campana.nombre}</span>
                <Badge variant={getEstadoBadge(campana.estado)} className="text-xs capitalize">
                  {campana.estado}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="capitalize">{campana.canal}</span>
                <span>Inicio: {format(new Date(campana.fecha_inicio), "dd/MM/yy", { locale: es })}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t">
                <div>
                  <div className="text-muted-foreground">Clics</div>
                  <div className="font-medium">{campana.clics}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Reservas</div>
                  <div className="font-medium">{campana.reservas_generadas}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Visitas</div>
                  <div className="font-medium">{campana.visitas_web}</div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center text-muted-foreground py-4">
            No hay campañas activas
          </div>
        )}
      </CardContent>
    </Card>
  );
}
