/**
 * Piezas comunes de los estilos de las stories de Casa Tomás (12/11/2026):
 * las fuentes de verdad de cada estilo, autoalojadas en public/instagram/
 * fuentes (OFL, paquetes @fontsource 5.3.0, latin y latin-ext), y el CSS base.
 *
 * Fuentes identificadas comparando las originales a tamaño real
 * (referencias-actuales/alta, medidas en MEDIDAS.md junto a este fichero):
 *   IBM Plex Sans   rótulos con hilo, recuadro, caja «CON HELADO», @ del cliente
 *   Spectral        subtítulo del recuadro («Disfruta de los mejores sabores»)
 *   Sacramento      manuscrita de «Tarta de queso»
 *   Anton al 78,5 % titular grande («ENSALADILLA», «TATAKI DE CHULETA»)
 *   Poppins         título y nombre de la reseña
 *   Montserrat      cuerpo de la reseña, subtítulos del titular, jueves
 *   Amaranth        nombres y motivo de la celebración
 *   DM Sans         «RESERVA MESA», «DESCUBRE TOUZA», «RESERVA TU MESA»
 *   Old Standard TT «Gracias por visitarnos»
 *   Great Vibes     «Tapas y cóctel» del póster del jueves
 * El documento de una pieza de Casa Tomás solo trae Libre Baskerville
 * (tokens.ts → FUENTES): cada plantilla declara las caras que usa. El render
 * del servidor las incluye con public/instagram/** (vercel.json).
 */
import { UNICODE_LATIN, UNICODE_LATIN_EXT } from "../../tokens.js";
import { esc, type ContextoPlantilla } from "../../tipos.js";
import { degradado } from "../comun.js";

interface DefCara {
  familia: string;
  carpeta: string;
  peso: number;
  estilo: "normal" | "italic";
  /** false si la familia no trae latin-ext (Amaranth). */
  ext?: boolean;
}

const CARAS = {
  "plex-300": { familia: "CT Plex", carpeta: "ibm-plex-sans", peso: 300, estilo: "normal" },
  "plex-500": { familia: "CT Plex", carpeta: "ibm-plex-sans", peso: 500, estilo: "normal" },
  "poppins-400": { familia: "CT Poppins", carpeta: "poppins", peso: 400, estilo: "normal" },
  "poppins-500": { familia: "CT Poppins", carpeta: "poppins", peso: 500, estilo: "normal" },
  "mont-300": { familia: "CT Montserrat", carpeta: "montserrat", peso: 300, estilo: "normal" },
  "mont-400": { familia: "CT Montserrat", carpeta: "montserrat", peso: 400, estilo: "normal" },
  "mont-600": { familia: "CT Montserrat", carpeta: "montserrat", peso: 600, estilo: "normal" },
  "mont-300i": { familia: "CT Montserrat", carpeta: "montserrat", peso: 300, estilo: "italic" },
  anton: { familia: "CT Anton", carpeta: "anton", peso: 400, estilo: "normal" },
  sacramento: { familia: "CT Sacramento", carpeta: "sacramento", peso: 400, estilo: "normal" },
  spectral: { familia: "CT Spectral", carpeta: "spectral", peso: 500, estilo: "normal" },
  oldstandard: { familia: "CT Old Standard", carpeta: "old-standard-tt", peso: 400, estilo: "normal" },
  greatvibes: { familia: "CT Great Vibes", carpeta: "great-vibes", peso: 400, estilo: "normal" },
  "dm-300": { familia: "CT DM Sans", carpeta: "dm-sans", peso: 300, estilo: "normal" },
  amaranth: { familia: "CT Amaranth", carpeta: "amaranth", peso: 400, estilo: "normal", ext: false },
} as const satisfies Record<string, DefCara>;

export type Cara = keyof typeof CARAS;

export const PLEX = '"CT Plex", "IBM Plex Sans", sans-serif';
export const POPPINS = '"CT Poppins", "Poppins", sans-serif';
export const MONT = '"CT Montserrat", "Montserrat", sans-serif';
/** Anton estrechada al 78,5 % (scaleX): así miden «ENSALADILLA» y «TATAKI DE CHULETA». */
export const ANTON = '"CT Anton", "Anton", sans-serif';
export const ESTRECHO_ANTON = 0.785;
export const SACRAMENTO = '"CT Sacramento", "Sacramento", cursive';
export const SPECTRAL = '"CT Spectral", "Spectral", serif';
export const OLD_STANDARD = '"CT Old Standard", "Old Standard TT", serif';
export const GREAT_VIBES = '"CT Great Vibes", "Great Vibes", cursive';
export const DM_SANS = '"CT DM Sans", "DM Sans", sans-serif';
export const AMARANTH = '"CT Amaranth", "Amaranth", sans-serif';

/** Caras @font-face que declara una pieza con estas fuentes (latin + latin-ext de cada una, si la hay). */
export function numeroDeCaras(caras: readonly Cara[]): number {
  return caras.reduce((n, c) => n + ((CARAS[c] as DefCara).ext === false ? 1 : 2), 0);
}

/** Bloque @font-face de las caras pedidas (latin y latin-ext, como las de la marca). */
export function fuentes(ctx: ContextoPlantilla, caras: readonly Cara[]): string {
  const url = (fichero: string) => esc(ctx.urlFuente ? ctx.urlFuente(fichero) : `/instagram/fuentes/${fichero}`);
  return caras
    .flatMap((c) => {
      const f: DefCara = CARAS[c];
      return (f.ext === false ? (["latin"] as const) : (["latin", "latin-ext"] as const)).map(
        (r) =>
          `@font-face{font-family:"${f.familia}";font-style:${f.estilo};font-weight:${f.peso};font-display:block;src:url("${url(`${f.carpeta}/${f.carpeta}-${r}-${f.peso}-${f.estilo}.woff2`)}") format("woff2");unicode-range:${r === "latin" ? UNICODE_LATIN : UNICODE_LATIN_EXT}}`,
      );
    })
    .join("\n");
}

/**
 * Velo SOLO donde va el texto, muy suave (las originales no llevan): lo justo
 * para que se lea en fotos claras. Degradado de pizarra oscura, sin colores.
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
