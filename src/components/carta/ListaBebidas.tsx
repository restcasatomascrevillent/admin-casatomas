import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";

import { GlassWater, Trash2, Eye, EyeOff } from "lucide-react";
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
  const [fotosOcultas, setFotosOcultas] = useState<Set<string>>(() => new Set(bebidas.map(b => b.id)));

  const toggleFotoVisible = (id: string) => {
    setFotosOcultas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
          {bebida.imagen_url && !fotosOcultas.has(bebida.id) && (
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
            {/* Header con nombre y controles de foto */}
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-base leading-tight flex-1 min-w-0">
                {bebida.nombre}
              </h3>
              {bebida.imagen_url && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title={fotosOcultas.has(bebida.id) ? "Mostrar foto" : "Ocultar foto"}
                    onClick={() => toggleFotoVisible(bebida.id)}
                  >
                    {fotosOcultas.has(bebida.id) ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              )}
            </div>

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
