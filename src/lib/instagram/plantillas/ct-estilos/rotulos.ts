/**
 * Rótulos de plato de Casa Tomás (12/11/2026): la destacada «Platos» de
 * @casatomascrevillent (referencias-actuales/destacada-platos.jpg), en story
 * 9:16 y feed 4:5, foto a sangre.
 *
 *   ct-rotulo-hilo        el más usado: nombre del plato en mayúsculas finas
 *                         muy espaciadas, arriba, y un hilo vertical fino que
 *                         baja hasta el plato. Subtítulo opcional.
 *   ct-rotulo-recuadro    variante «marco»: rectángulo blanco fino interior con
 *                         el nombre y un subtítulo pequeño (croquetas).
 *   ct-rotulo-titular     variante «titular grande»: palabra gruesa y
 *                         condensada (Oswald 600) en mayúsculas (ENSALADILLA, TATAKI DE CHULETA),
 *                         subtítulo pequeño en cursiva y el logo abajo.
 *   ct-rotulo-manuscrita  variante «manuscrita + caja»: «Tarta de queso» en la
 *                         manuscrita y «CON HELADO» en una caja con borde.
 *
 * Mejora sobre lo de ahora: un velo de pizarra oscura SOLO donde va el texto
 * (degradado suave), para que se lea en cualquier foto sin apagar el plato.
 * No ya cubiertos por ct-marco (foto ENTERA sobre fondo, otro concepto) ni por
 * ct-foto-titular (medallón, velo entero y botón): por eso van aparte.
 *
 * Campos: titular = nombre del plato; cita = subtítulo (opcional).
 * El punto de llegada del hilo se ajusta con `htmlRotuloHilo(..., { llegada })`
 * (en % del alto); el editor aún no tiene el campo (ver el informe).
 */
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";
import { CONDENSADA, CSS_BASE, MANUSCRITA, SANS, fotoSangre, fuentes, velo, zona, type Cara } from "./base.js";

// ── Hilo ─────────────────────────────────────────────────────────────────────

/** Punto de llegada del hilo por defecto (% del alto): justo encima del plato centrado. */
export const LLEGADA_HILO = { story: 50, post: 52 } as const;
/** Límites del punto de llegada (%), para que el hilo nunca se coma el texto ni salga del plato. */
export const LLEGADA_MIN = 32;
export const LLEGADA_MAX = 80;

export interface OpcionesHilo {
  /** Dónde acaba el hilo, en % del alto del lienzo (32–80). Por defecto LLEGADA_HILO. */
  llegada?: number;
}

/** Y (px) donde acaba el hilo, ya acotada. */
export function yLlegada(story: boolean, llegada?: number): number {
  const alto = story ? 1920 : 1350;
  const pct = Math.min(LLEGADA_MAX, Math.max(LLEGADA_MIN, Number.isFinite(llegada) ? (llegada as number) : LLEGADA_HILO[story ? "story" : "post"]));
  return Math.round((alto * pct) / 100);
}

export const CARAS_HILO: readonly Cara[] = ["sans-300"];

export function htmlRotuloHilo(datos: DatosPieza, ctx: ContextoPlantilla, opciones: OpcionesHilo = {}): string {
  const story = datos.formato === "story";
  const z = zona(story);
  const arriba = story ? z.arriba + 60 : 110;
  const fin = yLlegada(story, opciones.llegada);
  const sub = datos.cita ? `<p class="ctsh__sub" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
  return `<style>${fuentes(ctx, CARAS_HILO)}${CSS_BASE}
.ctsh{position:absolute;left:72px;right:72px;display:flex;flex-direction:column;align-items:center;text-align:center}
.ctsh__titular{font-family:${SANS};font-weight:300;font-size:${story ? 46 : 40}px;line-height:1.32;letter-spacing:.34em;padding-left:.34em;text-transform:uppercase;max-height:calc(1.32em * 2 + 2px);text-wrap:balance;overflow-wrap:normal}
.ctsh__sub{margin-top:14px;font-style:italic;font-size:${story ? 30 : 27}px;line-height:1.35;max-height:calc(1.35em * 2 + 2px);max-width:760px;color:rgb(255 255 255 / .9);text-wrap:balance}
.ctsh__hilo{flex:1 1 auto;width:2px;min-height:80px;margin-top:${story ? 36 : 28}px;background:rgb(255 255 255 / .88)}
</style>
<div class="cts cts--${story ? "story" : "post"}">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  ${velo("arriba", Math.round(fin * 0.82), story ? 58 : 54)}
  <div class="ctsh" style="top:${arriba}px;height:${fin - arriba}px">
    <h1 class="ctsh__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
    ${sub}
    <span class="ctsh__hilo" aria-hidden="true"></span>
  </div>
</div>`;
}

// ── Recuadro («marco») ───────────────────────────────────────────────────────

export const CARAS_RECUADRO: readonly Cara[] = ["sans-300", "sans-400"];

function htmlRecuadro(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const story = datos.formato === "story";
  const r = story ? { top: 250, lado: 96, bottom: 250 } : { top: 56, lado: 56, bottom: 56 };
  const sub = datos.cita ? `<p class="ctsr__sub" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
  return `<style>${fuentes(ctx, CARAS_RECUADRO)}${CSS_BASE}
.ctsr__marco{position:absolute;top:${r.top}px;bottom:${r.bottom}px;left:${r.lado}px;right:${r.lado}px;border:3px solid rgb(255 255 255 / .94)}
.ctsr__textos{position:absolute;top:${r.top + (story ? 76 : 64)}px;left:${r.lado + 48}px;right:${r.lado + 48}px;display:flex;flex-direction:column;align-items:center;text-align:center}
.ctsr__titular{font-family:${SANS};font-weight:400;font-size:${story ? 44 : 40}px;line-height:1.3;letter-spacing:.22em;padding-left:.22em;text-transform:uppercase;max-height:calc(1.3em * 2 + 2px);text-wrap:balance;overflow-wrap:normal}
.ctsr__sub{margin-top:14px;font-family:${SANS};font-weight:300;font-size:${story ? 27 : 25}px;line-height:1.4;max-height:calc(1.4em * 2 + 2px);max-width:620px;color:rgb(255 255 255 / .92);text-wrap:balance}
</style>
<div class="cts cts--${story ? "story" : "post"}">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  ${velo("arriba", story ? 720 : 520, 56)}
  <div class="ctsr__marco" aria-hidden="true"></div>
  <div class="ctsr__textos">
    <h1 class="ctsr__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
    ${sub}
  </div>
</div>`;
}

// ── Titular grande ───────────────────────────────────────────────────────────

export const CARAS_TITULAR: readonly Cara[] = ["condensada"];

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

/** Titular grande: Oswald 600 en mayúsculas (≈ 0,56 em por letra), hasta 3 líneas. */
export function cuerpoTitularGrande(titular: string, ancho: number, min: number, max: number): number {
  return cuerpoAjustado(titular, { ancho, min, max, lineas: 3, ratio: 0.56 });
}

function htmlTitular(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const story = datos.formato === "story";
  const ancho = 1080 - 2 * 88;
  const cuerpo = cuerpoTitularGrande(datos.titular, ancho, story ? 84 : 76, story ? 176 : 156);
  const arriba = story ? 310 : 104;
  const sub = datos.cita ? `<p class="ctst__sub" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
  return `<style>${fuentes(ctx, CARAS_TITULAR)}${CSS_BASE}
.ctst{position:absolute;left:88px;right:88px;top:${arriba}px}
.ctst__titular{font-family:${CONDENSADA};font-weight:600;font-size:${cuerpo}px;line-height:1.02;letter-spacing:.005em;text-transform:uppercase;padding-block:.06em;max-height:calc(1.02em * 3 + .12em + 2px);overflow-wrap:normal;text-wrap:balance}
.ctst__sub{margin-top:${story ? 18 : 14}px;font-style:italic;font-size:${story ? 36 : 32}px;line-height:1.3;max-height:calc(1.3em * 2 + 2px);max-width:720px;color:rgb(255 255 255 / .94)}
.ctst__logo{position:absolute;left:50%;bottom:${story ? 286 : 72}px;width:${story ? 220 : 184}px;transform:translateX(-50%)}
</style>
<div class="cts cts--${story ? "story" : "post"}">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  ${velo("arriba", story ? 820 : 620, 60)}
  ${velo("abajo", story ? 560 : 380, 52)}
  <div class="ctst">
    <h1 class="ctst__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
    ${sub}
  </div>
  <img class="cts__logo ctst__logo" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">
</div>`;
}

// ── Manuscrita + caja ────────────────────────────────────────────────────────

export const CARAS_MANUSCRITA: readonly Cara[] = ["manuscrita", "sans-400"];

function htmlManuscrita(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const story = datos.formato === "story";
  const arriba = story ? 320 : 112;
  // Great Vibes ≈ 0,42 em por letra (con los espacios); hasta 2 líneas en 740 px.
  const cuerpo = cuerpoAjustado(datos.titular, { ancho: 740, min: story ? 80 : 72, max: story ? 124 : 110, lineas: 2, ratio: 0.42 });
  const caja = datos.cita ? `<p class="ctsm__caja" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
  return `<style>${fuentes(ctx, CARAS_MANUSCRITA)}${CSS_BASE}
.ctsm{position:absolute;left:72px;right:72px;top:${arriba}px;display:flex;flex-direction:column;align-items:center;text-align:center}
.ctsm__linea{display:flex;align-items:center;justify-content:center;gap:26px;width:100%}
.ctsm__linea::before,.ctsm__linea::after{content:"";flex:0 0 52px;height:2px;background:rgb(255 255 255 / .85)}
.ctsm__titular{font-family:${MANUSCRITA};font-weight:400;font-size:${cuerpo}px;line-height:1.08;padding-block:.14em;max-width:740px;max-height:calc(1.08em * 2 + .28em + 2px);letter-spacing:0;text-wrap:balance;overflow-wrap:normal}
.ctsm__caja{margin-top:${story ? 26 : 20}px;border:2px solid rgb(255 255 255 / .92);padding:14px 30px 12px calc(30px + .26em);font-family:${SANS};font-weight:400;font-size:${story ? 30 : 28}px;line-height:1.2;letter-spacing:.26em;text-transform:uppercase;white-space:nowrap;max-width:100%}
</style>
<div class="cts cts--${story ? "story" : "post"}">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  ${velo("arriba", story ? 820 : 600, 58)}
  <div class="ctsm">
    <div class="ctsm__linea"><h1 class="ctsm__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1></div>
    ${caja}
  </div>
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
      "El rótulo de la destacada «Platos»: foto a sangre, el nombre del plato arriba en mayúsculas finas muy espaciadas y un hilo fino que baja hasta el plato. Subtítulo opcional.",
    papel: "plato",
    admitidos: ["foto", "titular", "cita"],
    limites: { titular: 40, cita: 60 },
    html: (datos, ctx) => htmlRotuloHilo(datos, ctx),
  },
  {
    ...comun,
    id: "ct-rotulo-recuadro",
    nombre: "Rótulo con recuadro",
    descripcion: "Foto a sangre con un rectángulo blanco fino por dentro; arriba, el nombre del plato en mayúsculas y un subtítulo pequeño opcional.",
    papel: "plato",
    admitidos: ["foto", "titular", "cita"],
    limites: { titular: 32, cita: 70 },
    html: htmlRecuadro,
  },
  {
    ...comun,
    id: "ct-rotulo-titular",
    nombre: "Rótulo con titular grande",
    descripcion: "El nombre del plato en grande, grueso y en mayúsculas, alineado a la izquierda; un subtítulo corto en cursiva y el logo abajo.",
    papel: "portada",
    admitidos: ["foto", "titular", "cita"],
    limites: { titular: 28, cita: 40 },
    html: htmlTitular,
  },
  {
    ...comun,
    id: "ct-rotulo-manuscrita",
    nombre: "Rótulo manuscrito con caja",
    descripcion: "El nombre del plato en letra manuscrita entre dos filetes y, debajo, un detalle corto en mayúsculas dentro de una caja con borde («con helado»).",
    papel: "plato",
    admitidos: ["foto", "titular", "cita"],
    limites: { titular: 26, cita: 22 },
    html: htmlManuscrita,
  },
];

export const CARAS_ROTULOS: Record<string, readonly Cara[]> = {
  "ct-rotulo-hilo": CARAS_HILO,
  "ct-rotulo-recuadro": CARAS_RECUADRO,
  "ct-rotulo-titular": CARAS_TITULAR,
  "ct-rotulo-manuscrita": CARAS_MANUSCRITA,
};
