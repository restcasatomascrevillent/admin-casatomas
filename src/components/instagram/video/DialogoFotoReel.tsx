import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { baseFotosPublica, fotoPreparable, type MarcaId } from "@/lib/instagram";
import type { FotoElegida } from "@/lib/instagram/reels";
import type { PeticionFotoReel } from "@/components/instagram/reels";
import { SelectorFoto } from "@/components/marketing/instagram/SelectorFoto";
import { useFotosInstagram } from "@/components/marketing/instagram/useFotosInstagram";
import { textoError } from "@/components/marketing/instagram/api";
import { prepararFoto } from "./useVideoReel";

const BASE_FOTOS = baseFotosPublica(import.meta.env.VITE_SUPABASE_URL ?? "");

interface Props {
  /** La petición del editor (null = cerrado). */
  peticion: PeticionFotoReel | null;
  /** Se llama una vez: con la foto preparada o null si se cancela. */
  onTerminar: (foto: FotoElegida | null) => void;
}

/**
 * Elegir la foto de una escena del reel desde la biblioteca (Drive o carta),
 * con el mismo selector que las imágenes (SelectorFoto, en formato 9:16) y
 * «preparando» la foto (copia tmp/ del cubo vía instagram-drive) para que la
 * vista previa y el render la tengan. Va enganchado a la prop `elegirFoto` de
 * EditorReel / EstudioReel.
 */
export function DialogoFotoReel({ peticion, onTerminar }: Props) {
  const marca = (peticion?.marca ?? "casa-tomas") as MarcaId;
  const [elegida, setElegida] = useState<string>("");
  const [preparando, setPreparando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { catalogo } = useFotosInstagram(marca, "story");
  const abierta = !!peticion;
  const valor = elegida || peticion?.fotoActual || "";

  const cerrar = (foto: FotoElegida | null) => {
    setElegida("");
    setError(null);
    setPreparando(false);
    onTerminar(foto);
  };

  const aceptar = async () => {
    if (!valor) return;
    if (!fotoPreparable(valor)) {
      setError("Elige una foto de Drive o de la carta.");
      return;
    }
    setPreparando(true);
    setError(null);
    try {
      const url = await prepararFoto(qc, marca, valor);
      if (!url) throw new Error("No se pudo preparar la foto");
      const f = catalogo.find((x) => x.id === valor);
      cerrar({ id: valor, url, ancho: f?.ancho || undefined, alto: f?.alto || undefined, descripcion: f?.descripcion || undefined });
    } catch (e) {
      setError(textoError(e));
      setPreparando(false);
    }
  };

  return (
    <Dialog open={abierta} onOpenChange={(o) => !o && !preparando && cerrar(null)}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Foto para «{peticion?.nombre ?? "la escena"}»</DialogTitle>
          <DialogDescription>{peticion?.nota ? `La base pide: ${peticion.nota}.` : "Elige una foto vertical o grande (el reel es 9:16)."}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {abierta && <SelectorFoto marca={marca} formato="story" valor={valor} onCambio={setElegida} baseFotos={BASE_FOTOS} />}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => cerrar(null)} disabled={preparando} className="pointer-coarse:min-h-11">
            Cancelar
          </Button>
          <Button type="button" onClick={aceptar} disabled={!valor || preparando} className="pointer-coarse:min-h-11">
            {preparando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {preparando ? "Preparando…" : "Usar esta foto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
