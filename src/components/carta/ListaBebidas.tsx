import { useState, useEffect, useRef } from "react";
import { GlassWater, Eye, EyeOff } from "lucide-react";
import { Bebida, useBebidas } from "@/hooks/useBebidas";
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
} from "@/components/ui/alert-dialog";
import { VisibilidadToggles } from "./VisibilidadToggles";
import { EditarBebidaModal } from "./EditarBebidaModal";
import { AccionesTarjeta, EstadoLectura, EtiquetaCategoria } from "./PartesTarjetaCarta";
import { lineaActivado, lineaCartas } from "./estadoLectura";
import { FotoRapidaCarta, type FotoRapidaHandle } from "./FotoRapidaCarta";
import { TarjetaCartaLateral } from "./TarjetaCartaLateral";

interface ListaBebidasProps {
  bebidas: Bebida[];
  /**
   * Solo «Ver» en la carta, sin «Editar» (06/11/2026): sin interruptores ni botones
   * (Foto, Editar, Eliminar); la publicación se lee en texto.
   */
  soloLectura?: boolean;
}

export function ListaBebidas({ bebidas, soloLectura = false }: ListaBebidasProps) {
  const { eliminarBebida, actualizarBebida, toggleActivado, toggleRestaurante, toggleTouza } = useBebidas();
  const [bebidaAEditar, setBebidaAEditar] = useState<Bebida | null>(null);
  const [bebidaAEliminar, setBebidaAEliminar] = useState<Bebida | null>(null);
  const fotoRapida = useRef<FotoRapidaHandle>(null);
  const [fotosOcultas, setFotosOcultas] = useState<Set<string>>(() => new Set(bebidas.map(b => b.id)));

  // Las fotos empiezan ocultas en el panel; solo se ocultan las tarjetas que
  // aparecen por primera vez (antes, cualquier refresco volvía a ocultarlas
  // todas, también la que se acababa de subir con «Foto»).
  const idsVistos = useRef(new Set(bebidas.map((b) => b.id)));
  useEffect(() => {
    const nuevos = bebidas.filter((b) => !idsVistos.current.has(b.id));
    if (nuevos.length === 0) return;
    nuevos.forEach((b) => idsVistos.current.add(b.id));
    setFotosOcultas(prev => {
      const next = new Set(prev);
      nuevos.forEach((b) => next.add(b.id));
      return next;
    });
  }, [bebidas]);

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
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {bebidas.map((bebida) => {
          const tieneFoto = Boolean(bebida.imagen_url?.trim());
          const fotoOculta = fotosOcultas.has(bebida.id);
          return (
            <TarjetaCartaLateral
              key={bebida.id}
              className={cn(!bebida.activado && "opacity-60")}
              foto={tieneFoto && !fotoOculta ? { url: bebida.imagen_url!, alt: bebida.nombre || "Bebida" } : null}
              categoria={<EtiquetaCategoria categoria={bebida.categoria} />}
              titulo={<h3 className="font-semibold text-base leading-tight [overflow-wrap:anywhere]">{bebida.nombre}</h3>}
              controlesFoto={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 disabled:opacity-100"
                  disabled={!tieneFoto}
                  title={!tieneFoto ? "Esta bebida no tiene foto" : fotoOculta ? "Mostrar foto" : "Ocultar foto"}
                  aria-label={!tieneFoto ? "Esta bebida no tiene foto" : fotoOculta ? "Mostrar foto" : "Ocultar foto"}
                  onClick={() => toggleFotoVisible(bebida.id)}
                >
                  {fotoOculta ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4" />}
                </Button>
              }
              controles={
                soloLectura ? (
                  <EstadoLectura lineas={[lineaActivado(bebida.activado), lineaCartas(bebida.restaurante, bebida.touza)]} />
                ) : (
                  /* Visibilidad Web */
                  <VisibilidadToggles
                    restaurante={bebida.restaurante ?? false}
                    touza={bebida.touza ?? false}
                    onRestauranteChange={(checked) => toggleRestaurante.mutate({ id: bebida.id, restaurante: checked })}
                    onTouzaChange={(checked) => toggleTouza.mutate({ id: bebida.id, touza: checked })}
                    isPending={toggleRestaurante.isPending || toggleTouza.isPending}
                    activado={bebida.activado ?? true}
                    onActivadoChange={(checked) =>
                      toggleActivado.mutate({
                        id: bebida.id,
                        activado: checked,
                        nombre: bebida.nombre ?? undefined,
                      })
                    }
                    isActivadoPending={toggleActivado.isPending}
                    compact
                  />
                )
              }
              info={
                <>
                  {bebida.descripcion && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{bebida.descripcion}</p>
                  )}

                  {/* Precio y tamaño */}
                  <div className="flex items-end justify-between pt-2 border-t">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-primary">
                        {bebida.precio_eur ? `${bebida.precio_eur.toFixed(2)}` : "—"}
                      </span>
                      <span className="text-lg font-medium text-primary">€</span>
                    </div>
                    {bebida.tamano && <span className="text-xs text-muted-foreground">{bebida.tamano}</span>}
                  </div>
                </>
              }
              acciones={
                soloLectura ? null : (
                  <AccionesTarjeta
                    nombre={bebida.nombre}
                    tieneFoto={tieneFoto}
                    onFoto={() => fotoRapida.current?.abrir(bebida)}
                    onEditar={() => setBebidaAEditar(bebida)}
                    onEliminar={() => setBebidaAEliminar(bebida)}
                  />
                )
              }
            />
          );
        })}
      </div>

      {/* Con solo «Ver» no se monta nada de lo que escribe (borrar, foto, ficha de edición). */}
      {!soloLectura && (
        <>
          <AlertDialog open={!!bebidaAEliminar} onOpenChange={(open) => !open && setBebidaAEliminar(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar bebida?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción eliminará permanentemente "{bebidaAEliminar?.nombre}" de la carta. Esta acción no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (bebidaAEliminar) eliminarBebida.mutate(bebidaAEliminar.id);
                    setBebidaAEliminar(null);
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <FotoRapidaCarta
            ref={fotoRapida}
            tipo="bebida"
            bucket="bebidas"
            tabla="Bebidas"
            onGuardada={mostrarFoto}
            guardarUrl={(id, url) => actualizarBebida.mutateAsync({ id, imagen_url: url })}
            quitarFoto={(id) => actualizarBebida.mutateAsync({ id, imagen_url: null })}
          />

          <EditarBebidaModal
            open={!!bebidaAEditar}
            onOpenChange={(open) => {
              if (!open) setBebidaAEditar(null);
            }}
            bebida={bebidaAEditar}
          />
        </>
      )}
    </>
  );
}
