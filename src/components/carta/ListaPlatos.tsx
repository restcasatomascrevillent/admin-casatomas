import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { esVegetariano } from "@/lib/dietas-plato";
import { ChefHat, Eye, EyeOff, Move } from "lucide-react";
import { Plato, usePlatos } from "@/hooks/usePlatos";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { FotoExpandidaToggle } from "./FotoExpandidaToggle";
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
import { AccionesTarjeta, EstadoLectura, EtiquetaCategoria } from "./PartesTarjetaCarta";
import { lineaActivado, lineaFotoExpandida } from "./estadoLectura";
import { FotoRapidaCarta, type FotoRapidaHandle } from "./FotoRapidaCarta";
import { useInRouterContext } from "react-router-dom";
import { AbrirPlatoDesdeUrl } from "./video/AbrirPlatoDesdeUrl";
import { useVideosPendientesCarta } from "./potente/useVideosPendientesCarta";

// Aspect ratio de la tarjeta (ancho/alto) para el modo colapsado h-40
const CARTA_CARD_ASPECT_RATIO = 300 / 160;

interface ListaPlatosProps {
  platos: Plato[];
  /**
   * Solo «Ver» en la carta, sin «Editar» (06/11/2026): las tarjetas se consultan sin
   * interruptores ni botones (Foto, Editar, Eliminar, posición de la foto); la
   * publicación se lee en texto. Ver la foto en grande sigue disponible.
   */
  soloLectura?: boolean;
}

export function ListaPlatos({ platos, soloLectura = false }: ListaPlatosProps) {
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
  const fotoRapida = useRef<FotoRapidaHandle>(null);
  const enRouter = useInRouterContext();
  const videosPendientes = useVideosPendientesCarta();

  // Las fotos empiezan ocultas en el panel; solo se ocultan las tarjetas que
  // aparecen por primera vez (antes, cualquier refresco volvía a ocultarlas
  // todas, también la que se acababa de subir con «Foto»).
  const idsVistos = useRef(new Set(platos.map((p) => p.id)));
  useEffect(() => {
    const nuevos = platos.filter((p) => !idsVistos.current.has(p.id));
    if (nuevos.length === 0) return;
    nuevos.forEach((p) => idsVistos.current.add(p.id));
    setFotosOcultas(prev => {
      const next = new Set(prev);
      nuevos.forEach((p) => next.add(p.id));
      return next;
    });
  }, [platos]);

  /** Tras subir una foto con «Foto», se enseña en su tarjeta. */
  const mostrarFoto = (id: string) =>
    setFotosOcultas(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });


  const toggleFotoVisible = (id: string) => {
    setFotosOcultas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleExpanded = (plato: Plato, checked: boolean) => {
    if (!plato.imagen_url?.trim()) return;
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
        {platos.map((plato, i) => (
          <Card 
            key={plato.id} 
            data-tour={i === 0 ? "gw-carta-plato" : undefined}
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
                <div className="min-w-0 flex-1 space-y-1">
                  <EtiquetaCategoria categoria={plato.categoria} />
                  <h3 className="font-semibold text-lg leading-tight">{plato.nombre}</h3>
                  {videosPendientes.has(plato.id) && (
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      Vídeo pendiente
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {plato.imagen_url && !soloLectura && (
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
                    className="h-11 w-11 disabled:opacity-100"
                    disabled={!plato.imagen_url?.trim()}
                    title={!plato.imagen_url?.trim() ? "Este plato no tiene foto" : fotosOcultas.has(plato.id) ? "Mostrar foto" : "Ocultar foto"}
                    aria-label={!plato.imagen_url?.trim() ? "Este plato no tiene foto" : fotosOcultas.has(plato.id) ? "Mostrar foto" : "Ocultar foto"}
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

              {soloLectura ? (
                <EstadoLectura lineas={[lineaActivado(plato.activado), lineaFotoExpandida(plato.imagen_url, plato.expanded)]} />
              ) : (
                <>
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

                  <FotoExpandidaToggle
                    imagenUrl={plato.imagen_url}
                    nombre={plato.nombre || "Plato"}
                    expanded={plato.expanded}
                    isPending={toggleExpanded.isPending}
                    onChange={(checked) => handleToggleExpanded(plato, checked)}
                  />
                </>
              )}

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
                  Se puede hacer para celíacos
                </Badge>
              )}

              {/* «Apto para» decidido a mano en el editor (10/11/2026); en automático no se marca aquí. */}
              {typeof plato.apto_celiacos === "boolean" && (
                <Badge variant="outline" className={plato.apto_celiacos ? "border-emerald-600/30 bg-emerald-50 text-emerald-800 whitespace-normal" : "whitespace-normal text-muted-foreground"}>
                  {plato.apto_celiacos ? "Apto para celíacos" : "No apto para celíacos"}
                </Badge>
              )}
              {typeof plato.apto_sin_lactosa === "boolean" && (
                <Badge variant="outline" className={plato.apto_sin_lactosa ? "border-emerald-600/30 bg-emerald-50 text-emerald-800 whitespace-normal" : "whitespace-normal text-muted-foreground"}>
                  {plato.apto_sin_lactosa ? "Apto sin lactosa" : "No apto sin lactosa"}
                </Badge>
              )}

              {esVegetariano(plato.etiquetas_dieteticas) && (
                <Badge variant="outline" className="border-emerald-600/30 bg-emerald-50 text-emerald-800 whitespace-normal">
                  Vegetariano
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

              {!soloLectura && (
                <AccionesTarjeta
                  nombre={plato.nombre}
                  tieneFoto={Boolean(plato.imagen_url?.trim())}
                  onFoto={() => fotoRapida.current?.abrir(plato)}
                  onEditar={() => setPlatoAEditar(plato)}
                  onEliminar={() => setPlatoAEliminar(plato)}
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Con solo «Ver» no se monta nada de lo que escribe (borrar, foto, ficha de edición). */}
      {!soloLectura && (
        <>
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

          <FotoRapidaCarta
            ref={fotoRapida}
            tipo="plato"
            bucket="platos"
            tabla="Platos"
            onGuardada={mostrarFoto}
            guardarUrl={(id, url) => actualizarPlato.mutateAsync({ id, imagen_url: url })}
            quitarFoto={(id) => actualizarPlato.mutateAsync({ id, imagen_url: null, expanded: false })}
          />

          {enRouter && <AbrirPlatoDesdeUrl<Plato> platos={platos} onAbrir={setPlatoAEditar} />}
          <EditarPlatoModal
            open={!!platoAEditar}
            onOpenChange={(open) => {
              if (!open) setPlatoAEditar(null);
            }}
            plato={platoAEditar}
          />
        </>
      )}

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

      {!soloLectura && posicionPlato && posicionPlato.imagen_url && (
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
