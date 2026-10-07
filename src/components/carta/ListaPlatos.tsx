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
import { etiquetaAlergeno, parseAlergenos } from "@/lib/alergenos";

// Aspect ratio de la tarjeta (ancho/alto) para el modo colapsado h-40
const CARTA_CARD_ASPECT_RATIO = 300 / 160;

interface ListaPlatosProps {
  platos: Plato[];
}

export function ListaPlatos({ platos }: ListaPlatosProps) {
  const {
    toggleExpanded,
    toggleActivado,
    eliminarPlato,
    actualizarPlato,
  } = usePlatos();
  const [platoAEliminar, setPlatoAEliminar] = useState<Plato | null>(null);
  const [platoAEditar, setPlatoAEditar] = useState<Plato | null>(null);
  const [fotoAVisualizar, setFotoAVisualizar] = useState<{ url: string; nombre: string } | null>(null);
  const [fotosOcultas, setFotosOcultas] = useState<Set<string>>(() => new Set(platos.map(p => p.id)));
  const [posicionPlato, setPosicionPlato] = useState<Plato | null>(null);

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
    // El toast (y el aviso de si se ha publicado o no) lo emite el hook.
    toggleExpanded.mutate({
      id: plato.id,
      expanded: checked,
      nombre: plato.nombre ?? undefined,
    });
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                      className="h-11 w-11"
                      title="Ajustar posición de imagen"
                      aria-label="Ajustar posición de imagen"
                      onClick={() => setPosicionPlato(plato)}
                    >
                      <Move className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    title={fotosOcultas.has(plato.id) ? "Mostrar foto" : "Ocultar foto"}
                    aria-label={fotosOcultas.has(plato.id) ? "Mostrar foto" : "Ocultar foto"}
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
                activado={plato.activado ?? true}
                onActivadoChange={(checked) =>
                  toggleActivado.mutate({
                    id: plato.id,
                    activado: checked,
                    nombre: plato.nombre ?? undefined,
                  })
                }
                isActivadoPending={toggleActivado.isPending}
                compact
              />

              <label className="flex min-h-11 cursor-pointer items-center justify-between rounded-md bg-muted/50 px-2 py-1.5">
                <span className="text-sm text-muted-foreground">Foto expandida en carta web</span>
                <Switch
                  checked={plato.expanded ?? false}
                  onCheckedChange={(checked) => handleToggleExpanded(plato, checked)}
                  disabled={toggleExpanded.isPending}
                  className="data-[state=checked]:bg-amber-600"
                />
              </label>

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

              {plato.sin_gluten_disponible === true && (
                <Badge variant="outline" className="border-emerald-600/30 bg-emerald-50 text-emerald-800 whitespace-normal">
                  Se puede hacer sin gluten
                </Badge>
              )}

              {/* Mostrar alérgenos oficiales como badges */}
              {parseAlergenos(plato.alergenos_oficiales).length > 0 && (
                <div className="flex flex-wrap gap-1 pt-2 border-t">
                  {parseAlergenos(plato.alergenos_oficiales).map((alergeno) => (
                    <Badge
                      key={alergeno}
                      variant="outline"
                      className="text-xs py-0 px-1.5"
                    >
                      {etiquetaAlergeno(alergeno)}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Botón eliminar */}
              <div className="pt-2 border-t flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 flex-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                  onClick={() => setPlatoAEditar(plato)}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 flex-1 text-destructive hover:text-destructive hover:bg-destructive/10"
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
              className="max-h-[75dvh] w-full rounded-md object-contain"
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
