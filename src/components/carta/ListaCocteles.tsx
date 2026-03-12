import { useState } from "react";
import { Wine, Trash2, Eye, EyeOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCocteles, Coctel } from "@/hooks/useCocteles";
import { cn } from "@/lib/utils";
import { VisibilidadToggles } from "./VisibilidadToggles";

interface ListaCoctelesProps {
  cocteles: Coctel[];
}

export function ListaCocteles({ cocteles }: ListaCoctelesProps) {
  const { eliminarCoctel, toggleRestaurante, toggleTouza } = useCocteles();
  const [coctelAEliminar, setCoctelAEliminar] = useState<Coctel | null>(null);
  const [fotosOcultas, setFotosOcultas] = useState<Set<string>>(() => new Set(cocteles.map(c => c.id)));

  const toggleFotoVisible = (id: string) => {
    setFotosOcultas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleEliminar = () => {
    if (coctelAEliminar) {
      eliminarCoctel.mutate(coctelAEliminar.id);
      setCoctelAEliminar(null);
    }
  };

  if (cocteles.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
        <div className="text-center">
          <Wine className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            No hay cócteles para mostrar. Haz clic en "Añadir" para comenzar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cocteles.map((coctel) => (
          <Card
            key={coctel.id}
            className={cn(
              "overflow-hidden transition-opacity duration-300 hover:shadow-lg",
              !coctel.activado && "opacity-60"
            )}
          >
            <CardContent className="p-4 space-y-3">
              {/* Header con nombre */}
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-base leading-tight flex-1 min-w-0">
                  {coctel.nombre}
                </h3>
                {coctel.categoria && (
                  <Badge variant="secondary" className="flex-shrink-0">
                    {coctel.categoria}
                  </Badge>
                )}
              </div>

              {/* Visibilidad Web */}
              <VisibilidadToggles
                restaurante={coctel.restaurante ?? false}
                touza={coctel.touza ?? false}
                onRestauranteChange={(checked) => toggleRestaurante.mutate({ id: coctel.id, restaurante: checked })}
                onTouzaChange={(checked) => toggleTouza.mutate({ id: coctel.id, touza: checked })}
                isPending={toggleRestaurante.isPending || toggleTouza.isPending}
                compact
              />


              {/* Alérgenos */}
              {coctel.alergenos_oficiales && Array.isArray(coctel.alergenos_oficiales) && coctel.alergenos_oficiales.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-2 border-t">
                  {(coctel.alergenos_oficiales as string[]).map((alergeno) => (
                    <Badge key={alergeno} variant="outline" className="text-[10px]">
                      {alergeno}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Precio y eliminar */}
              <div className="flex items-end justify-between pt-2 border-t">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-primary">
                    {coctel.precio_eur ? `${coctel.precio_eur.toFixed(2)}` : "—"}
                  </span>
                  <span className="text-lg font-medium text-primary">€</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setCoctelAEliminar(coctel)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AlertDialog open={!!coctelAEliminar} onOpenChange={(open) => !open && setCoctelAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cóctel?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará permanentemente "{coctelAEliminar?.nombre}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEliminar}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
