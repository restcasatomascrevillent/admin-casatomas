/**
 * «Solo foto» (ct-solo-foto y tz-solo-foto, 12/11/2026). Pedido del dueño tras
 * revisar el Instagram público de Casa Tomás (@casatomascrevillent): el FEED
 * son solo fotos de platos, SIN texto encima (primeros planos, luz cálida, en
 * vertical 4:5); el texto va en el pie. El diseño con rótulos queda para las
 * stories y para quien lo elija en «Ajustar a mano».
 *
 * Solo post (1080×1350; también cada imagen del carrusel). Sin ningún texto ni
 * logo (sinTexto: no pide titular). Decisión del dueño (12/11/2026): la foto
 * SIEMPRE se recorta a 4:5 a sangre, como su feed (object-fit: cover), aunque
 * haya que ampliarla; nada de foto entera sobre fondo. Qué parte se ve lo
 * dicen `posicionX` y `posicionY` (0-100 %, por defecto 50: el centro; como
 * imagen_posicion_y de Platos). Las de la carta (1200×900) son apaisadas: el
 * recorte es horizontal y manda `posicionX`.
 *
 * Calidad: si el trozo de la foto que se ve mide menos de RECORTE_MINIMO px de
 * ancho reales (ctx.medidasFoto, del catálogo), la pieza sigue valiendo pero
 * lleva un aviso («la foto es pequeña y puede verse blanda») en data-aviso,
 * que comprobarMaquetacion devuelve en `avisos`.
 *
 * Validación: cualquier foto vale (esquema.ts no mira el tamaño con sinTexto).
 */
import { escalaParaCubrir } from "../../fotos.js";
import type { MarcaId } from "../../tokens.js";
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";

/** Ancho real mínimo (px de la foto) del recorte antes de avisar de que puede verse blanda. */
export const RECORTE_MINIMO = 600;

export const AVISO_FOTO_PEQUENA = "La foto es pequeña y puede verse blanda";

/** Ancho real (px de la foto original) del trozo que se ve al recortarla a ancho×alto, o null sin medidas. */
export function anchoRecorte(medidas: { ancho: number; alto: number } | undefined, ancho: number, alto: number): number | null {
  if (!medidas || !(medidas.ancho > 0) || !(medidas.alto > 0)) return null;
  return Math.round(ancho / escalaParaCubrir(medidas.ancho, medidas.alto, ancho, alto));
}

/** Posición válida (0-100) o 50. */
export function posicionEncuadre(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 50;
}

const CSS = `
.sf {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--color-fondo);
}
.sf__foto {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
`;

function crear(marca: MarcaId, id: string, descripcion: string): Plantilla {
  return {
    id,
    marca,
    nombre: "Solo foto",
    descripcion,
    formatos: ["post"],
    obligatorios: ["foto"],
    admitidos: ["foto"],
    encaje: "marco",
    papel: "foto",
    sinTexto: true,
    html(datos: DatosPieza, ctx: ContextoPlantilla): string {
      const idFoto = datos.foto ?? "";
      const x = posicionEncuadre(datos.posicionX);
      const y = posicionEncuadre(datos.posicionY);
      const recorte = anchoRecorte(ctx.medidasFoto?.(idFoto), ctx.ancho, ctx.alto);
      const aviso =
        recorte !== null && recorte < RECORTE_MINIMO
          ? ` data-aviso="${esc(`${AVISO_FOTO_PEQUENA} (se ven ${recorte} px de ancho; lo bueno es ${RECORTE_MINIMO} o más)`)}"`
          : "";
      return `<style>${CSS}</style><div class="sf"${aviso}><img class="sf__foto" src="${esc(ctx.urlFoto(idFoto))}" alt="" style="object-position: ${x}% ${y}%"></div>`;
    },
  };
}

export const PLANTILLAS_SOLO_FOTO: readonly Plantilla[] = [
  crear(
    "casa-tomas",
    "ct-solo-foto",
    "La foto limpia, sin texto ni logo, recortada a 4:5 a sangre como el feed de @casatomascrevillent; se elige qué parte se ve. El texto va en el pie de la publicación.",
  ),
  crear(
    "touza",
    "tz-solo-foto",
    "La foto limpia, sin texto ni logo, recortada a 4:5 a sangre; se elige qué parte se ve. El texto va en el pie de la publicación.",
  ),
];
