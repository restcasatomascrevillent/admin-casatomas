import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { ImageOff, ImagePlus, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { borrarFotoSiNoSeUsa, type TablaCarta } from "@/lib/storage-carta";
import { useFotoCarta, type TipoFotoCarta } from "./recorte/useRecorteVino";
import { SelectorFotoCarta } from "./recorte/SelectorFotoCarta";
import { rutaEnBucket, subirFotoCarta } from "./subirFotoCarta";
import { noCerrarAlTocarFuera } from "./dialogoCarta";
import { aceptarFoto, avisarFalloSubida } from "@/lib/aceptarFoto";
import { ACCEPT_FOTO } from "@/lib/validarFoto";

export interface ElementoConFoto {
  id: string;
  nombre: string | null;
  imagen_url: string | null;
}

export interface FotoRapidaHandle {
  /** Abre la ventana de la foto de `elemento`: la actual (o «Sin foto») y los botones. */
  abrir: (elemento: ElementoConFoto) => void;
}

interface FotoRapidaCartaProps {
  /** Encuadre de la foto de carta (los cócteles usan «bebida», como en sus formularios). */
  tipo: TipoFotoCarta;
  bucket: "platos" | "bebidas" | "vinos" | "cocteles";
  tabla: TablaCarta;
  /** Guarda `imagen_url` con la mutación del hook (invalida la caché y republica la web). */
  guardarUrl: (id: string, url: string) => Promise<unknown>;
  /**
   * Quita la foto: `imagen_url` a null (y, en platos y vinos, «foto expandida»
   * desactivada: sin foto no hay nada que expandir). Con la mutación del hook.
   */
  quitarFoto: (id: string) => Promise<unknown>;
  /** Se llama con el id cuando la foto ya está guardada (la lista la enseña en la tarjeta). */
  onGuardada?: (id: string) => void;
}

/**
 * «Foto» de la tarjeta: sube o cambia la foto de un plato, bebida, vino o
 * cóctel sin abrir la ficha entera. Mismo proceso que el formulario de edición
 * (recorte automático → fondo de carta o foto original, `subirFotoCarta`,
 * borrado de la foto anterior si nadie más la usa).
 *
 * Al pulsar «Foto» se abre la ventana con la foto actual (o un recuadro de
 * «Sin foto») y debajo dos botones: «Guardar» (activo cuando hay una foto
 * nueva elegida) y «Cambiar foto» («Añadir foto» si aún no tiene ninguna),
 * que abre la galería o la cámara (petición del dueño, 01-11-2026). Si tiene
 * foto, «Eliminar foto» la quita (con confirmación) y borra el fichero de
 * Storage si ninguna otra ficha lo usa.
 *
 * El `<input type="file">` vive FUERA del diálogo y siempre montado; se le hace
 * clic dentro del toque en «Cambiar/Añadir foto» (si no, el móvil no abre el
 * selector). Mientras se elige la foto el diálogo sigue abierto, así que el
 * aviso de versión nueva no recarga la página.
 */
export const FotoRapidaCarta = forwardRef<FotoRapidaHandle, FotoRapidaCartaProps>(function FotoRapidaCarta(
  { tipo, bucket, tabla, guardarUrl, quitarFoto, onGuardada },
  ref,
) {
  const fotoCarta = useFotoCarta(tipo);
  const { limpiar } = fotoCarta;
  const [elemento, setElemento] = useState<ElementoConFoto | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const elegirFoto = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.value = ""; // elegir la misma foto otra vez también dispara `change`
    input.click();
  }, []);

  const cerrar = useCallback(() => {
    setElemento(null);
    setConfirmandoBorrado(false);
    limpiar();
    if (inputRef.current) inputRef.current.value = "";
  }, [limpiar]);

  useImperativeHandle(
    ref,
    () => ({
      abrir: (nuevo) => {
        limpiar();
        setConfirmandoBorrado(false);
        setElemento(nuevo);
      },
    }),
    [limpiar],
  );

  const alElegir = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const archivo = input.files?.[0];
    if (archivo && (await aceptarFoto(archivo, input))) fotoCarta.iniciar(archivo);
  };

  const guardar = async () => {
    if (!elemento || !fotoCarta.original) return;
    setGuardando(true);
    let subida: Awaited<ReturnType<typeof subirFotoCarta>>;
    try {
      // Original intacto + foto de carta `-carta-<ext>.webp` (subirFotoCarta.ts).
      subida = await subirFotoCarta(bucket, elemento.id, {
        original: fotoCarta.original,
        compuesta: fotoCarta.usaCarta ? fotoCarta.compuesta : null,
      });
    } catch (error) {
      console.error("Error subiendo la foto:", error);
      avisarFalloSubida(error, "No se ha podido subir la foto. Comprueba la conexión e inténtalo otra vez.");
      setGuardando(false);
      return;
    }
    try {
      await guardarUrl(elemento.id, subida.url);
      // La foto que deja de usar (p. ej. .jpg → .png no se sobrescribe): se
      // borra después de guardar y solo si ninguna otra ficha la usa.
      const anterior = rutaEnBucket(elemento.imagen_url, bucket);
      if (anterior && !subida.rutas.includes(anterior)) {
        await borrarFotoSiNoSeUsa({ tabla, bucket, ruta: anterior, excluirId: elemento.id });
      }
      onGuardada?.(elemento.id);
      cerrar();
    } catch (error) {
      // El aviso de error ya lo da la mutación del hook.
      console.error("Error guardando la foto:", error);
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async () => {
    if (!elemento?.imagen_url) return;
    setGuardando(true);
    try {
      await quitarFoto(elemento.id);
      const anterior = rutaEnBucket(elemento.imagen_url, bucket);
      if (anterior) await borrarFotoSiNoSeUsa({ tabla, bucket, ruta: anterior, excluirId: elemento.id });
      toast.success("Foto eliminada");
      cerrar();
    } catch (error) {
      // El aviso de error ya lo da la mutación del hook.
      console.error("Error quitando la foto:", error);
    } finally {
      setGuardando(false);
    }
  };

  const nombre = elemento?.nombre?.trim() || "este elemento";
  const fotoActual = elemento?.imagen_url || null;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_FOTO}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="foto-rapida-input"
        onChange={alElegir}
      />
      <Dialog
        open={!!elemento}
        onOpenChange={(abierto) => {
          if (!abierto && !guardando) cerrar();
        }}
      >
        <DialogContent className="max-w-md" onInteractOutside={noCerrarAlTocarFuera}>
          <DialogHeader>
            <DialogTitle>Foto de {nombre}</DialogTitle>
            <DialogDescription>
              {fotoCarta.original
                ? "Elige el fondo o usa la foto original y pulsa «Guardar»."
                : fotoActual
                  ? "Esta es la foto que tiene ahora."
                  : "Todavía no tiene foto."}
            </DialogDescription>
          </DialogHeader>

          {fotoCarta.original ? (
            <SelectorFotoCarta recorte={fotoCarta} alt={`Foto nueva de ${nombre}`} />
          ) : fotoActual ? (
            <div className="relative mx-auto flex aspect-[4/3] w-full max-w-xs items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
              <img src={fotoActual} alt={`Foto actual de ${nombre}`} className="h-full w-full object-contain" />
            </div>
          ) : (
            <div
              role="img"
              aria-label="Sin foto"
              className="relative mx-auto flex aspect-[4/3] w-full max-w-xs flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/40 text-sm text-muted-foreground"
            >
              <ImageOff className="h-10 w-10 opacity-60" aria-hidden="true" />
              Sin foto
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              className="h-11"
              onClick={guardar}
              disabled={!fotoCarta.original || fotoCarta.trabajando || guardando}
            >
              {guardando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : fotoCarta.trabajando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Preparando…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Guardar
                </>
              )}
            </Button>
            <Button type="button" variant="outline" className="h-11" onClick={elegirFoto} disabled={guardando}>
              <ImagePlus className="mr-2 h-4 w-4" />
              {fotoCarta.original || fotoActual ? "Cambiar foto" : "Añadir foto"}
            </Button>
          </div>

          {fotoActual && !fotoCarta.original && (
            confirmandoBorrado ? (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3" role="group" aria-label="Confirmar eliminar foto">
                <p className="text-sm">¿Eliminar la foto? Se quitará de la carta y de la web.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => setConfirmandoBorrado(false)}
                    disabled={guardando}
                  >
                    Cancelar
                  </Button>
                  <Button type="button" variant="destructive" className="h-11" onClick={eliminar} disabled={guardando}>
                    {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Sí, eliminar
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmandoBorrado(true)}
                disabled={guardando}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar foto
              </Button>
            )
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});
