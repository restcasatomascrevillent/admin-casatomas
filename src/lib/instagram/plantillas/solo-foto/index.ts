/**
 * «Solo foto» (ct-solo-foto y tz-solo-foto, 12/11/2026). Pedido del dueño tras
 * revisar el Instagram público de Casa Tomás (@casatomascrevillent): el FEED
 * son solo fotos de platos, SIN texto encima (primeros planos, luz cálida, en
 * vertical 4:5); el texto va en el pie. El diseño con rótulos queda para las
 * stories y para quien lo elija en «Ajustar a mano».
 *
 * Solo post (1080×1350; también cada imagen del carrusel). Sin ningún texto ni
 * logo (sinTexto: no pide titular). Dos casos, según las medidas de la foto
 * (ctx.medidasFoto, del catálogo):
 *  - la foto CUBRE el lienzo ampliando como mucho un 5 % (AMPLIACION_MAXIMA):
 *    se recorta a 1080×1350 (object-fit: cover) centrada en horizontal y en
 *    vertical en `posicionY` % (por defecto 50, como imagen_posicion_y de
 *    Platos);
 *  - NO lo cubre (las de la carta, 1200×900, o una foto pequeña): la foto
 *    ENTERA, centrada, con un margen fino y NUNCA ampliada (como mucho a su
 *    tamaño natural), sobre un fondo del color de la propia foto (la misma
 *    foto muy desenfocada: sin detalle, solo su color).
 * Sin medidas (no está en el catálogo), se recorta como en el primer caso.
 *
 * Valida como «marco» (encaje): vale cualquier foto con el lado largo de
 * 800 px o más (LADO_MINIMO_MARCO); recortar o enmarcar lo decide aquí.
 */
import { AMPLIACION_MAXIMA, escalaParaCubrir } from "../../fotos.js";
import type { MarcaId } from "../../tokens.js";
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";

/** Margen fino (px) alrededor de una foto que no cubre el lienzo. */
export const MARGEN_SOLO_FOTO = 48;

export type ModoSoloFoto = { modo: "cubre" } | { modo: "marco"; ancho: number; alto: number };

/**
 * Cómo va la foto en un lienzo de ancho×alto: recortada («cubre») o entera y
 * sin ampliar dentro del margen («marco», con su tamaño final en px).
 */
export function modoSoloFoto(medidas: { ancho: number; alto: number } | undefined, ancho: number, alto: number, margen = MARGEN_SOLO_FOTO): ModoSoloFoto {
  if (!medidas || !(medidas.ancho > 0) || !(medidas.alto > 0)) return { modo: "cubre" };
  if (escalaParaCubrir(medidas.ancho, medidas.alto, ancho, alto) <= AMPLIACION_MAXIMA) return { modo: "cubre" };
  const escala = Math.min(1, (ancho - 2 * margen) / medidas.ancho, (alto - 2 * margen) / medidas.alto);
  return { modo: "marco", ancho: Math.round(medidas.ancho * escala), alto: Math.round(medidas.alto * escala) };
}

/** posicionY válido (0-100) o 50. */
export function posicionVertical(v: unknown): number {
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
/* Fondo del color de la propia foto: la misma, muy desenfocada y un poco más grande (sin bordes del desenfoque). */
.sf__fondo {
  position: absolute;
  left: -15%;
  top: -15%;
  width: 130%;
  height: 130%;
  display: block;
  object-fit: cover;
  filter: blur(110px) saturate(1.15) brightness(0.96);
}
.sf__marco {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sf__entera {
  display: block;
  flex: none;
  /* Tamaño exacto (atributos width/height) calculado sin ampliar nunca. */
  max-width: none;
  box-shadow:
    0 30px 70px -34px color-mix(in srgb, black 45%, transparent),
    0 8px 22px -12px color-mix(in srgb, black 25%, transparent);
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
      const src = esc(ctx.urlFoto(idFoto));
      const m = modoSoloFoto(ctx.medidasFoto?.(idFoto), ctx.ancho, ctx.alto);
      const cuerpo =
        m.modo === "cubre"
          ? `<img class="sf__foto" src="${src}" alt="" style="object-position: 50% ${posicionVertical(datos.posicionY)}%">`
          : `<img class="sf__fondo" src="${src}" alt="" aria-hidden="true"><div class="sf__marco"><img class="sf__entera sf__foto--entera" src="${src}" alt="" width="${m.ancho}" height="${m.alto}" style="width: ${m.ancho}px; height: ${m.alto}px"></div>`;
      return `<style>${CSS}</style><div class="sf sf--${m.modo}" data-modo="${m.modo}">${cuerpo}</div>`;
    },
  };
}

export const PLANTILLAS_SOLO_FOTO: readonly Plantilla[] = [
  crear(
    "casa-tomas",
    "ct-solo-foto",
    "La foto limpia, sin texto ni logo, como el feed de @casatomascrevillent: recortada a 4:5 si cubre; si no (las de la carta, 1200×900), entera y sin ampliar sobre el color de la propia foto. El texto va en el pie de la publicación.",
  ),
  crear(
    "touza",
    "tz-solo-foto",
    "La foto limpia, sin texto ni logo: recortada a 4:5 si cubre; si no (las de la carta, 1200×900), entera y sin ampliar sobre el color de la propia foto. El texto va en el pie de la publicación.",
  ),
];
