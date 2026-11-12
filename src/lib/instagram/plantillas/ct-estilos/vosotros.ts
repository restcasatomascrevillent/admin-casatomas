/**
 * Stories de la destacada «Vosotros» (12/11/2026, referencias-actuales/
 * destacada-vosotros.jpg). Solo story, la foto va ENTERA (encaje «marco»: vale
 * cualquier foto con el lado largo de 800 px o más, también las del móvil).
 *
 *   ct-vosotros-celebracion  la foto enmarcada sobre el fondo desenfocado de
 *                            la misma foto, el logo arriba y los nombres
 *                            resaltados con el motivo («celebrando su 75
 *                            cumpleaños»).
 *                            Campos: titular = los nombres; cita = el motivo.
 *   ct-vosotros-gracias      tarjeta clara con «Gracias por visitarnos», la
 *                            foto del cliente dentro y su @.
 *                            Campos: titular = el saludo; pie = la @ del cliente.
 */
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";
import { CSS_BASE, SANS, fondoDesenfocado, fuentes, zona, type Cara } from "./base.js";

/** Los nombres con los «y»/«e»/«&» en cursiva oro claro: así resaltan los nombres, como en la story de ahora. */
export function nombresResaltados(nombres: string): string {
  return nombres
    .split(/(\s+(?:y|e|&)\s+)/i)
    .map((t, i) => (i % 2 === 1 ? ` <span class="ctsc__y">${esc(t.trim())}</span> ` : esc(t)))
    .join("");
}

/** El motivo con la cifra y su palabra («75 cumpleaños», «50 aniversario») en blanco y redonda, como en la story de ahora. */
export function motivoResaltado(motivo: string): string {
  return esc(motivo).replace(/(\d+\s+[\p{L}]+)/u, '<strong class="ctsc__cifra">$1</strong>');
}

export const CARAS_CELEBRACION: readonly Cara[] = [];

function htmlCelebracion(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const z = zona(true);
  const url = ctx.urlFoto(datos.foto ?? "");
  const motivo = datos.cita ? `<p class="ctsc__motivo" data-campo="cita" data-ajuste>${motivoResaltado(datos.cita)}</p>` : "";
  return `<style>${CSS_BASE}
.ctsc__cuerpo{position:absolute;left:72px;right:72px;top:${z.arriba}px;height:${z.abajo - z.arriba}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.ctsc__logo{width:220px;margin-bottom:60px}
.ctsc__marco{display:block;border:8px solid var(--color-blanco);background:var(--color-blanco)}
.ctsc__foto{display:block;width:auto;height:auto;max-width:820px;max-height:740px}
.ctsc__nombres{margin-top:58px;font-family:var(--fuente-titular);font-weight:700;font-size:60px;line-height:1.18;letter-spacing:-.01em;max-height:calc(1.18em * 2 + 2px);text-wrap:balance;overflow-wrap:normal}
.ctsc__y{font-style:italic;font-weight:400;color:var(--color-oro-claro)}
.ctsc__cifra{font-style:normal;font-weight:700;color:var(--color-blanco)}
.ctsc__motivo{margin-top:16px;font-style:italic;font-weight:400;font-size:42px;line-height:1.25;max-height:calc(1.25em * 2 + 2px);color:var(--color-oro-claro);text-wrap:balance}
</style>
<div class="cts cts--story">
  ${fondoDesenfocado(url, 0.5)}
  <div class="ctsc__cuerpo">
    <img class="cts__logo ctsc__logo" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">
    <div class="ctsc__marco"><img class="ctsc__foto" src="${esc(url)}" alt=""></div>
    <h1 class="ctsc__nombres" data-campo="titular" data-ajuste>${nombresResaltados(datos.titular)}</h1>
    ${motivo}
  </div>
</div>`;
}

export const CARAS_GRACIAS: readonly Cara[] = ["sans-500"];

function htmlGracias(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const z = zona(true);
  const url = ctx.urlFoto(datos.foto ?? "");
  return `<style>${fuentes(ctx, CARAS_GRACIAS)}${CSS_BASE}
.ctsg__cuerpo{position:absolute;left:0;right:0;top:${z.arriba}px;height:${z.abajo - z.arriba}px;display:flex;align-items:center;justify-content:center}
.ctsg__tarjeta{width:860px;padding:60px 50px 52px;background:var(--color-papel);color:var(--color-pizarra);display:flex;flex-direction:column;align-items:center;text-align:center;border-radius:6px}
.ctsg__titular{font-family:var(--fuente-titular);font-weight:400;font-size:54px;line-height:1.2;letter-spacing:-.01em;max-width:760px;max-height:calc(1.2em * 2 + 2px);text-wrap:balance;overflow-wrap:normal}
.ctsg__foto{display:block;margin-top:44px;width:auto;height:auto;max-width:760px;max-height:820px}
.ctsg__arroba{margin-top:34px;font-family:${SANS};font-weight:500;font-size:32px;line-height:1.3;letter-spacing:.06em;color:var(--color-oro-texto);white-space:nowrap;max-width:760px}
.ctsg__logo{width:150px;margin-top:40px}
</style>
<div class="cts cts--story">
  ${fondoDesenfocado(url, 0.42)}
  <div class="ctsg__cuerpo">
    <div class="ctsg__tarjeta">
      <h1 class="ctsg__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
      <img class="ctsg__foto" src="${esc(url)}" alt="">
      <p class="ctsg__arroba" data-campo="pie" data-ajuste>${esc(datos.pie ?? "")}</p>
      <img class="cts__logo ctsg__logo" src="${esc(ctx.urlLogo("logo", "pizarra"))}" alt="Casa Tomás restaurante">
    </div>
  </div>
</div>`;
}

const comun = { marca: "casa-tomas", formatos: ["story"], encaje: "marco", papel: "portada" } as const;

export const PLANTILLAS_VOSOTROS: readonly Plantilla[] = [
  {
    ...comun,
    id: "ct-vosotros-celebracion",
    nombre: "Celebración (Vosotros)",
    descripcion:
      "Story de una celebración: la foto enmarcada sobre su propio fondo desenfocado, el logo arriba, los nombres resaltados y el motivo («celebrando su 75 cumpleaños»).",
    // El motivo es obligatorio: sin él no es una celebración (y así no la eligen las campañas de la IA).
    obligatorios: ["foto", "cita"],
    admitidos: ["foto", "titular", "cita"],
    limites: { titular: 48, cita: 56 },
    html: htmlCelebracion,
  },
  {
    ...comun,
    id: "ct-vosotros-gracias",
    nombre: "Gracias por visitarnos",
    descripcion: "Story de agradecimiento: tarjeta clara con «Gracias por visitarnos», la foto del cliente dentro y su @ debajo.",
    obligatorios: ["foto", "pie"],
    admitidos: ["foto", "titular", "pie"],
    limites: { titular: 34, pie: 32 },
    html: htmlGracias,
  },
];
