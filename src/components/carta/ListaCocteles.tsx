import { useState, useEffect, useRef } from "react";
import { Wine, Eye, EyeOff } from "lucide-react";
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
import { EditarCoctelModal } from "./EditarCoctelModal";
import { etiquetaAlergeno } from "@/lib/alergenos";
import { AccionesTarjeta, EstadoLectura, EtiquetaCategoria } from "./PartesTarjetaCarta";
import { lineaActivado, lineaCartas } from "./estadoLectura";
import { FotoRapidaCarta, type FotoRapidaHandle } from "./FotoRapidaCarta";
import { TarjetaCartaLateral } from "./TarjetaCartaLateral";

interface ListaCoctelesProps {
  cocteles: Coctel[];
  /**
   * Solo «Ver» en la carta, sin «Editar» (06/11/2026): sin interruptores ni botones
   * (Foto, Editar, Eliminar); la publicación se lee en texto.
   */
  soloLectura?: boolean;
}

export function ListaCocteles({ cocteles, soloLectura = false }: ListaCoctelesProps) {
  const { eliminarCoctel, actualizarCoctel, toggleActivado, toggleRestaurante, toggleTouza } = useCocteles();
  const fotoRapida = useRef<FotoRapidaHandle>(null);
  const [coctelAEliminar, setCoctelAEliminar] = useState<Coctel | null>(null);
  const [coctelAEditar, setCoctelAEditar] = useState<Coctel | null>(null);
  const [fotosOcultas, setFotosOcultas] = useState<Set<string>>(() => new Set(cocteles.map(c => c.id)));

  // Las fotos empiezan ocultas en el panel; solo se ocultan las tarjetas que
  // aparecen por primera vez (antes, cualquier refresco volvía a ocultarlas
  // todas, también la que se acababa de subir con «Foto»).
  const idsVistos = useRef(new Set(cocteles.map((c) => c.id)));
  useEffect(() => {
    const nuevos = cocteles.filter((c) => !idsVistos.current.has(c.id));
    if (nuevos.length === 0) return;
    nuevos.forEach((c) => idsVistos.current.add(c.id));
    setFotosOcultas(prev => {
      const next = new Set(prev);
      nuevos.forEach((c) => next.add(c.id));
      return next;
    });
  }, [cocteles]);

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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cocteles.map((coctel) => {
          const tieneFoto = Boolean(coctel.imagen_url?.trim());
          const fotoOculta = fotosOcultas.has(coctel.id);
          const alergenos = Array.isArray(coctel.alergenos_oficiales) ? (coctel.alergenos_oficiales as string[]) : [];
          return (
            <TarjetaCartaLateral
              key={coctel.id}
              className={cn(!coctel.activado && "opacity-60")}
              foto={tieneFoto && !fotoOculta ? { url: coctel.imagen_url!, alt: coctel.nombre || "Coctel" } : null}
              categoria={<EtiquetaCategoria categoria={coctel.categoria} />}
              titulo={<h3 className="font-semibold text-base leading-tight [overflow-wrap:anywhere]">{coctel.nombre}</h3>}
              controlesFoto={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 disabled:opacity-100"
                  disabled={!tieneFoto}
                  title={!tieneFoto ? "Este cóctel no tiene foto" : fotoOculta ? "Mostrar foto" : "Ocultar foto"}
                  aria-label={!tieneFoto ? "Este cóctel no tiene foto" : fotoOculta ? "Mostrar foto" : "Ocultar foto"}
                  onClick={() => toggleFotoVisible(coctel.id)}
                >
                  {fotoOculta ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4" />}
                </Button>
              }
              controles={
                soloLectura ? (
                  <EstadoLectura lineas={[lineaActivado(coctel.activado), lineaCartas(coctel.restaurante, coctel.touza)]} />
                ) : (
                  /* Visibilidad Web */
                  <VisibilidadToggles
                    restaurante={coctel.restaurante ?? false}
                    touza={coctel.touza ?? false}
                    onRestauranteChange={(checked) => toggleRestaurante.mutate({ id: coctel.id, restaurante: checked })}
                    onTouzaChange={(checked) => toggleTouza.mutate({ id: coctel.id, touza: checked })}
                    isPending={toggleRestaurante.isPending || toggleTouza.isPending}
                    activado={coctel.activado ?? true}
                    onActivadoChange={(checked) =>
                      toggleActivado.mutate({
                        id: coctel.id,
                        activado: checked,
                        nombre: coctel.nombre ?? undefined,
                      })
                    }
                    isActivadoPending={toggleActivado.isPending}
                    compact
                  />
                )
              }
              info={
                <>
                  {/* Alérgenos */}
                  {alergenos.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-2 border-t">
                      {alergenos.map((alergeno) => (
                        <Badge key={alergeno} variant="outline" className="text-[10px] pointer-coarse:text-xs">
                          {etiquetaAlergeno(alergeno)}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Precio */}
                  <div className="flex items-end justify-between pt-2 border-t">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-primary">
                        {coctel.precio_eur ? `${coctel.precio_eur.toFixed(2)}` : "—"}
                      </span>
                      <span className="text-lg font-medium text-primary">€</span>
                    </div>
                  </div>
                </>
              }
              acciones={
                soloLectura ? null : (
                  <AccionesTarjeta
                    nombre={coctel.nombre}
                    tieneFoto={tieneFoto}
                    onFoto={() => fotoRapida.current?.abrir(coctel)}
                    onEditar={() => setCoctelAEditar(coctel)}
                    onEliminar={() => setCoctelAEliminar(coctel)}
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

          <FotoRapidaCarta
            ref={fotoRapida}
            tipo="bebida"
            bucket="cocteles"
            tabla="Cocteles"
            onGuardada={mostrarFoto}
            guardarUrl={(id, url) => actualizarCoctel.mutateAsync({ id, imagen_url: url })}
            quitarFoto={(id) => actualizarCoctel.mutateAsync({ id, imagen_url: null })}
          />

          <EditarCoctelModal
            open={!!coctelAEditar}
            onOpenChange={(open) => {
              if (!open) setCoctelAEditar(null);
            }}
            coctel={coctelAEditar}
          />
        </>
      )}
    </>
  );
}
