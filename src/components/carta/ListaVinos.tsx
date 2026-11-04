import { useState, useEffect, useRef } from "react";
import { Award, Wine, Eye, EyeOff, Move, Info, MapPinOff } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VisibilidadToggles } from "./VisibilidadToggles";
import { EditarVinoModal } from "./EditarVinoModal";
import { ImagePositionSelector } from "../gestion-web/ImagePositionSelector";
import { AccionesTarjeta, EtiquetaCategoria } from "./PartesTarjetaCarta";
import { FotoRapidaCarta, type FotoRapidaHandle } from "./FotoRapidaCarta";
import { TarjetaCartaLateral } from "./TarjetaCartaLateral";
import { cartasVino, EXPLICACION_CARTAS_VINO, textoPublicacionVino, vinoPublicado } from "./publicacionVino";
import { avisoTarjetaSinOrigen, mensajeFaltaOrigen, origenVinoClaro } from "@/lib/origen-vino";
import { ETIQUETA_ORIGEN_POR_CONFIRMAR } from "@/lib/tipos-vino";

// Aspect ratio de la tarjeta (ancho/alto) para el modo colapsado h-40
const CARTA_CARD_ASPECT_RATIO = 300 / 160;

interface ListaVinosProps {
  vinos: Vino[];
}

/**
 * Vino sin origen claro (sin país o región, o con la categoría «… — ORIGEN
 * PENDIENTE»): no se puede publicar hasta completarlo (04/11/2026).
 */
function EtiquetaOrigenPorConfirmar({ titulo }: { titulo: string }) {
  return (
    <Badge
      variant="outline"
      title={titulo}
      className="max-w-full gap-1 rounded-md border-amber-500/60 bg-amber-50 px-1.5 py-0 text-[11px] pointer-coarse:text-xs font-semibold leading-5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    >
      <MapPinOff className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{ETIQUETA_ORIGEN_POR_CONFIRMAR}</span>
    </Badge>
  );
}

export function ListaVinos({ vinos }: ListaVinosProps) {
  const {
    eliminarVino,
    toggleExpanded,
    toggleRestaurante,
    toggleTouza,
    actualizarVino,
  } = useVinos();
  const [vinoAEditar, setVinoAEditar] = useState<Vino | null>(null);
  const [vinoAEliminar, setVinoAEliminar] = useState<Vino | null>(null);
  const fotoRapida = useRef<FotoRapidaHandle>(null);
  const [fotoAVisualizar, setFotoAVisualizar] = useState<{ url: string; nombre: string } | null>(null);
  const [fotosOcultas, setFotosOcultas] = useState<Set<string>>(() => new Set(vinos.map(v => v.id)));
  const [posicionVino, setPosicionVino] = useState<Vino | null>(null);

  // Las fotos empiezan ocultas en el panel; solo se ocultan las tarjetas que
  // aparecen por primera vez (antes, cualquier refresco volvía a ocultarlas
  // todas, también la que se acababa de subir con «Foto»).
  const idsVistos = useRef(new Set(vinos.map((v) => v.id)));
  useEffect(() => {
    const nuevos = vinos.filter((v) => !idsVistos.current.has(v.id));
    if (nuevos.length === 0) return;
    nuevos.forEach((v) => idsVistos.current.add(v.id));
    setFotosOcultas(prev => {
      const next = new Set(prev);
      nuevos.forEach((v) => next.add(v.id));
      return next;
    });
  }, [vinos]);

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
      {/* Qué hace cada interruptor (04/11/2026, dueño: «pon una explicación breve»). */}
      <p className="mb-3 flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{EXPLICACION_CARTAS_VINO}</span>
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {vinos.map((vino) => {
          const tieneFoto = Boolean(vino.imagen_url?.trim());
          const fotoOculta = fotosOcultas.has(vino.id);
          const nombre = vino.nombre || "Vino";
          const alergenos = parseAlergenos(vino.alergenos_oficiales);
          const cartas = cartasVino(vino);
          const publicado = vinoPublicado(cartas);
          const origenClaro = origenVinoClaro(vino);
          const faltaOrigen = mensajeFaltaOrigen(vino);
          return (
            <TarjetaCartaLateral
              key={vino.id}
              // Sin origen claro no se atenúa: el aviso ámbar tiene que leerse bien.
              className={cn(!publicado && origenClaro && "opacity-60", !origenClaro && "border-amber-500/60")}
              foto={
                tieneFoto && !fotoOculta
                  ? {
                      url: vino.imagen_url!,
                      alt: nombre,
                      onAbrir: () => setFotoAVisualizar({ url: vino.imagen_url!, nombre }),
                    }
                  : null
              }
              categoria={
                origenClaro ? (
                  <EtiquetaCategoria categoria={vino.categoria} />
                ) : (
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <EtiquetaOrigenPorConfirmar titulo={faltaOrigen} />
                    <EtiquetaCategoria categoria={vino.categoria} />
                  </div>
                )
              }
              titulo={<h3 className="font-semibold text-base leading-tight [overflow-wrap:anywhere]">{vino.nombre}</h3>}
              controlesFoto={
                <>
                  {tieneFoto && (
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
                    disabled={!tieneFoto}
                    title={!tieneFoto ? "Este vino no tiene foto" : fotoOculta ? "Mostrar foto" : "Ocultar foto"}
                    aria-label={!tieneFoto ? "Este vino no tiene foto" : fotoOculta ? "Mostrar foto" : "Ocultar foto"}
                    onClick={() => toggleFotoVisible(vino.id)}
                  >
                    {fotoOculta ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </>
              }
              controles={
                <>
                  {/* Publicación: un interruptor por carta; sin origen claro no se enciende. */}
                  <VisibilidadToggles
                    restaurante={cartas.restaurante}
                    touza={cartas.touza}
                    onRestauranteChange={(checked) =>
                      toggleRestaurante.mutate({ id: vino.id, restaurante: checked, touza: cartas.touza })
                    }
                    onTouzaChange={(checked) =>
                      toggleTouza.mutate({ id: vino.id, touza: checked, restaurante: cartas.restaurante })
                    }
                    isPending={toggleRestaurante.isPending || toggleTouza.isPending}
                    bloquearEncender={!origenClaro}
                    nota={
                      origenClaro ? (
                        <span className={publicado ? "text-muted-foreground" : "font-medium text-destructive"}>
                          {textoPublicacionVino(cartas)}
                        </span>
                      ) : (
                        <span className="font-medium text-amber-800 dark:text-amber-300">
                          {publicado && `${textoPublicacionVino(cartas)} `}
                          {avisoTarjetaSinOrigen(vino)}
                        </span>
                      )
                    }
                    compact
                  />
                  <FotoExpandidaToggle
                    imagenUrl={vino.imagen_url}
                    nombre={nombre}
                    expanded={vino.expanded}
                    isPending={toggleExpanded.isPending}
                    onChange={(checked) => handleToggleExpanded(vino, checked)}
                  />
                </>
              }
              info={
                <>
                  {vino.descripcion && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{vino.descripcion}</p>
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

                  {/* Precio, y la copa y la puntuación Parker si las tiene (04/11/2026) */}
                  <div className="flex flex-wrap items-end justify-between gap-2 pt-2 border-t">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-primary">
                        {vino.precio_eur ? `${vino.precio_eur.toFixed(2)}` : "—"}
                      </span>
                      <span className="text-lg font-medium text-primary">€</span>
                    </div>
                    {(vino.copeo || vino.puntuacion_parker) && (
                      <div className="flex flex-wrap items-center gap-1">
                        {vino.copeo && (
                          <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-xs" title="Se sirve por copas">
                            <Wine className="h-3 w-3" aria-hidden="true" />
                            {vino.precio_copa_eur ? `Copa ${vino.precio_copa_eur.toFixed(2)} €` : "Copa"}
                          </Badge>
                        )}
                        {vino.puntuacion_parker ? (
                          <Badge
                            variant="outline"
                            className="gap-1 px-1.5 py-0 text-xs"
                            title={`Puntuación Parker${vino.puntuacion_parker_anada ? ` (añada ${vino.puntuacion_parker_anada})` : ""}`}
                          >
                            <Award className="h-3 w-3" aria-hidden="true" />
                            {vino.puntuacion_parker} RP
                          </Badge>
                        ) : null}
                      </div>
                    )}
                  </div>
                </>
              }
              infoExtra={
                <>
                  {alergenos.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-2 border-t">
                      {alergenos.map((alergeno) => (
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
                </>
              }
              acciones={
                <AccionesTarjeta
                  nombre={vino.nombre}
                  tieneFoto={tieneFoto}
                  onFoto={() => fotoRapida.current?.abrir(vino)}
                  onEditar={() => setVinoAEditar(vino)}
                  onEliminar={() => setVinoAEliminar(vino)}
                />
              }
            />
          );
        })}
      </div>

      <AlertDialog open={!!vinoAEliminar} onOpenChange={(open) => !open && setVinoAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar vino?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente "{vinoAEliminar?.nombre}" de la carta. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (vinoAEliminar) eliminarVino.mutate(vinoAEliminar.id);
                setVinoAEliminar(null);
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
        tipo="vino"
        bucket="vinos"
        tabla="Vinos"
        onGuardada={mostrarFoto}
        guardarUrl={(id, url) => actualizarVino.mutateAsync({ id, imagen_url: url })}
        quitarFoto={(id) => actualizarVino.mutateAsync({ id, imagen_url: null, expanded: false })}
      />

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
