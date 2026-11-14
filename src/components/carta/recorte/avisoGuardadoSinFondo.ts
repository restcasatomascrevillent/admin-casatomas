import { toast } from "sonner";
import type { EstadoRecorte, FotoCarta } from "./useRecorteVino";
import type { TablaFoto } from "./recorteMovil";
// Import ESTÁTICO (03-11-2026): con `import()` un chunk que no carga (p. ej. tras
// publicar otra versión) dejaba la foto sin fondo y sin ningún aviso.
import { avisarSinRecorte } from "./recorteEnSegundoPlano";
import { esTablaOriginal, guardarOriginalCarta } from "../originalCarta";
import { esOriginalDeDrive } from "../originalDrive";

/** Cuánto se queda en pantalla el aviso (ms): es lo único que le dice al usuario qué hacer luego. */
export const MS_AVISO_SIN_FONDO = 12_000;

/**
 * Aviso que se da AL GUARDAR cuando el recorte del formulario falló y se
 * eligió «Usar foto original» (desde el 13/11/2026 es la única forma de
 * guardar sin fondo: el formulario no deja guardar sin elegirlo).
 *
 * Solo avisa si el recorte FALLÓ (`fase: "fallo"`); si el usuario eligió
 * «Usar foto original» con el recorte bien hecho, no hay nada que avisar.
 * Devuelve true si avisó. El aviso dice cómo ponerle el fondo después
 * («Quitar fondo» en la ficha, botón de BotonCambiarFondo).
 */
export function avisarGuardadoSinFondo(estado: Pick<EstadoRecorte, "fase">): boolean {
  if (estado.fase !== "fallo") return false;
  try {
    toast.warning("Guardado con la foto normal, sin el fondo de carta", {
      description: "La foto original está guardada. Para ponerle el fondo, abre la ficha y pulsa «Quitar fondo».",
      duration: MS_AVISO_SIN_FONDO,
    });
  } catch (e) {
    // Un aviso nunca puede romper el guardado de la ficha, que ya se hizo.
    console.warn("[recorte] no se pudo enseñar el aviso de foto sin fondo", e);
    return false;
  }
  return true;
}

export interface FichaGuardada {
  tabla: TablaFoto;
  id: string;
  nombre?: string | null;
}

/**
 * Llamar justo DESPUÉS de guardar la ficha con su foto (ya subida con
 * subirFotoCarta). El fondo se quita en el formulario (ordenador y móvil);
 * aquí solo queda el caso en que FALLÓ y se eligió «Usar foto original»:
 * aviso de que se guardó la foto normal y cómo ponerle el fondo. (El trabajo
 * «se recortará en un ordenador» se quitó el 13/11/2026: ya no se guarda sola
 * la foto sin recortar.) «Usar foto original» con el recorte bien hecho no
 * avisa. Nunca lanza.
 */
export function trasGuardarFotoCarta(foto: Pick<FotoCarta, "estado" | "original" | "tema" | "eleccion">, ficha: FichaGuardada): void {
  const nombre = ficha.nombre?.trim() || null;
  // Platos y vinos: en Supabase solo va la versión web (el sticker); el
  // ORIGINAL va SOLO a Google Drive (originalCarta.ts). En segundo plano; si
  // falla, la foto de la web ya está guardada y solo se avisa. Si el original
  // ya salió de Drive («Cambiar fondo»), no se vuelve a subir.
  if (foto.original && esTablaOriginal(ficha.tabla) && !esOriginalDeDrive(foto.original)) void guardarOriginalCarta(ficha.tabla, ficha.id, foto.original);
  try {
    if (foto.estado.fase !== "fallo") return;
    avisarGuardadoSinFondo(foto.estado);
  } catch (e) {
    console.warn("[recorte] tras guardar", e);
    avisarSinRecorte({ nombre }, "No se pudo poner el fondo de carta.");
  }
}
