import { toast } from "sonner";
import { rutasSubida } from "../subirFotoCarta";
import type { EstadoRecorte, FotoCarta } from "./useRecorteVino";
import type { TablaFoto } from "./recorteMovil";
// Import ESTÁTICO (03-11-2026): con `import()` un chunk que no carga (p. ej. tras
// publicar otra versión) dejaba el móvil sin recortar y sin ningún aviso.
import { avisarSinRecorte, noRecortar, recortarEnMovil } from "./recorteEnSegundoPlano";
import { diag } from "./diagnostico";

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
 * esperar) el recorte en el servidor (recortarEnMovil), que enseña su
 * progreso y, si falla, avisa con el motivo y deja un trabajo para un
 * ordenador. Nunca lanza y nunca se calla: el único caso sin aviso es
 * «Usar foto original», elegido a propósito.
 */
export function trasGuardarFotoCarta(foto: Pick<FotoCarta, "estado" | "original" | "tema" | "eleccion">, ficha: FichaGuardada): void {
  const nombre = ficha.nombre?.trim() || null;
  diag("tras guardar", { tabla: ficha.tabla, id: ficha.id, fase: foto.estado.fase, eleccion: foto.eleccion, original: foto.original ?? null, tema: foto.tema });
  try {
    if (foto.estado.fase !== "diferido") {
      avisarGuardadoSinFondo(foto.estado);
      return;
    }
    if (foto.eleccion === "original") return; // «Usar foto original»: se guarda tal cual, a propósito.
    if (!foto.original) {
      console.warn("[recorte] tras guardar: sin foto original que recortar", ficha);
      avisarSinRecorte({ nombre }, "No se encontró la foto para ponerle el fondo.");
      return;
    }
    const datos = {
      tabla: ficha.tabla,
      registroId: ficha.id,
      nombre,
      rutaOriginal: rutasSubida(ficha.id, foto.original, null).original,
      tema: foto.tema,
    };
    recortarEnMovil(datos, foto.original).catch((e) => {
      // recortarEnMovil no lanza; por si acaso, que nunca quede en silencio.
      console.warn("[recorte] tras guardar", e);
      void noRecortar(datos, "No se pudo poner el fondo de carta.");
    });
  } catch (e) {
    console.warn("[recorte] tras guardar", e);
    avisarSinRecorte({ nombre }, "No se pudo poner el fondo de carta.");
  }
}
