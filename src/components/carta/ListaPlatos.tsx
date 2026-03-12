import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChefHat, Eye, EyeOff, Move, Pencil, Trash2 } from "lucide-react";
import { Plato, usePlatos } from "@/hooks/usePlatos";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VisibilidadToggles } from "./VisibilidadToggles";
import { EditarPlatoModal } from "./EditarPlatoModal";
import { ImagePositionSelector } from "../gestion-web/ImagePositionSelector";

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

// Aspect ratio de la tarjeta (ancho/alto) para el modo colapsado h-40
const CARTA_CARD_ASPECT_RATIO = 300 / 160;

interface ListaPlatosProps {
  platos: Plato[];
}

export function ListaPlatos({ platos }: ListaPlatosProps) {
  const { toggleExpanded, eliminarPlato, toggleRestaurante, toggleTouza, actualizarPlato } = usePlatos();
  const [platoAEliminar, setPlatoAEliminar] = useState<Plato | null>(null);
  const [platoAEditar, setPlatoAEditar] = useState<Plato | null>(null);
  const [fotoAVisualizar, setFotoAVisualizar] = useState<{ url: string; nombre: string } | null>(null);
  const [fotosOcultas, setFotosOcultas] = useState<Set<string>>(() => new Set(platos.map(p => p.id)));

  useEffect(() => {
    setFotosOcultas(prev => {
      const next = new Set(prev);
      platos.forEach(p => next.add(p.id));
      return next;
    });
  }, [platos]);


  const toggleFotoVisible = (id: string) => {
    setFotosOcultas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const handlePositionChange = (position: number) => {
    if (!posicionPlato) return;
    actualizarPlato.mutate(
      { id: posicionPlato.id, imagen_posicion_y: position },
      {
        onSuccess: () => {
          toast.success("Posición de imagen actualizada");
        },
      }
    );
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
            {plato.imagen_url && !fotosOcultas.has(plato.id) && (
              <div
                className={cn(
                  "relative bg-muted transition-all duration-300 cursor-pointer",
                  plato.expanded ? "h-64" : "h-40"
                )}
                onClick={() =>
                  setFotoAVisualizar({
                    url: plato.imagen_url!,
                    nombre: plato.nombre || "Plato",
                  })
                }
              >
                <img 
                  src={plato.imagen_url} 
                  alt={plato.nombre || "Plato"} 
                  className="w-full h-full object-cover"
                  style={{ objectPosition: `center ${plato.imagen_posicion_y ?? 50}%` }}
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
                  {plato.nombre}
                </h3>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {plato.imagen_url && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Ajustar posición de imagen"
                      onClick={() => setPosicionPlato(plato)}
                    >
                      <Move className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title={fotosOcultas.has(plato.id) ? "Mostrar foto" : "Ocultar foto"}
                    onClick={() => toggleFotoVisible(plato.id)}
                  >
                    {fotosOcultas.has(plato.id) ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
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

              <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5">
                <span className="text-xs text-muted-foreground">Foto expandida en carta web</span>
                <Switch
                  checked={plato.expanded ?? false}
                  onCheckedChange={(checked) => handleToggleExpanded(plato, checked)}
                  disabled={toggleExpanded.isPending}
                  className="scale-90 data-[state=checked]:bg-amber-600"
                />
              </div>

              {plato.descripcion && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {plato.descripcion}
                </p>
              )}
              {plato.ingredientes && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  <span className="font-medium text-foreground/80">Ingredientes:</span> {plato.ingredientes}
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
              <div className="pt-2 border-t flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                  onClick={() => setPlatoAEditar(plato)}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10"
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

      <EditarPlatoModal
        open={!!platoAEditar}
        onOpenChange={(open) => {
          if (!open) setPlatoAEditar(null);
        }}
        plato={platoAEditar}
      />

      <Dialog
        open={!!fotoAVisualizar}
        onOpenChange={(open) => {
          if (!open) setFotoAVisualizar(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{fotoAVisualizar?.nombre || "Foto"}</DialogTitle>
          </DialogHeader>
          {fotoAVisualizar && (
            <img
              src={fotoAVisualizar.url}
              alt={fotoAVisualizar.nombre}
              className="max-h-[75vh] w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {posicionPlato && posicionPlato.imagen_url && (
        <ImagePositionSelector
          open={!!posicionPlato}
          onOpenChange={(open) => {
            if (!open) setPosicionPlato(null);
          }}
          imageUrl={posicionPlato.imagen_url}
          currentPosition={posicionPlato.imagen_posicion_y ?? 50}
          onPositionChange={handlePositionChange}
          aspectRatio={CARTA_CARD_ASPECT_RATIO}
        />
      )}
    </>
  );
}
