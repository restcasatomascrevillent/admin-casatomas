import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Wine, Trash2 } from "lucide-react";
import { Vino, useVinos } from "@/hooks/useVinos";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

interface ListaVinosProps {
  vinos: Vino[];
}

export function ListaVinos({ vinos }: ListaVinosProps) {
  const { toggleActivado, eliminarVino } = useVinos();

  const handleToggle = (vino: Vino, checked: boolean) => {
    toggleActivado.mutate(
      { id: vino.id, activado: checked },
      {
        onSuccess: () => {
          toast.success(
            checked 
              ? `${vino.nombre} está ahora activo` 
              : `${vino.nombre} está ahora inactivo`
          );
        },
      }
    );
  };

  if (vinos.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
        <div className="text-center">
          <Wine className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            No hay vinos en esta categoría. Haz clic en "Añadir" para comenzar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {vinos.map((vino) => (
        <Card 
          key={vino.id} 
          className={cn(
            "overflow-hidden transition-opacity duration-300 hover:shadow-lg",
            !vino.activado && "opacity-60"
          )}
        >
          {vino.imagen_url && (
            <div className="relative h-40 bg-muted">
              <img 
                src={vino.imagen_url} 
                alt={vino.nombre || "Vino"} 
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
          )}
          
          <CardContent className="p-4 space-y-3">
            {/* Header con nombre */}
            <h3 className="font-semibold text-base leading-tight">
              {vino.nombre}
            </h3>

            {/* Toggle Activo */}
            <div className={cn(
              "flex items-center justify-between py-2 px-3 rounded-md",
              vino.activado
                ? "bg-status-confirmed/10 dark:bg-status-confirmed/20"
                : "bg-destructive/10 dark:bg-destructive/20"
            )}>
              <div className="flex items-center gap-2">
                <Wine className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{vino.activado ? "Activo" : "Inactivo"}</span>
              </div>
              <Switch
                checked={vino.activado || false}
                onCheckedChange={(checked) => handleToggle(vino, checked)}
                disabled={toggleActivado.isPending}
                className="data-[state=checked]:bg-green-600"
              />
            </div>
            
            {vino.descripcion && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {vino.descripcion}
              </p>
            )}

            {/* Origen */}
            {(vino.denominacion_origen || vino.ubicacion_region || vino.ubicacion_pais) && (
              <p className="text-xs text-muted-foreground">
                {[vino.denominacion_origen, vino.ubicacion_region, vino.ubicacion_pais]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}

            {/* Precio */}
            <div className="flex items-end justify-between pt-2 border-t">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-primary">
                  {vino.precio_eur ? `${vino.precio_eur.toFixed(2)}` : "—"}
                </span>
                <span className="text-lg font-medium text-primary">€</span>
              </div>
            </div>

            {vino.alergenos_notas && (
              <p className="text-xs text-muted-foreground italic pt-2 border-t">
                {vino.alergenos_notas}
              </p>
            )}

            {/* Botón eliminar */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Eliminar vino?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta acción eliminará permanentemente "{vino.nombre}" de la carta. Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => eliminarVino.mutate(vino.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Eliminar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
