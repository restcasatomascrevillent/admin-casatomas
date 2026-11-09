import { useState } from "react";
import { Eraser, Loader2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { esFotoCarta } from "../rutasFotoCarta";
import { AVISO_SIN_ORIGINAL_FOTO, descargarFotoWeb, obtenerOriginalFoto, type DependenciasOriginalFoto } from "../originalDrive";
import type { FotoCarta } from "./useRecorteVino";
import type { TablaFoto } from "./recorteMovil";

interface Props {
  recorte: FotoCarta;
  /** `imagen_url` guardada (la foto actual de la ficha). */
  url: string | null | undefined;
  /** Tabla e id de la ficha: con ellos se pide el ORIGINAL a Google Drive (platos y vinos). */
  tabla?: TablaFoto;
  id?: string | null;
  /** Se llama al arrancar el recorte (el modal limpia su vista previa). */
  onIniciado?: () => void;
  /** Solo para pruebas. */
  deps?: DependenciasOriginalFoto;
}

/**
 * «Cambiar fondo» (o «Quitar fondo» si la foto aún no tiene el fondo de carta,
 * p. ej. un vino guardado desde el móvil cuando el recorte falló) de una foto
 * ya subida, sin repetir la foto. Desde el 08/11/2026 el ORIGINAL vive solo en
 * Google Drive (originalDrive.ts): se pide a Drive; si no está, el original
 * antiguo del bucket (`<id>.<ext>`, mientras no se haya movido); y si no hay
 * ninguno, la propia foto de la web, avisando. Se recorta con el flujo de
 * useFotoCarta y queda el selector de fondos. Al guardar se sube la nueva
 * compuesta reemplazando la anterior.
 */
export function BotonCambiarFondo({ recorte, url, tabla, id, onIniciado, deps }: Props) {
  const [cargando, setCargando] = useState(false);
  if (!url || recorte.original) return null;
  // Sin fondo de carta todavía: es el botón que arregla un recorte que falló.
  const sinFondo = !esFotoCarta(url);

  const cambiar = async () => {
    setCargando(true);
    try {
      const { original, errorDrive } = await obtenerOriginalFoto(tabla ?? "", id, url, deps);
      const foto = original?.archivo ?? (await descargarFotoWeb(url, deps?.fetch));
      if (!foto) {
        toast.error("No se pudo cargar la foto para cambiar el fondo");
        return;
      }
      // La foto de la web ya con fondo de carta es solo el respaldo: se avisa.
      if (!original && !sinFondo) {
        toast.warning(AVISO_SIN_ORIGINAL_FOTO, {
          description: errorDrive ? `Google Drive: ${errorDrive}` : "Se recorta la foto que se ve en la web; para mejor calidad, vuelve a subir la foto.",
          duration: 8000,
        });
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
