import { useDroppable } from "@dnd-kit/core";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, User } from "lucide-react";
import { Turno } from "@/hooks/useTurnos";

interface AsignacionConRelaciones {
  id: string;
  trabajador: {
    nombre: string;
    apellidos: string;
    rol: string;
  };
  asignacion_automatica: boolean;
}

interface TurnoSlotProps {
  turno: Turno;
  fecha: string;
  asignaciones: AsignacionConRelaciones[];
  onEliminarAsignacion: (id: string) => void;
}

export const TurnoSlot = ({ turno, fecha, asignaciones, onEliminarAsignacion }: TurnoSlotProps) => {
  const dropId = `${turno.id}-${fecha}`;
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: { turno, fecha },
  });

  return (
    <Card
      ref={setNodeRef}
      className={`p-3 min-h-[120px] transition-all ${
        isOver ? "bg-primary/10 border-primary" : "bg-card"
      }`}
    >
      <div className="space-y-2">
        {asignaciones.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-4">
            <User className="h-6 w-6 mb-1 opacity-30" />
            <p className="text-xs">Arrastra un trabajador aquí</p>
          </div>
        ) : (
          asignaciones.map((asignacion) => (
            <div
              key={asignacion.id}
              className="flex items-center justify-between gap-2 p-2 bg-background rounded-md border"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">
                  {asignacion.trabajador.nombre} {asignacion.trabajador.apellidos}
                </p>
                <div className="flex gap-1 mt-1">
                  <Badge variant="outline" className="text-xs">
                    {asignacion.trabajador.rol}
                  </Badge>
                  {asignacion.asignacion_automatica && (
                    <Badge variant="secondary" className="text-xs">
                      Auto
                    </Badge>
                  )}
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => onEliminarAsignacion(asignacion.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
};
