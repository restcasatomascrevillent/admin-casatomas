/**
 * Reseña «Lo que dicen nuestros clientes» CALCADA de las stories de la
 * destacada «Opináis» (referencias-actuales/alta/opinais-1.jpg y -2, medidas
 * en MEDIDAS.md): fondo #363f46 liso, logo arriba (medallón de 122 px en
 * y = 234), título en Poppins a la izquierda (x = 120) con unas comillas «99»
 * enormes en oro al 21 % ENCIMA, el nombre en Poppins 500 con una regla de
 * 3 × 228 px, la reseña en Montserrat centrada y 5 estrellas oro (#b3aa7b) en
 * un bocadillo de 292 × 106 px con el rabito abajo a la derecha.
 *
 *   ct-resena        fondo liso.
 *   ct-resena-foto   fondo con una foto de plato desenfocada y oscurecida.
 *
 * Lo único que no es calco: la reseña baja de cuerpo (de 38 a 24 px) si es
 * muy larga; si ni con 24 px cabe, la caja desborda y el motor da error.
 *
 * Campos: titular = el título (si no llega, «Lo que dicen nuestros
 * clientes»); antetitulo = nombre del cliente; cita = la reseña (obligatoria).
 */
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";
import { medidasLista } from "../ct-tapas/index.js";
import { CSS_BASE, MONT, POPPINS, fondoDesenfocado, fuentes, type Cara } from "./base.js";
import { LOGO } from "./rotulos.js";

export const TITULO_RESENA = "Lo que dicen nuestros clientes";
export const CARAS_RESENA: readonly Cara[] = ["poppins-400", "poppins-500", "mont-300"];
/** Caracteres máximos de la reseña (las de la captura van de 150 a 480). */
export const MAX_RESENA = 560;
const ORO_RESENA = "#b3aa7b";

/** Caja de la reseña por formato (px): en story, de y = 1032 hasta 1552 como mucho. */
export const CAJA_RESENA = { story: { ancho: 740, alto: 520 }, post: { ancho: 800, alto: 420 } } as const;

/** Cuerpo de la reseña: 38 px (el de las originales) y menos solo si no cabe. */
export function cuerpoResena(texto: string, story: boolean): { cuerpo: number; cabe: boolean } {
  const caja = CAJA_RESENA[story ? "story" : "post"];
  // Como en las originales (opinais-1 y -2): 38 px; menos solo si no cabe.
  const max = 38;
  const m = medidasLista([texto], { ancho: caja.ancho, alto: caja.alto, ratio: 0.55, interlineado: 56 / 38, separacion: 0, min: 24, max });
  return { cuerpo: m.cuerpo, cabe: m.cabe };
}

/** Puntas de una estrella de 5 puntas centrada en (cx, cy). */
function estrella(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.5;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}"/>`;
}

/** Bocadillo con 5 estrellas: 292 × 132 px (cápsula de 106 y rabito), trazo y estrellas oro. */
export function bocadilloEstrellas(escala = 1): string {
  const estrellas = [50, 98, 145, 193, 240].map((x) => estrella(x, 53, 18.5)).join("");
  return `<svg class="ctsn__estrellas" width="${Math.round(292 * escala)}" height="${Math.round(132 * escala)}" viewBox="0 0 292 132" aria-label="5 estrellas" role="img">
<path d="M53.25 1.25H238.75A52 52 0 0 1 238.75 105.25L236 105.25L236 118Q234 131 222 130Q214 129 208 122L187 105.25H53.25A52 52 0 0 1 53.25 1.25Z" fill="none" stroke="${ORO_RESENA}" stroke-width="2.6" stroke-linejoin="round"/>
<g fill="${ORO_RESENA}">${estrellas}</g></svg>`;
}

/**
 * Las comillas «99» de las originales (cada una 190 × 300, oro al 21 %, ENCIMA
 * del título): en story, la primera en x = 556 e y = 550 y la segunda 216 px
 * a la derecha.
 */
function comillas(c: { left: number; top: number; escala: number }): string {
  const una = "M93 0C146 0 188 40 188 108C188 190 150 254 60 300L46 289C94 259 124 226 133 176C120 181 107 183 93 183C42 183 0 145 0 91C0 40 42 0 93 0Z";
  const w = Math.round(410 * c.escala);
  const h = Math.round(300 * c.escala);
  return `<svg class="ctsn__comillas" style="left:${c.left}px;top:${c.top}px" width="${w}" height="${h}" viewBox="0 0 410 300" aria-hidden="true"><g fill="${ORO_RESENA}" fill-opacity=".21"><path d="${una}"/><path transform="translate(216 0)" d="${una}"/></g></svg>`;
}

/** Posiciones (px) por formato: story calcada; post recolocada con la misma letra un poco menor. */
const MEDIDAS = {
  story: { logo: 220, logoAncho: LOGO.ancho, titulo: 595, tituloCuerpo: 94, tituloLh: 104, comillas: { left: 556, top: 550, escala: 1 }, nombre: 898, nombreCuerpo: 55.5, regla: 995, texto: 1018, minTexto: 422, hueco: 120 },
  post: { logo: 56, logoAncho: 300, titulo: 300, tituloCuerpo: 80, tituloLh: 90, comillas: { left: 600, top: 260, escala: 0.82 }, nombre: 545, nombreCuerpo: 48, regla: 620, texto: 652, minTexto: 300, hueco: 60 },
} as const;

function html(datos: DatosPieza, ctx: ContextoPlantilla, conFoto: boolean): string {
  const story = datos.formato === "story";
  const m = MEDIDAS[story ? "story" : "post"];
  const texto = datos.cita ?? "";
  const { cuerpo } = cuerpoResena(texto, story);
  const caja = CAJA_RESENA[story ? "story" : "post"];
  const titulo = datos.titular || TITULO_RESENA;
  const nombre = datos.antetitulo
    ? `<p class="ctsn__nombre" data-campo="antetitulo" data-ajuste>${esc(datos.antetitulo)}</p><span class="ctsn__regla" aria-hidden="true"></span>`
    : "";
  const fondo = conFoto ? fondoDesenfocado(ctx.urlFoto(datos.foto ?? ""), 0.62) : "";
  return `<style>${fuentes(ctx, CARAS_RESENA)}${CSS_BASE}
.ctsn{background:#363f46}
.ctsn__logo{position:absolute;left:50%;top:${m.logo}px;width:${m.logoAncho}px;transform:translateX(-50%)}
.ctsn__titulo{position:absolute;left:116px;right:96px;top:${m.titulo}px;font-family:${POPPINS};font-weight:400;font-size:${m.tituloCuerpo}px;line-height:${m.tituloLh}px;letter-spacing:.01em;text-align:left;max-height:${m.tituloLh * 2 + 2}px;overflow-wrap:normal}
.ctsn__comillas{position:absolute;pointer-events:none}
.ctsn__pie{position:absolute;left:72px;right:72px;top:${m.nombre}px;display:flex;flex-direction:column;align-items:center;text-align:center}
.ctsn__nombre{font-family:${POPPINS};font-weight:500;font-size:${m.nombreCuerpo}px;line-height:1.3;max-width:900px;white-space:nowrap}
.ctsn__regla{display:block;width:228px;height:3px;margin-top:${m.regla - m.nombre - Math.round(m.nombreCuerpo * 1.3)}px;background:#fff}
.ctsn__texto{position:absolute;left:${(1080 - caja.ancho) / 2}px;width:${caja.ancho}px;top:${m.texto}px;display:flex;flex-direction:column;align-items:center}
.ctsn__cita{min-height:${m.minTexto}px;max-height:${caja.alto}px;font-family:${MONT};font-weight:300;font-size:${cuerpo}px;line-height:${Math.round((cuerpo * 56) / 38)}px;text-align:center;white-space:pre-line}
.ctsn__estrellas{display:block;flex:0 0 auto;margin-top:${m.hueco}px}
</style>
<div class="cts ctsn cts--${story ? "story" : "post"}">
  ${fondo}
  <img class="cts__logo ctsn__logo" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">
  <h1 class="ctsn__titulo" data-campo="titular" data-ajuste>${esc(titulo)}</h1>
  ${comillas(m.comillas)}
  <div class="ctsn__pie">${nombre}</div>
  <div class="ctsn__texto"><p class="ctsn__cita" data-campo="cita" data-ajuste>${esc(texto)}</p>${bocadilloEstrellas(story ? 1 : 0.8)}</div>
</div>`;
}

const comun = {
  marca: "casa-tomas",
  formatos: ["post", "story"],
  titularOpcional: true,
  limites: { titular: 34, antetitulo: 28, cita: MAX_RESENA },
} as const;

export const PLANTILLAS_RESENA: readonly Plantilla[] = [
  {
    ...comun,
    id: "ct-resena",
    nombre: "Reseña de cliente",
    descripcion:
      "«Lo que dicen nuestros clientes», como la destacada «Opináis»: fondo pizarra, logo, comillas grandes, el nombre del cliente con una regla, la reseña (se ajusta sola aunque sea larga) y 5 estrellas en un bocadillo.",
    papel: "tipografica",
    obligatorios: ["cita"],
    admitidos: ["antetitulo", "titular", "cita"],
    html: (datos, ctx) => html(datos, ctx, false),
  },
  {
    ...comun,
    id: "ct-resena-foto",
    nombre: "Reseña de cliente con foto",
    descripcion: "La reseña de cliente sobre una foto de plato desenfocada y oscurecida (vale cualquier foto, también las de la carta).",
    papel: "portada",
    obligatorios: ["foto", "cita"],
    admitidos: ["foto", "antetitulo", "titular", "cita"],
    encaje: "marco",
    html: (datos, ctx) => html(datos, ctx, true),
  },
];
