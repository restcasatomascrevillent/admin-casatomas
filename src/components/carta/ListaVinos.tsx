import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";

import { Wine, Trash2, Pencil, Eye, EyeOff, Move } from "lucide-react";
import { Vino, useVinos } from "@/hooks/useVinos";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FotoExpandidaToggle } from "./FotoExpandidaToggle";
import { toast } from "sonner";
import { etiquetaAlergeno, parseAlergenos } from "@/lib/alergenos";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VisibilidadToggles } from "./VisibilidadToggles";
import { EditarVinoModal } from "./EditarVinoModal";
import { ImagePositionSelector } from "../gestion-web/ImagePositionSelector";

// Aspect ratio de la tarjeta (ancho/alto) para el modo colapsado h-40
const CARTA_CARD_ASPECT_RATIO = 300 / 160;

interface ListaVinosProps {
  vinos: Vino[];
}

export function ListaVinos({ vinos }: ListaVinosProps) {
  const {
    eliminarVino,
    toggleExpanded,
    toggleActivado,
    toggleRestaurante,
    toggleTouza,
    actualizarVino,
  } = useVinos();
  const [vinoAEditar, setVinoAEditar] = useState<Vino | null>(null);
  const [fotoAVisualizar, setFotoAVisualizar] = useState<{ url: string; nombre: string } | null>(null);
  const [fotosOcultas, setFotosOcultas] = useState<Set<string>>(() => new Set(vinos.map(v => v.id)));
  const [posicionVino, setPosicionVino] = useState<Vino | null>(null);

  useEffect(() => {
    setFotosOcultas(prev => {
      const next = new Set(prev);
      vinos.forEach(v => next.add(v.id));
      return next;
    });
  }, [vinos]);

  const toggleFotoVisible = (id: string) => {
    setFotosOcultas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleExpanded = (vino: Vino, checked: boolean) => {
    if (!vino.imagen_url?.trim()) return;
    // El toast (y el aviso de si se ha publicado o no) lo emite el hook.
    toggleExpanded.mutate({
      id: vino.id,
      expanded: checked,
      nombre: vino.nombre ?? undefined,
    });
  };

  const handlePositionChange = (position: number) => {
    if (!posicionVino) return;
    actualizarVino.mutate(
      { id: posicionVino.id, imagen_posicion_y: position },
      {
        onSuccess: () => {
          toast.success("Posición de imagen actualizada");
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
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {vinos.map((vino) => (
          <Card 
            key={vino.id} 
            className={cn(
              "overflow-hidden transition-opacity duration-300 hover:shadow-lg",
              !vino.activado && "opacity-60"
            )}
          >
            {vino.imagen_url && !fotosOcultas.has(vino.id) && (
              <div
                className={cn(
                  "relative bg-muted transition-all duration-300 cursor-pointer",
                  vino.expanded ? "h-64" : "h-40"
                )}
                onClick={() =>
                  setFotoAVisualizar({
                    url: vino.imagen_url!,
                    nombre: vino.nombre || "Vino",
                  })
                }
              >
                <img 
                  src={vino.imagen_url} 
                  alt={vino.nombre || "Vino"} 
                  className="w-full h-full object-cover"
                  style={{ objectPosition: `center ${vino.imagen_posicion_y ?? 50}%` }}
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
                  {vino.nombre}
                </h3>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {vino.imagen_url && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11"
                      title="Ajustar posición de imagen"
                      aria-label="Ajustar posición de imagen"
                      onClick={() => setPosicionVino(vino)}
                    >
                      <Move className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 disabled:opacity-100"
                    disabled={!vino.imagen_url?.trim()}
                    title={!vino.imagen_url?.trim() ? "Este vino no tiene foto" : fotosOcultas.has(vino.id) ? "Mostrar foto" : "Ocultar foto"}
                    aria-label={!vino.imagen_url?.trim() ? "Este vino no tiene foto" : fotosOcultas.has(vino.id) ? "Mostrar foto" : "Ocultar foto"}
                    onClick={() => toggleFotoVisible(vino.id)}
                  >
                    {fotosOcultas.has(vino.id) ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Visibilidad Web */}
              <VisibilidadToggles
                restaurante={vino.restaurante ?? false}
                touza={vino.touza ?? false}
                onRestauranteChange={(checked) => toggleRestaurante.mutate({ id: vino.id, restaurante: checked })}
                onTouzaChange={(checked) => toggleTouza.mutate({ id: vino.id, touza: checked })}
                isPending={toggleRestaurante.isPending || toggleTouza.isPending}
                activado={vino.activado ?? true}
                onActivadoChange={(checked) =>
                  toggleActivado.mutate({
                    id: vino.id,
                    activado: checked,
                    nombre: vino.nombre ?? undefined,
                  })
                }
                isActivadoPending={toggleActivado.isPending}
                compact
              />
              <FotoExpandidaToggle
                imagenUrl={vino.imagen_url}
                nombre={vino.nombre || "Vino"}
                expanded={vino.expanded}
                isPending={toggleExpanded.isPending}
                onChange={(checked) => handleToggleExpanded(vino, checked)}
              />
              {vino.descripcion && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {vino.descripcion}
                </p>
              )}
              {vino.ingredientes && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  <span className="font-medium text-foreground/80">Ingredientes:</span> {vino.ingredientes}
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

              {parseAlergenos(vino.alergenos_oficiales).length > 0 && (
                <div className="flex flex-wrap gap-1 pt-2 border-t">
                  {parseAlergenos(vino.alergenos_oficiales).map((alergeno) => (
                    <Badge key={alergeno} variant="outline" className="text-xs py-0 px-1.5">
                      {etiquetaAlergeno(alergeno)}
                    </Badge>
                  ))}
                </div>
              )}

              {vino.alergenos_notas && (
                <p className="text-xs text-muted-foreground italic pt-2 border-t">
                  {vino.alergenos_notas}
                </p>
              )}

              <div className="pt-2 border-t flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 flex-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                  onClick={() => setVinoAEditar(vino)}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 flex-1 text-destructive hover:text-destructive hover:bg-destructive/10"
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
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <EditarVinoModal
        open={!!vinoAEditar}
        onOpenChange={(open) => {
          if (!open) setVinoAEditar(null);
        }}
        vino={vinoAEditar}
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

      {posicionVino && posicionVino.imagen_url && (
        <ImagePositionSelector
          open={!!posicionVino}
          onOpenChange={(open) => {
            if (!open) setPosicionVino(null);
          }}
          imageUrl={posicionVino.imagen_url}
          currentPosition={posicionVino.imagen_posicion_y ?? 50}
          onPositionChange={handlePositionChange}
          aspectRatio={CARTA_CARD_ASPECT_RATIO}
        />
      )}
    </>
  );
}
