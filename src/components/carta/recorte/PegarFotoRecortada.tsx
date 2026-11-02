import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { recorteNavegadorSeguro } from "./quitarFondoNavegador";
import { dispositivoNoRecorta } from "./recorteMovil";
import { AVISO_SIN_FOTO, AVISO_SIN_PERMISO, TRUCO_IPHONE, esDispositivoIOS, fotoDeEventoPegar, leerFotoPortapapeles } from "./portapapelesFoto";

/**
 * «Pegar foto recortada» (decisión del dueño, 02-11-2026): en el iPhone, en
 * Fotos, mantener pulsado el plato → «Copiar» deja en el portapapeles el
 * plato SIN fondo (PNG con transparencia). Este botón lo lee con
 * navigator.clipboard.read() (Safari lo permite dentro del toque; enseña un
 * globo «Pegar» que hay que tocar) y además escucha el evento `paste`
 * (Ctrl+V / Cmd+V en el ordenador). La foto pasa por el mismo camino que una
 * elegida (`onFoto`): si trae transparencia, no se pasa el modelo.
 *
 * Se elige el portapapeles y no la fototeca porque, al elegir de la fototeca
 * con <input type="file">, Safari pasa la foto a JPEG y se pierde el alfa.
 */

interface Props {
  /** La foto pegada (pasa por el mismo camino que una elegida). */
  onFoto: (foto: File) => void;
  className?: string;
  disabled?: boolean;
}

export function PegarFotoRecortada({ onFoto, className, disabled }: Props) {
  const [leyendo, setLeyendo] = useState(false);
  const onFotoRef = useRef(onFoto);
  onFotoRef.current = onFoto;
  const [{ movil, ios, marcado, puedeLeer }] = useState(() => ({
    movil: !recorteNavegadorSeguro(),
    ios: esDispositivoIOS(),
    marcado: dispositivoNoRecorta() !== null,
    puedeLeer: typeof navigator !== "undefined" && typeof navigator.clipboard?.read === "function",
  }));

  // Ctrl+V / Cmd+V (y «Pegar» del menú) mientras el formulario está abierto.
  useEffect(() => {
    if (disabled) return;
    const alPegar = (e: ClipboardEvent) => {
      const foto = fotoDeEventoPegar(e);
      if (!foto) return; // texto: que se pegue donde toque
      e.preventDefault();
      onFotoRef.current(foto);
    };
    document.addEventListener("paste", alPegar);
    return () => document.removeEventListener("paste", alPegar);
  }, [disabled]);

  const pegar = async () => {
    setLeyendo(true);
    try {
      // Sin nada antes de read(): Safari solo lo permite dentro del toque.
      const foto = await leerFotoPortapapeles();
      if (foto) onFotoRef.current(foto);
      else toast.info(AVISO_SIN_FOTO, { duration: 7000, id: "pegar-foto" });
    } catch (e) {
      console.warn("[pegar-foto] no se pudo leer el portapapeles", e);
      toast.error(AVISO_SIN_PERMISO, { duration: 7000, id: "pegar-foto" });
    } finally {
      setLeyendo(false);
    }
  };

  if (!puedeLeer && !ios) return null;

  return (
    <div className={cn("space-y-1", className)} data-testid="pegar-foto-recortada">
      {puedeLeer && (
        <Button
          type="button"
          variant={movil ? "outline" : "ghost"}
          size="sm"
          className={cn(movil ? "h-10" : "h-8 px-2 text-xs text-muted-foreground")}
          onClick={() => void pegar()}
          disabled={disabled || leyendo}
          title={movil ? undefined : "También puedes pegar con Ctrl+V"}
        >
          {leyendo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ClipboardPaste className="mr-1.5 h-4 w-4" />}
          {movil ? "Pegar foto recortada" : "Pegar foto (Ctrl+V)"}
        </Button>
      )}
      {ios && (
        <p
          className={cn(
            "text-xs",
            marcado ? "rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" : "text-muted-foreground",
          )}
          data-testid="truco-iphone"
        >
          {TRUCO_IPHONE}
        </p>
      )}
    </div>
  );
}
