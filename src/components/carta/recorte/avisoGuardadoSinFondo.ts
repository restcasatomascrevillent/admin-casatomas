import { toast } from "sonner";
import type { EstadoRecorte } from "./useRecorteVino";

/** Cuánto se queda en pantalla el aviso (ms): es lo único que le dice al usuario qué hacer luego. */
export const MS_AVISO_SIN_FONDO = 12_000;

/**
 * Aviso que se da AL GUARDAR cuando el recorte falló y la ficha se queda con la
 * foto normal (caso del iPhone con el recorte en Replicate sin configurar,
 * 02-11-2026: el vino se guardó sin fondo y solo había una línea gris pequeña
 * dentro del formulario, que se cierra al guardar).
 *
 * Solo avisa si el recorte FALLÓ (`fase: "fallo"`); si el usuario eligió
 * «Usar foto original» a propósito, no hay nada que avisar. Devuelve true si
 * avisó. La foto original queda guardada: el aviso dice cómo ponerle el fondo
 * después («Quitar fondo» en la ficha, botón de BotonCambiarFondo).
 */
export function avisarGuardadoSinFondo(estado: Pick<EstadoRecorte, "fase">): boolean {
  if (estado.fase !== "fallo") return false;
  try {
    toast.warning("Guardado con la foto normal, sin el fondo de carta", {
      description:
        "La foto original está guardada. Para ponerle el fondo, abre la ficha y pulsa «Quitar fondo» (desde un ordenador si en el móvil no funciona).",
      duration: MS_AVISO_SIN_FONDO,
    });
  } catch (e) {
    // Un aviso nunca puede romper el guardado de la ficha, que ya se hizo.
    console.warn("[recorte] no se pudo enseñar el aviso de foto sin fondo", e);
    return false;
  }
  return true;
}
