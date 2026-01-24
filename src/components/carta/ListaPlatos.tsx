import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChefHat, Trash2 } from "lucide-react";
import { Plato, usePlatos } from "@/hooks/usePlatos";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
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
import { VisibilidadToggles } from "./VisibilidadToggles";

// Mapeo de alérgenos oficiales
const ALERGENOS_MAP: Record<string, string> = {
  gluten: "Gluten",
  crustaceos: "Crustáceos",
  huevo: "Huevo",
  pescado: "Pescado",
  cacahuetes: "Cacahuetes",
  frutos_cascara: "Frutos de cáscara",
  lacteos: "Lácteos",
  apio: "Apio",
  mostaza: "Mostaza",
  sesamo: "Sésamo",
  sulfitos: "Sulfitos",
  altramuces: "Altramuces",
  moluscos: "Moluscos",
  soja: "Soja",
};

interface ListaPlatosProps {
  platos: Plato[];
}

export function ListaPlatos({ platos }: ListaPlatosProps) {
  const { toggleExpanded, eliminarPlato, toggleRestaurante, toggleTouza } = usePlatos();
  const [platoAEliminar, setPlatoAEliminar] = useState<Plato | null>(null);

  const handleToggleExpanded = (plato: Plato, checked: boolean) => {
    toggleExpanded.mutate(
      { id: plato.id, expanded: checked },
      {
        onSuccess: () => {
          toast.success(
            checked 
              ? `${plato.nombre} se mostrará expandido` 
              : `${plato.nombre} se mostrará normal`
          );
        },
      }
    );
  };

  const handleEliminar = () => {
    if (platoAEliminar) {
      eliminarPlato.mutate(platoAEliminar.id);
      setPlatoAEliminar(null);
    }
  };

  if (platos.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
        <div className="text-center">
          <ChefHat className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            No hay platos en esta categoría. Haz clic en "Añadir" para comenzar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {platos.map((plato) => (
          <Card 
            key={plato.id} 
            className={cn(
              "overflow-hidden transition-opacity duration-300 hover:shadow-lg",
              !plato.activado && "opacity-60"
            )}
          >
            {plato.imagen_url && (
              <div className="relative h-40 bg-muted">
                <img 
                  src={plato.imagen_url} 
                  alt={plato.nombre || "Plato"} 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}
            
            <CardContent className="p-4 space-y-3">
              {/* Header con nombre y toggle expandido */}
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-base leading-tight flex-1 min-w-0">
                  {plato.nombre}
                </h3>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-medium text-muted-foreground">
                    Foto expandida
                  </span>
                  <Switch
                    checked={plato.expanded || false}
                    onCheckedChange={(checked) => handleToggleExpanded(plato, checked)}
                    disabled={toggleExpanded.isPending}
                    className="data-[state=checked]:bg-primary"
                  />
                </div>
              </div>

              {/* Visibilidad Web */}
              <VisibilidadToggles
                restaurante={plato.restaurante ?? false}
                touza={plato.touza ?? false}
                onRestauranteChange={(checked) => toggleRestaurante.mutate({ id: plato.id, restaurante: checked })}
                onTouzaChange={(checked) => toggleTouza.mutate({ id: plato.id, touza: checked })}
                isPending={toggleRestaurante.isPending || toggleTouza.isPending}
                compact
              />
              {plato.descripcion && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {plato.descripcion}
                </p>
              )}

              {/* Precio y unidad */}
              <div className="flex items-end justify-between pt-2 border-t">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-primary">
                    {plato.precio_eur ? `${plato.precio_eur.toFixed(2)}` : "—"}
                  </span>
                  <span className="text-lg font-medium text-primary">€</span>
                </div>
                {plato.unidad && (
                  <span className="text-xs text-muted-foreground">
                    por {plato.unidad}
                  </span>
                )}
              </div>

              {/* Mostrar alérgenos oficiales como badges */}
              {plato.alergenos_oficiales && Array.isArray(plato.alergenos_oficiales) && plato.alergenos_oficiales.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-2 border-t">
                  {(plato.alergenos_oficiales as string[]).map((alergeno) => {
                    const label = ALERGENOS_MAP[alergeno] || alergeno;
                    return (
                      <Badge 
                        key={alergeno} 
                        variant="outline" 
                        className="text-xs py-0 px-1.5"
                      >
                        {label}
                      </Badge>
                    );
                  })}
                </div>
              )}

              {plato.alergenos_notas && (
                <p className="text-xs text-muted-foreground italic pt-1">
                  {plato.alergenos_notas}
                </p>
              )}

              {/* Botón eliminar */}
              <div className="pt-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setPlatoAEliminar(plato)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Dialog de confirmación */}
      <AlertDialog open={!!platoAEliminar} onOpenChange={(open) => !open && setPlatoAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar plato?</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que quieres eliminar "{platoAEliminar?.nombre}"? Esta acción no se puede deshacer.
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
