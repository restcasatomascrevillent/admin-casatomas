import { Card, CardContent } from "@/components/ui/card";

import { GlassWater, Trash2 } from "lucide-react";
import { Bebida, useBebidas } from "@/hooks/useBebidas";
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
import { VisibilidadToggles } from "./VisibilidadToggles";

interface ListaBebidasProps {
  bebidas: Bebida[];
}

export function ListaBebidas({ bebidas }: ListaBebidasProps) {
  const { eliminarBebida, toggleRestaurante, toggleTouza } = useBebidas();

  if (bebidas.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
        <div className="text-center">
          <GlassWater className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            No hay bebidas en esta categoría. Haz clic en "Añadir" para comenzar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {bebidas.map((bebida) => (
        <Card 
          key={bebida.id} 
          className={cn(
            "overflow-hidden transition-opacity duration-300 hover:shadow-lg",
            !bebida.activado && "opacity-60"
          )}
        >
          {bebida.imagen_url && (
            <div className="relative h-40 bg-muted">
              <img 
                src={bebida.imagen_url} 
                alt={bebida.nombre || "Bebida"} 
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
          )}
          
          <CardContent className="p-4 space-y-3">
            {/* Visibilidad Web */}
            <VisibilidadToggles
              restaurante={bebida.restaurante ?? false}
              touza={bebida.touza ?? false}
              onRestauranteChange={(checked) => toggleRestaurante.mutate({ id: bebida.id, restaurante: checked })}
              onTouzaChange={(checked) => toggleTouza.mutate({ id: bebida.id, touza: checked })}
              isPending={toggleRestaurante.isPending || toggleTouza.isPending}
              compact
            />
            <VisibilidadToggles
              restaurante={bebida.restaurante ?? false}
              touza={bebida.touza ?? false}
              onRestauranteChange={(checked) => toggleRestaurante.mutate({ id: bebida.id, restaurante: checked })}
              onTouzaChange={(checked) => toggleTouza.mutate({ id: bebida.id, touza: checked })}
              isPending={toggleRestaurante.isPending || toggleTouza.isPending}
              compact
            />
            {bebida.descripcion && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {bebida.descripcion}
              </p>
            )}

            {/* Precio y tamaño */}
            <div className="flex items-end justify-between pt-2 border-t">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-primary">
                  {bebida.precio_eur ? `${bebida.precio_eur.toFixed(2)}` : "—"}
                </span>
                <span className="text-lg font-medium text-primary">€</span>
              </div>
              {bebida.tamano && (
                <span className="text-xs text-muted-foreground">
                  {bebida.tamano}
                </span>
              )}
            </div>

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
                  <AlertDialogTitle>¿Eliminar bebida?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta acción eliminará permanentemente "{bebida.nombre}" de la carta. Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => eliminarBebida.mutate(bebida.id)}
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
