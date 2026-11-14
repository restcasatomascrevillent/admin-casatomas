/**
 * Reseña «Lo que dicen nuestros clientes» (12/11/2026), copia de la destacada
 * «Opináis» (referencias-actuales/destacada-opinais.jpg): fondo pizarra liso,
 * logo blanco arriba, el título a la izquierda con unas comillas enormes
 * semitransparentes detrás, el nombre del cliente con una regla fina, la
 * reseña centrada y las estrellas dentro de un bocadillo.
 *
 *   ct-resena        fondo pizarra liso (como ahora).
 *   ct-resena-foto   fondo con una foto de plato desenfocada y oscurecida.
 *
 * Mejora: el cuerpo de la reseña se ajusta solo a su largo (de 42 a 24 px,
 * medidasLista de ct-tapas); si ni con 24 px cabe, la caja desborda y el motor
 * da error (nunca se recorta). Las estrellas son siempre 5 (el editor aún no
 * tiene campo para ellas: ver el informe).
 *
 * Campos: titular = el título (si no llega, «Lo que dicen nuestros
 * clientes»); antetitulo = nombre del cliente; cita = la reseña (obligatoria).
 */
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";
import { medidasLista } from "../ct-tapas/index.js";
import { CSS_BASE, SANS, fondoDesenfocado, fuentes, zona, type Cara } from "./base.js";

export const TITULO_RESENA = "Lo que dicen nuestros clientes";
export const CARAS_RESENA: readonly Cara[] = ["sans-400", "sans-500"];
/** Caracteres máximos de la reseña (las de la captura van de 150 a 480). */
export const MAX_RESENA = 560;

/** Caja del texto de la reseña por formato (px). */
export const CAJA_RESENA = { story: { ancho: 820, alto: 700 }, post: { ancho: 860, alto: 480 } } as const;

/** Cuerpo de la reseña para que quepa en su caja (estimación palabra a palabra). */
export function cuerpoResena(texto: string, story: boolean): { cuerpo: number; cabe: boolean } {
  const caja = CAJA_RESENA[story ? "story" : "post"];
  const m = medidasLista([texto], { ancho: caja.ancho, alto: caja.alto, ratio: 0.52, interlineado: 1.5, separacion: 0, min: 24, max: story ? 42 : 38 });
  return { cuerpo: m.cuerpo, cabe: m.cabe };
}

/** Puntas de una estrella de 5 puntas centrada en (cx, cy). */
function estrella(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}"/>`;
}

/** Bocadillo con 5 estrellas (como el de las stories de ahora), en oro claro. */
export function bocadilloEstrellas(ancho: number): string {
  const estrellas = [53, 89, 125, 161, 197].map((x) => estrella(x, 41, 13)).join("");
  return `<svg class="ctsn__estrellas" width="${ancho}" height="${Math.round((ancho * 100) / 250)}" viewBox="0 0 250 100" aria-label="5 estrellas" role="img">
<path d="M41,3 H209 A38,38 0 0 1 209,79 H90 L56,97 L64,79 H41 A38,38 0 0 1 41,3 Z" fill="none" stroke="var(--color-oro-claro)" stroke-width="2.5" stroke-linejoin="round"/>
<g fill="var(--color-oro-claro)">${estrellas}</g></svg>`;
}

function html(datos: DatosPieza, ctx: ContextoPlantilla, conFoto: boolean): string {
  const story = datos.formato === "story";
  const z = zona(story);
  const texto = datos.cita ?? "";
  const { cuerpo } = cuerpoResena(texto, story);
  const caja = CAJA_RESENA[story ? "story" : "post"];
  const titulo = datos.titular || TITULO_RESENA;
  const nombre = datos.antetitulo ? `<p class="ctsn__nombre" data-campo="antetitulo" data-ajuste>${esc(datos.antetitulo)}</p><span class="ctsn__regla" aria-hidden="true"></span>` : "";
  const fondo = conFoto ? fondoDesenfocado(ctx.urlFoto(datos.foto ?? ""), 0.7) : "";
  return `<style>${fuentes(ctx, CARAS_RESENA)}${CSS_BASE}
.ctsn{background:color-mix(in srgb, var(--color-pizarra) 55%, var(--color-pizarra-oscura))}
.ctsn__cuerpo{position:absolute;left:0;right:0;top:${z.arriba}px;height:${z.abajo - z.arriba}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.ctsn__logo{width:${story ? 230 : 188}px}
.ctsn__cabecera{position:relative;align-self:stretch;margin:${story ? 60 : 40}px ${story ? 104 : 96}px 0}
.ctsn__comillas{position:absolute;right:-24px;top:${story ? -150 : -120}px;font-family:var(--fuente-titular);font-weight:700;font-size:${story ? 520 : 420}px;line-height:1;color:rgb(255 255 255 / .07);pointer-events:none}
.ctsn__titulo{position:relative;font-family:${SANS};font-weight:500;font-size:${story ? 74 : 62}px;line-height:1.1;letter-spacing:-.005em;text-align:left;max-width:${story ? 760 : 700}px;max-height:calc(1.1em * 2 + 2px);overflow-wrap:normal;text-wrap:balance}
.ctsn__nombre{margin-top:${story ? 64 : 44}px;font-family:${SANS};font-weight:500;font-size:${story ? 36 : 32}px;line-height:1.3;max-width:820px;white-space:nowrap}
.ctsn__regla{display:block;width:120px;height:2px;margin-top:16px;background:rgb(255 255 255 / .7)}
.ctsn__texto{margin-top:${story ? 38 : 28}px;width:${caja.ancho}px;max-height:${caja.alto}px;font-family:${SANS};font-weight:400;font-size:${cuerpo}px;line-height:1.5;color:rgb(255 255 255 / .94);text-wrap:pretty}
.ctsn__estrellas{display:block;margin-top:${story ? 52 : 36}px}
</style>
<div class="cts ctsn cts--${story ? "story" : "post"}">
  ${fondo}
  <div class="ctsn__cuerpo">
    <img class="cts__logo ctsn__logo" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">
    <div class="ctsn__cabecera"><span class="ctsn__comillas" aria-hidden="true">&#8221;</span><h1 class="ctsn__titulo" data-campo="titular" data-ajuste>${esc(titulo)}</h1></div>
    ${nombre}
    <p class="ctsn__texto" data-campo="cita" data-ajuste>${esc(texto)}</p>
    ${bocadilloEstrellas(story ? 250 : 220)}
  </div>
</div>`;
}

const comun = {
  marca: "casa-tomas",
  formatos: ["post", "story"],
  titularOpcional: true,
  limites: { titular: 34, antetitulo: 32, cita: MAX_RESENA },
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
