import { Edit, Trash2, UserX, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTrabajadores, useEliminarTrabajador, useActualizarTrabajador } from "@/hooks/useTrabajadores";
import { Skeleton } from "@/components/ui/skeleton";

interface ListaTrabajadoresProps {
  onEditar: (id: string) => void;
}

const PUESTOS_LABELS: Record<string, string> = {
  gerente: "Gerente",
  camarero: "Camarero",
  ayudante_camarero: "Ayudante de Camarero",
  cocinero: "Cocinero",
  ayudante_cocina: "Ayudante de Cocina",
  recepcionista: "Recepcionista",
  limpieza: "Limpieza",
};

export const ListaTrabajadores = ({ onEditar }: ListaTrabajadoresProps) => {
  const { data: trabajadores, isLoading } = useTrabajadores();
  const eliminarMutation = useEliminarTrabajador();
  const actualizarMutation = useActualizarTrabajador();

  const handleEliminar = (id: string) => {
    eliminarMutation.mutate(id);
  };

  const toggleActivo = (id: string, activo: boolean) => {
    actualizarMutation.mutate({ id, activo: !activo });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!trabajadores || trabajadores.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No hay trabajadores registrados
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Puesto</TableHead>
          <TableHead>Teléfono</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="text-right">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trabajadores.map((trabajador) => (
          <TableRow key={trabajador.id}>
            <TableCell className="font-medium">
              {trabajador.nombre} {trabajador.apellidos}
            </TableCell>
            <TableCell>
              <Badge variant="outline">
                {PUESTOS_LABELS[trabajador.puesto] || trabajador.puesto}
              </Badge>
            </TableCell>
            <TableCell>{trabajador.telefono}</TableCell>
            <TableCell>{trabajador.email || "-"}</TableCell>
            <TableCell>
              {trabajador.activo ? (
                <Badge variant="default" className="gap-1">
                  <UserCheck className="h-3 w-3" />
                  Activo
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <UserX className="h-3 w-3" />
                  Inactivo
                </Badge>
              )}
            </TableCell>
            <TableCell className="text-right space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleActivo(trabajador.id, trabajador.activo)}
              >
                {trabajador.activo ? (
                  <UserX className="h-4 w-4" />
                ) : (
                  <UserCheck className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEditar(trabajador.id)}
              >
                <Edit className="h-4 w-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Eliminar trabajador?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta acción no se puede deshacer. Se eliminarán también todos
                      los turnos asociados.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleEliminar(trabajador.id)}
                      className="bg-destructive text-destructive-foreground"
                    >
                      Eliminar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
