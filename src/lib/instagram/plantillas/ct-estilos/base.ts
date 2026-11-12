/**
 * Piezas comunes de los estilos de las stories de Casa Tomás (12/11/2026):
 * fuentes extra (Montserrat y la cursiva de Cormorant, que ya están en
 * public/instagram/fuentes), velos locales y el CSS base.
 *
 * Por qué fuentes extra: lo que publican hoy (referencias-actuales/
 * CATALOGO-ESTILOS.md) va en mayúsculas finas de palo seco muy espaciadas
 * (Montserrat/Poppins) con una manuscrita como acento. El documento de una
 * pieza de Casa Tomás solo trae Libre Baskerville (tokens.ts → FUENTES), así
 * que cada plantilla declara las caras que usa, como ct-tapas-clasica. La
 * «manuscrita» es la cursiva de Cormorant Garamond: el repo no tiene una de
 * rasgo caligráfico (ver el informe del 12/11/2026).
 */
import { UNICODE_LATIN, UNICODE_LATIN_EXT } from "../../tokens.js";
import { esc, type ContextoPlantilla } from "../../tipos.js";
import { degradado } from "../comun.js";

export type Cara = "sans-300" | "sans-400" | "sans-500" | "sans-600" | "manuscrita";

const FICHEROS: Record<Cara, { familia: string; peso: number; estilo: "normal" | "italic"; ruta: (r: string) => string }> = {
  "sans-300": { familia: "CT Estilos Sans", peso: 300, estilo: "normal", ruta: (r) => `montserrat/montserrat-${r}-300-normal.woff2` },
  "sans-400": { familia: "CT Estilos Sans", peso: 400, estilo: "normal", ruta: (r) => `montserrat/montserrat-${r}-400-normal.woff2` },
  "sans-500": { familia: "CT Estilos Sans", peso: 500, estilo: "normal", ruta: (r) => `montserrat/montserrat-${r}-500-normal.woff2` },
  "sans-600": { familia: "CT Estilos Sans", peso: 600, estilo: "normal", ruta: (r) => `montserrat/montserrat-${r}-600-normal.woff2` },
  manuscrita: { familia: "CT Estilos Manuscrita", peso: 400, estilo: "italic", ruta: (r) => `cormorant-garamond/cormorant-garamond-${r}-400-italic.woff2` },
};

/** Palo seco (Montserrat, la de las stories de ahora). */
export const SANS = '"CT Estilos Sans", "Montserrat", sans-serif';
/** La manuscrita de acento (cursiva de Cormorant Garamond). Una sola por pieza. */
export const MANUSCRITA = '"CT Estilos Manuscrita", "Cormorant Garamond", serif';

/** Caras @font-face que declara una pieza con estas fuentes (latin + latin-ext de cada una). */
export function numeroDeCaras(caras: readonly Cara[]): number {
  return caras.length * 2;
}

/** Bloque @font-face de las caras pedidas (latin y latin-ext, como las de la marca). */
export function fuentes(ctx: ContextoPlantilla, caras: readonly Cara[]): string {
  const url = (fichero: string) => esc(ctx.urlFuente ? ctx.urlFuente(fichero) : `/instagram/fuentes/${fichero}`);
  return caras
    .flatMap((c) => {
      const f = FICHEROS[c];
      return (["latin", "latin-ext"] as const).map(
        (r) =>
          `@font-face{font-family:"${f.familia}";font-style:${f.estilo};font-weight:${f.peso};font-display:block;src:url("${url(f.ruta(r))}") format("woff2");unicode-range:${r === "latin" ? UNICODE_LATIN : UNICODE_LATIN_EXT}}`,
      );
    })
    .join("\n");
}

/**
 * Velo SOLO donde va el texto (la mejora pedida: que se lea en cualquier foto
 * sin apagar el plato). Degradado suave de pizarra oscura, sin colores.
 * `desde` = "arriba" | "abajo"; `alto` en px; `alfa` en %.
 */
export function velo(desde: "arriba" | "abajo", alto: number, alfa: number): string {
  const lado = desde === "arriba" ? "top:0" : "bottom:0";
  const dir = desde === "arriba" ? "to bottom" : "to top";
  return `<div class="cts__velo" aria-hidden="true" style="${lado};height:${alto}px;background:${degradado("--color-pizarra-oscura", alfa, dir)}"></div>`;
}

/** Foto a sangre (object-fit: cover). */
export function fotoSangre(url: string, posicion = "50% 50%"): string {
  return `<img class="cts__foto" src="${esc(url)}" alt="" style="object-position:${posicion}">`;
}

/** La misma foto, desenfocada y oscurecida, de fondo (vale cualquier foto: se amplía sin que se note). */
export function fondoDesenfocado(url: string, oscuro = 0.5): string {
  return `<img class="cts__fondo" src="${esc(url)}" alt=""><div class="cts__velo cts__velo--entero" aria-hidden="true" style="background:color-mix(in srgb, var(--color-pizarra-oscura) ${Math.round(oscuro * 100)}%, transparent)"></div>`;
}

/** Desplazamiento para centrar un texto con letter-spacing (el espacio del final descentra). */
export const compensar = (em: number) => `padding-left:${em}em;`;

export const CSS_BASE = `
.cts{position:absolute;inset:0;overflow:hidden;color:var(--color-blanco);font-family:var(--fuente-texto);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;font-kerning:normal}
.cts *{box-sizing:border-box}
/* Sin especificidad (:where): los margin-top de cada plantilla mandan. */
:where(.cts) h1,:where(.cts) h2,:where(.cts) p{margin:0;font-weight:inherit}
.cts__foto{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cts__fondo{position:absolute;inset:-60px;width:calc(100% + 120px);height:calc(100% + 120px);object-fit:cover;filter:blur(22px) saturate(.85)}
.cts__velo{position:absolute;left:0;right:0;pointer-events:none}
.cts__velo--entero{top:0;bottom:0}
.cts__logo{display:block}
`;

/** Medidas útiles por formato: arriba/abajo (zona segura de story o margen en post). */
export function zona(story: boolean): { arriba: number; abajo: number; alto: number } {
  return story ? { arriba: 250, abajo: 1920 - 250, alto: 1920 } : { arriba: 72, abajo: 1350 - 72, alto: 1350 };
}
