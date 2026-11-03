import { toast } from "sonner";
import { rutasSubida } from "../subirFotoCarta";
import type { EstadoRecorte, FotoCarta } from "./useRecorteVino";
import { dispositivoNoRecorta, type TablaFoto } from "./recorteMovil";

/** Cuánto se queda en pantalla el aviso (ms): es lo único que le dice al usuario qué hacer luego. */
export const MS_AVISO_SIN_FONDO = 12_000;

/**
 * Aviso que se da AL GUARDAR cuando el recorte del formulario (ordenador)
 * falló y la ficha se queda con la foto normal.
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
 * subirFotoCarta). En el ordenador solo avisa si el recorte falló. En el
 * móvil la ficha ya tiene la foto ORIGINAL guardada: aquí se lanza (sin
 * esperar) el recorte en el navegador del móvil o, si este móvil no puede,
 * se avisa de que se queda la foto normal. Nunca lanza.
 */
export function trasGuardarFotoCarta(foto: Pick<FotoCarta, "estado" | "original" | "tema" | "recortarTrasGuardar">, ficha: FichaGuardada): void {
  try {
    if (foto.estado.fase !== "diferido") {
      avisarGuardadoSinFondo(foto.estado);
      return;
    }
    if (!foto.recortarTrasGuardar || !foto.original) return;
    const datos = {
      tabla: ficha.tabla,
      registroId: ficha.id,
      nombre: ficha.nombre?.trim() || null,
      rutaOriginal: rutasSubida(ficha.id, foto.original, null).original,
      tema: foto.tema,
    };
    const original = foto.original;
    const destino = foto.estado.destino;
    void import("./recorteEnSegundoPlano").then(async (m) => {
      if (destino === "movil") await m.recortarEnMovil(datos, original);
      else {
        const marca = dispositivoNoRecorta();
        await m.noRecortar(datos, `Este móvil no recorta fotos en el navegador${marca?.motivo ? ` (${marca.motivo})` : ""}.`);
      }
    });
  } catch (e) {
    console.warn("[recorte] tras guardar", e);
  }
}
