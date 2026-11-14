/**
 * Rótulos de plato de Casa Tomás CALCADOS de las stories de la destacada
 * «Platos» (referencias-actuales/alta/platos-*.jpg, medidas en MEDIDAS.md).
 * Story 1080×1920 a sangre (las medidas son de ahí) y feed 4:5 con la misma
 * letra y la composición recolocada.
 *
 *   ct-rotulo-hilo        nombre en IBM Plex Sans 400 de 47 px, mayúsculas,
 *                         interletrado 0,12 em; debajo, una raya de 4 px y
 *                         7,3 em de largo (forma de T) y un hilo de 4 px que
 *                         baja hasta un punto de 17 px. Llegada ajustable.
 *   ct-rotulo-recuadro    rectángulo blanco de 16 px a 108 px de los bordes;
 *                         nombre en Plex 59 px y subtítulo en Spectral.
 *   ct-rotulo-titular     Anton estrechada al 77 %, crema (#fffff3). Una línea: grande,
 *                         alineada a la derecha y subtítulo en Montserrat
 *                         («ENSALADILLA / de marisco»). Dos líneas o más: a la
 *                         izquierda, subtítulo en cursiva y logo abajo
 *                         («TATAKI DE CHULETA»).
 *   ct-rotulo-manuscrita  «Tarta de queso» en Sacramento entre dos filetes y
 *                         «CON HELADO» en Plex 77 px dentro de una caja de 3 px.
 *
 * Lo único que no es calco: un velo muy suave detrás del texto (que se lea en
 * fotos claras) y que nada de texto pisa los 250 px de arriba de la story.
 */
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";
import { ANTON, CSS_BASE, ESTRECHO_ANTON, MONT, PLEX, SACRAMENTO, SPECTRAL, fotoSangre, fuentes, velo, type Cara } from "./base.js";

/** Logo de la story (PNG 800×550): a escala 0,473 mide como el de las originales (medallón de 122 px). */
export const LOGO = { ancho: 378, desfaseMedallon: 14 } as const;

// ── Hilo ─────────────────────────────────────────────────────────────────────

/** Punto de llegada del hilo por defecto (% del alto): en platos-hilo-1 el punto está a 869/1920. */
export const LLEGADA_HILO = { story: 45.3, post: 52 } as const;
export const LLEGADA_MIN = 32;
export const LLEGADA_MAX = 80;

export interface OpcionesHilo {
  /** Dónde acaba el hilo (centro del punto), en % del alto del lienzo (32–80). */
  llegada?: number;
}

/** Y (px) del centro del punto del hilo, ya acotada. */
export function yLlegada(story: boolean, llegada?: number): number {
  const alto = story ? 1920 : 1350;
  const pct = Math.min(LLEGADA_MAX, Math.max(LLEGADA_MIN, Number.isFinite(llegada) ? (llegada as number) : LLEGADA_HILO[story ? "story" : "post"]));
  return Math.round((alto * pct) / 100);
}

export const CARAS_HILO: readonly Cara[] = ["plex-300"];

/** Tamaño del nombre: 47 px (platos-hilo-1 y 2); el interletrado y la raya van en em. */
const HILO = { cuerpo: 47, tracking: 0.122, lh: 1.18, raya: 7.3, hueco: 0.47 } as const;

export function htmlRotuloHilo(datos: DatosPieza, ctx: ContextoPlantilla, opciones: OpcionesHilo = {}): string {
  const story = datos.formato === "story";
  // Si el nombre no cabe en una línea de 47 px, va en dos de 60 (platos-hilo-3).
  // La raya queda siempre a la misma altura (y = 530 en story, platos-hilo-1).
  const dosLineas = [...datos.titular].length * 0.74 * HILO.cuerpo > 936;
  const cuerpo = dosLineas ? 60 : HILO.cuerpo;
  const lineas = dosLineas ? 2 : 1;
  const raya = story ? 530 : 400;
  const arriba = Math.round(raya - lineas * HILO.lh * cuerpo - (HILO.hueco - 0.18) * cuerpo);
  const fin = yLlegada(story, opciones.llegada);
  const sub = datos.cita ? `<p class="ctsh__sub" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
  return `<style>${fuentes(ctx, CARAS_HILO)}${CSS_BASE}
.ctsh{position:absolute;left:72px;right:72px;display:flex;flex-direction:column;align-items:center;text-align:center;font-family:${PLEX};font-size:${cuerpo}px}
.ctsh__titular{font-weight:300;font-size:1em;line-height:${HILO.lh};letter-spacing:${HILO.tracking}em;padding-left:${HILO.tracking}em;text-transform:uppercase;max-height:calc(${HILO.lh}em * 3 + 2px);text-wrap:balance;overflow-wrap:normal}
.ctsh__sub{margin-top:4px;font-weight:300;font-size:${HILO.cuerpo * 0.62}px;line-height:1.3;letter-spacing:.06em;max-height:calc(1.3em * 2 + 2px);max-width:760px;text-wrap:balance}
.ctsh__raya{flex:0 0 4px;width:${HILO.raya}em;margin-top:${HILO.hueco - 0.18}em;background:#fff}
.ctsh__hilo{flex:1 1 auto;width:4px;min-height:60px;background:#fff}
.ctsh__punto{flex:0 0 17px;width:17px;height:17px;margin-top:-8px;border-radius:50%;background:#fff}
</style>
<div class="cts cts--${story ? "story" : "post"}">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  ${velo("arriba", Math.round(arriba + 260), 22)}
  <div class="ctsh" style="top:${arriba}px;height:${fin + 9 - arriba}px">
    <h1 class="ctsh__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
    ${sub}
    <span class="ctsh__raya" aria-hidden="true"></span>
    <span class="ctsh__hilo" aria-hidden="true"></span>
    <span class="ctsh__punto" aria-hidden="true"></span>
  </div>
</div>`;
}

// ── Recuadro ─────────────────────────────────────────────────────────────────

export const CARAS_RECUADRO: readonly Cara[] = ["plex-300", "spectral"];

function htmlRecuadro(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const story = datos.formato === "story";
  const borde = story ? 108 : 64;
  const sub = datos.cita ? `<p class="ctsr__sub" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
  return `<style>${fuentes(ctx, CARAS_RECUADRO)}${CSS_BASE}
.ctsr__marco{position:absolute;inset:${borde}px;border:16px solid #fff}
.ctsr__textos{position:absolute;top:${story ? 332 : 150}px;left:${borde + 40}px;right:${borde + 40}px;display:flex;flex-direction:column;align-items:center;text-align:center}
.ctsr__titular{font-family:${PLEX};font-weight:300;font-size:58px;line-height:1.18;letter-spacing:.11em;padding-left:.11em;text-transform:uppercase;max-height:calc(1.18em * 2 + 2px);text-wrap:balance;overflow-wrap:normal}
.ctsr__sub{margin-top:4px;font-family:${SPECTRAL};font-weight:500;font-size:36px;line-height:48px;letter-spacing:.09em;max-height:calc(48px * 3 + 2px);max-width:630px}
</style>
<div class="cts cts--${story ? "story" : "post"}">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  ${velo("arriba", story ? 640 : 460, 22)}
  <div class="ctsr__marco" aria-hidden="true"></div>
  <div class="ctsr__textos">
    <h1 class="ctsr__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
    ${sub}
  </div>
</div>`;
}

// ── Titular grande ───────────────────────────────────────────────────────────

export const CARAS_TITULAR: readonly Cara[] = ["anton", "mont-400", "mont-300i"];

/**
 * Cuerpo de un titular que se ajusta: el mayor (entre min y max) con el que la
 * palabra más larga cabe en el ancho y el texto entero no pasa de `lineas`
 * (estimación palabra a palabra con `ratio` = ancho medio de letra en em).
 * Si ni con el mínimo cabe, desborda y el motor da error (nunca se recorta).
 */
export function cuerpoAjustado(texto: string, o: { ancho: number; min: number; max: number; lineas: number; ratio: number }): number {
  const palabras = texto.split(/\s+/).filter(Boolean).map((w) => [...w].length);
  for (let c = o.max; c > o.min; c -= 2) {
    const letra = o.ratio * c;
    let lineas = 1;
    let actual = 0;
    let cabe = true;
    for (const n of palabras) {
      const w = n * letra;
      if (w > o.ancho) cabe = false;
      const con = actual === 0 ? w : actual + letra + w;
      if (con <= o.ancho) actual = con;
      else {
        lineas += 1;
        actual = w;
      }
    }
    if (cabe && lineas <= o.lineas) return c;
  }
  return o.min;
}

/** Anton al 77 % ≈ 0,33 em por letra. Una línea hasta 213 px (ENSALADILLA, mayúsculas de 185 px); si no cabe, hasta 3 líneas de 167 px (TATAKI DE / CHULETA). */
export function cuerpoTitularGrande(titular: string): { cuerpo: number; unaLinea: boolean } {
  const una = cuerpoAjustado(titular, { ancho: 790, min: 150, max: 213, lineas: 1, ratio: 0.335 });
  if ([...titular].length * 0.335 * una <= 790) return { cuerpo: una, unaLinea: true };
  return { cuerpo: cuerpoAjustado(titular, { ancho: 860, min: 96, max: 167, lineas: 3, ratio: 0.335 }), unaLinea: false };
}

function htmlTitular(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const story = datos.formato === "story";
  const { cuerpo, unaLinea } = cuerpoTitularGrande(datos.titular);
  const sub = datos.cita ? `<p class="ctst__sub" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
  // Una línea (ENSALADILLA): a la derecha, borde en x = 963, sin logo (en la original las
  // mayúsculas empiezan en y = 165; aquí bajan hasta la zona segura de 250).
  // Dos o más (TATAKI DE CHULETA): a la izquierda en x = 110, mayúsculas desde y = 309, logo abajo.
  const arriba = unaLinea ? (story ? 250 : 90) : story ? 296 : 100;
  const k = ESTRECHO_ANTON;
  const caja = unaLinea ? "left:96px;right:117px;text-align:right" : "left:104px;right:96px;text-align:left";
  const logo = unaLinea ? "" : `<img class="cts__logo ctst__logo" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">`;
  return `<style>${fuentes(ctx, CARAS_TITULAR)}${CSS_BASE}
.ctst{position:absolute;top:${arriba}px;${caja}}
.ctst__titular{width:calc(100% / ${k});transform:scaleX(${k});transform-origin:${unaLinea ? "right" : "left"} top;${unaLinea ? `margin-left:calc(100% - 100% / ${k});` : ""}font-family:${ANTON};font-weight:400;font-size:${cuerpo}px;line-height:1.04;text-transform:uppercase;color:#fffff3;overflow-wrap:normal;max-height:calc(1.04em * 3 + 2px)}
.ctst__sub{${unaLinea ? `margin-top:-2px;font-family:${MONT};font-weight:400;font-size:70px;line-height:1.1` : `margin-top:28px;padding-left:15px;font-family:${MONT};font-style:italic;font-weight:300;font-size:47px;line-height:45px;max-width:640px`};color:#fffff3;max-height:calc(1.1em * 2 + 4px)}
.ctst__logo{position:absolute;left:50%;top:${story ? 1511 : 1080}px;width:${story ? LOGO.ancho : 300}px;transform:translateX(-50%)}
</style>
<div class="cts cts--${story ? "story" : "post"}">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  ${velo("arriba", story ? 820 : 600, 22)}
  <div class="ctst">
    <h1 class="ctst__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
    ${sub}
  </div>
  ${logo}
</div>`;
}

// ── Manuscrita + caja ────────────────────────────────────────────────────────

export const CARAS_MANUSCRITA: readonly Cara[] = ["sacramento", "plex-300"];

function htmlManuscrita(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const story = datos.formato === "story";
  // Story: la caja va de 465 a 596 (600 × 131, borde 3) y la manuscrita encima, con
  // la línea base hacia y = 432 y los filetes a y = 420 (platos-manuscrita).
  const caja = story ? 465 : 300;
  const cajaTxt = datos.cita ? `<p class="ctsm__caja" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
  // Sacramento con interletrado 0,04 em ≈ 0,38 em por letra; en una línea de 470 px (dos si no cabe).
  const cuerpo = cuerpoAjustado(datos.titular, { ancho: 450, min: 60, max: 92, lineas: 1, ratio: 0.38 });
  return `<style>${fuentes(ctx, CARAS_MANUSCRITA)}${CSS_BASE}
.ctsm__linea{position:absolute;left:240px;right:240px;gap:14px;bottom:${(story ? 1920 : 1350) - caja - 6}px;display:flex;align-items:flex-end;justify-content:space-between}
.ctsm__linea::before,.ctsm__linea::after{content:"";flex:0 0 58px;height:3px;margin-bottom:${Math.round(cuerpo * 0.56)}px;background:#fff}
.ctsm__titular{flex:1 1 auto;min-width:0;font-family:${SACRAMENTO};font-weight:400;font-size:${cuerpo}px;line-height:1.25;letter-spacing:.04em;padding-left:.04em;max-height:calc(1.25em * 2 + 2px);overflow-wrap:normal;text-align:center}
.ctsm__caja{position:absolute;left:240px;right:240px;top:${caja}px;height:131px;border:3px solid #fff;font-family:${PLEX};font-weight:300;font-size:76px;line-height:125px;letter-spacing:.07em;padding-left:.07em;text-align:center;text-transform:uppercase;white-space:nowrap}
</style>
<div class="cts cts--${story ? "story" : "post"}">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  ${velo("arriba", caja + 260, 22)}
  <div class="ctsm__linea"><h1 class="ctsm__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1></div>
  ${cajaTxt}
</div>`;
}

// ── Registro ─────────────────────────────────────────────────────────────────

const comun = {
  marca: "casa-tomas",
  formatos: ["post", "story"],
  obligatorios: ["foto"],
  encaje: "sangre",
} as const;

export const PLANTILLAS_ROTULOS: readonly Plantilla[] = [
  {
    ...comun,
    id: "ct-rotulo-hilo",
    nombre: "Rótulo con hilo",
    descripcion:
      "El rótulo de la destacada «Platos»: foto a sangre, el nombre del plato en mayúsculas espaciadas, una raya debajo y un hilo que baja hasta el plato y acaba en un punto. Subtítulo opcional.",
    papel: "plato",
    admitidos: ["foto", "titular", "cita"],
    limites: { titular: 40, cita: 60 },
    html: (datos, ctx) => htmlRotuloHilo(datos, ctx),
  },
  {
    ...comun,
    id: "ct-rotulo-recuadro",
    nombre: "Rótulo con recuadro",
    descripcion: "Foto a sangre con un rectángulo blanco grueso por dentro; arriba, el nombre del plato en mayúsculas y un subtítulo en letra de imprenta.",
    papel: "plato",
    admitidos: ["foto", "titular", "cita"],
    limites: { titular: 22, cita: 70 },
    html: htmlRecuadro,
  },
  {
    ...comun,
    id: "ct-rotulo-titular",
    nombre: "Rótulo con titular grande",
    descripcion:
      "El nombre del plato en letra condensada gruesa y grande («ENSALADILLA de marisco»); si va en dos líneas, a la izquierda con el subtítulo en cursiva y el logo abajo («TATAKI DE CHULETA»).",
    papel: "portada",
    admitidos: ["foto", "titular", "cita"],
    limites: { titular: 28, cita: 50 },
    html: htmlTitular,
  },
  {
    ...comun,
    id: "ct-rotulo-manuscrita",
    nombre: "Rótulo manuscrito con caja",
    descripcion: "El nombre del plato en letra manuscrita fina entre dos filetes y, debajo, un detalle corto en mayúsculas dentro de una caja con borde («con helado»).",
    papel: "plato",
    admitidos: ["foto", "titular", "cita"],
    limites: { titular: 18, cita: 12 },
    html: htmlManuscrita,
  },
];

export const CARAS_ROTULOS: Record<string, readonly Cara[]> = {
  "ct-rotulo-hilo": CARAS_HILO,
  "ct-rotulo-recuadro": CARAS_RECUADRO,
  "ct-rotulo-titular": CARAS_TITULAR,
  "ct-rotulo-manuscrita": CARAS_MANUSCRITA,
};
