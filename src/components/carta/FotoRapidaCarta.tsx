import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { borrarFotoSiNoSeUsa, type TablaCarta } from "@/lib/storage-carta";
import { useFotoCarta, type TipoFotoCarta } from "./recorte/useRecorteVino";
import { SelectorFotoCarta } from "./recorte/SelectorFotoCarta";
import { rutaEnBucket, subirFotoCarta } from "./subirFotoCarta";
import { noCerrarAlTocarFuera } from "./dialogoCarta";

export interface ElementoConFoto {
  id: string;
  nombre: string | null;
  imagen_url: string | null;
}

export interface FotoRapidaHandle {
  /** Abre el selector de foto/cámara para `elemento` (llamar dentro del clic: el navegador lo exige). */
  abrir: (elemento: ElementoConFoto) => void;
}

interface FotoRapidaCartaProps {
  /** Encuadre de la foto de carta (los cócteles usan «bebida», como en sus formularios). */
  tipo: TipoFotoCarta;
  bucket: "platos" | "bebidas" | "vinos" | "cocteles";
  tabla: TablaCarta;
  /** Guarda `imagen_url` con la mutación del hook (invalida la caché y republica la web). */
  guardarUrl: (id: string, url: string) => Promise<unknown>;
  /** Se llama con el id cuando la foto ya está guardada (la lista la enseña en la tarjeta). */
  onGuardada?: (id: string) => void;
}

/**
 * «Foto» de la tarjeta: sube o cambia la foto de un plato, bebida, vino o
 * cóctel sin abrir la ficha entera. Mismo proceso que el formulario de edición
 * (recorte automático → fondo de carta o foto original, `subirFotoCarta`,
 * borrado de la foto anterior si nadie más la usa).
 *
 * El `<input type="file">` vive FUERA del diálogo y siempre montado: el botón
 * de la tarjeta tiene que abrir el selector en el mismo clic (si no, el móvil
 * no lo abre). El diálogo se abre a la vez, detrás del selector: así, mientras
 * se elige la foto, la página tiene un diálogo abierto y el aviso de versión
 * nueva no la recarga sola. Si se cancela el selector sin elegir nada, se
 * cierra solo.
 */
export const FotoRapidaCarta = forwardRef<FotoRapidaHandle, FotoRapidaCartaProps>(function FotoRapidaCarta(
  { tipo, bucket, tabla, guardarUrl, onGuardada },
  ref,
) {
  const fotoCarta = useFotoCarta(tipo);
  const { limpiar } = fotoCarta;
  const [elemento, setElemento] = useState<ElementoConFoto | null>(null);
  const [guardando, setGuardando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Para el listener nativo de `cancel` (no ve el estado de React al día).
  const hayFotoRef = useRef(false);
  hayFotoRef.current = Boolean(fotoCarta.original);

  const elegirFoto = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.value = ""; // elegir la misma foto otra vez también dispara `change`
    input.click();
  }, []);

  const cerrar = useCallback(() => {
    setElemento(null);
    limpiar();
    if (inputRef.current) inputRef.current.value = "";
  }, [limpiar]);

  useImperativeHandle(
    ref,
    () => ({
      abrir: (nuevo) => {
        limpiar();
        setElemento(nuevo);
        elegirFoto();
      },
    }),
    [limpiar, elegirFoto],
  );

  // Selector cancelado sin elegir foto: fuera el diálogo (Chrome 113+, Safari 16.4+).
  // React no expone `onCancel` en un <input>, así que va con addEventListener.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const alCancelar = () => {
      if (!hayFotoRef.current) cerrar();
    };
    input.addEventListener("cancel", alCancelar);
    return () => input.removeEventListener("cancel", alCancelar);
  }, [cerrar]);

  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    if (archivo) fotoCarta.iniciar(archivo);
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
      toast.error("No se ha podido subir la foto. Comprueba la conexión e inténtalo otra vez.");
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

  const nombre = elemento?.nombre?.trim() || "este elemento";
  const fotoActual = elemento?.imagen_url || null;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
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
                ? "Elige el fondo o usa la foto original y pulsa «Guardar foto»."
                : "Elige una foto de la galería o hazla con la cámara."}
            </DialogDescription>
          </DialogHeader>

          {fotoCarta.original ? (
            <SelectorFotoCarta recorte={fotoCarta} alt={`Foto nueva de ${nombre}`} />
          ) : (
            <button
              type="button"
              onClick={elegirFoto}
              className="relative mx-auto flex aspect-[4/3] w-full max-w-xs items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/40 transition-colors hover:border-muted-foreground/50"
            >
              {fotoActual ? (
                <img src={fotoActual} alt={`Foto actual de ${nombre}`} className="h-full w-full object-contain" />
              ) : (
                <span className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                  <Camera className="h-8 w-8 opacity-60" />
                  Toca para elegir o hacer una foto
                </span>
              )}
            </button>
          )}

          <Button type="button" variant="outline" className="h-11" onClick={elegirFoto} disabled={guardando}>
            <ImagePlus className="mr-2 h-4 w-4" />
            {fotoCarta.original || fotoActual ? "Elegir otra foto" : "Elegir foto"}
          </Button>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-11 px-5" onClick={cerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="h-11 px-5"
              onClick={guardar}
              disabled={!fotoCarta.original || fotoCarta.trabajando || guardando}
            >
              {guardando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : fotoCarta.trabajando ? (
                "Preparando foto…"
              ) : (
                "Guardar foto"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
