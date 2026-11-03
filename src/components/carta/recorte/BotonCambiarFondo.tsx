import { useState } from "react";
import { Eraser, Loader2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { esFotoCarta, rutaOriginalDesdeCarta } from "../rutasFotoCarta";
import type { FotoCarta } from "./useRecorteVino";

interface Props {
  recorte: FotoCarta;
  /** `imagen_url` guardada (la foto actual de la ficha). */
  url: string | null | undefined;
  /** Se llama al arrancar el recorte (el modal limpia su vista previa). */
  onIniciado?: () => void;
}

async function descargar(url: string): Promise<File | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!blob.type.startsWith("image/")) return null;
    const nombre = decodeURIComponent(url.split("?")[0].split("/").pop() || "foto.jpg");
    return new File([blob], nombre, { type: blob.type });
  } catch {
    return null;
  }
}

/**
 * «Cambiar fondo» (o «Quitar fondo» si la foto aún no tiene el fondo de carta,
 * p. ej. un vino guardado desde el móvil cuando el recorte falló) de una foto
 * ya subida, sin repetir la foto: baja la original
 * (`<id>.<ext>`, deducida del nombre de la `-carta-`; si no existe o la foto
 * es antigua, la propia foto actual), la recorta con el flujo de useFotoCarta
 * y deja el selector de fondos. Al guardar se sube la nueva compuesta
 * reemplazando la anterior.
 */
export function BotonCambiarFondo({ recorte, url, onIniciado }: Props) {
  const [cargando, setCargando] = useState(false);
  if (!url || recorte.original) return null;
  // Sin fondo de carta todavía: es el botón que arregla un recorte que falló.
  const sinFondo = !esFotoCarta(url);

  const cambiar = async () => {
    setCargando(true);
    try {
      const original = rutaOriginalDesdeCarta(url);
      const foto = (original ? await descargar(original) : null) ?? (await descargar(url));
      if (!foto) {
        toast.error("No se pudo cargar la foto para cambiar el fondo");
        return;
      }
      recorte.iniciar(foto);
      onIniciado?.();
    } finally {
      setCargando(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={cambiar}
      disabled={cargando}
      title={sinFondo ? "Recorta la botella y le pone el fondo de carta" : undefined}
    >
      {cargando ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : sinFondo ? (
        <Eraser className="mr-2 h-4 w-4" />
      ) : (
        <Palette className="mr-2 h-4 w-4" />
      )}
      {sinFondo ? "Quitar fondo" : "Cambiar fondo"}
    </Button>
  );
}
