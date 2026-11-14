/**
 * Stories de la destacada «Vosotros» CALCADAS de las originales
 * (referencias-actuales/alta/vosotros-*.jpg, medidas en MEDIDAS.md). Solo
 * story; la foto va ENTERA (encaje «marco»: vale cualquier foto con el lado
 * largo de 800 px o más, también las del móvil).
 *
 *   ct-vosotros-celebracion  la misma foto de fondo, ampliada y oscurecida;
 *                            logo arriba (medallón en y = 265); la foto en una
 *                            tarjeta de esquinas redondas (r = 24) de 784 px de
 *                            ancho desde y = 680; los nombres en Amaranth 63 px
 *                            blanco con la «y» en oro (#bcb791) y el motivo en
 *                            oro con la cifra en blanco («celebrando su» /
 *                            «75 cumpleaños»), líneas cada 69 px desde y = 1406.
 *                            Campos: titular = los nombres; cita = el motivo.
 *   ct-vosotros-gracias      fondo gris claro #e0e0e0, «Gracias por visitarnos»
 *                            en Old Standard TT negro, la foto del cliente de
 *                            829 px de ancho desde y = 555 y debajo su @ como la
 *                            etiqueta de mención de Instagram (blanca, sombra).
 *                            Campos: titular = el saludo; pie = la @ del cliente.
 */
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";
import { AMARANTH, CSS_BASE, OLD_STANDARD, PLEX, fuentes, type Cara } from "./base.js";
import { LOGO } from "./rotulos.js";

const ORO_VOSOTROS = "#bcb791";

/** Los nombres con el «y»/«e»/«&» en oro y salto de línea detrás (como «Vicente Muñoz y / Vicente Menargues»). */
export function nombresResaltados(nombres: string): string {
  return nombres
    .split(/(\s+(?:y|e|&)\s+)/i)
    .map((t, i) => (i % 2 === 1 ? ` <span class="ctsc__y">${esc(t.trim())}</span><br>` : esc(t)))
    .join("");
}

/** El motivo en oro con la cifra y lo que sigue en blanco, en su propia línea («celebrando su» / «75 cumpleaños»). */
export function motivoResaltado(motivo: string): string {
  return esc(motivo).replace(/\s*(\d+\s+[\p{L}]+.*)$/u, '<br><strong class="ctsc__cifra">$1</strong>');
}

export const CARAS_CELEBRACION: readonly Cara[] = ["amaranth"];

function htmlCelebracion(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const url = ctx.urlFoto(datos.foto ?? "");
  const motivo = datos.cita ? `<p class="ctsc__motivo" data-campo="cita" data-ajuste>${motivoResaltado(datos.cita)}</p>` : "";
  return `<style>${fuentes(ctx, CARAS_CELEBRACION)}${CSS_BASE}
.ctsc__fondo{position:absolute;inset:-20px;width:calc(100% + 40px);height:calc(100% + 40px);object-fit:cover;filter:blur(3px)}
.ctsc__velo{position:absolute;inset:0;background:rgb(0 0 0 / .5)}
.ctsc__logo{position:absolute;left:50%;top:${265 - LOGO.desfaseMedallon}px;width:${LOGO.ancho}px;transform:translateX(-50%)}
.ctsc__marco{position:absolute;left:148px;right:148px;top:680px;height:555px;display:flex;align-items:flex-start;justify-content:center}
.ctsc__foto{display:block;width:auto;height:auto;max-width:784px;max-height:555px;border-radius:24px}
.ctsc__textos{position:absolute;left:72px;right:72px;top:1394px;font-family:${AMARANTH};font-weight:400;font-size:63px;line-height:69px;text-align:center}
.ctsc__nombres{font-size:inherit;max-height:${69 * 3 + 2}px;overflow-wrap:normal}
.ctsc__y{color:${ORO_VOSOTROS}}
.ctsc__motivo{color:${ORO_VOSOTROS};max-height:${69 * 2 + 2}px}
.ctsc__cifra{font-weight:400;color:#fff}
</style>
<div class="cts cts--story">
  <img class="ctsc__fondo" src="${esc(url)}" alt=""><div class="ctsc__velo" aria-hidden="true"></div>
  <img class="cts__logo ctsc__logo" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">
  <div class="ctsc__marco"><img class="ctsc__foto" src="${esc(url)}" alt=""></div>
  <div class="ctsc__textos">
    <h1 class="ctsc__nombres" data-campo="titular" data-ajuste>${nombresResaltados(datos.titular)}</h1>
    ${motivo}
  </div>
</div>`;
}

export const CARAS_GRACIAS: readonly Cara[] = ["oldstandard", "plex-500"];

function htmlGracias(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const url = ctx.urlFoto(datos.foto ?? "");
  return `<style>${fuentes(ctx, CARAS_GRACIAS)}${CSS_BASE}
.ctsg{background:#e0e0e0}
.ctsg__titular{position:absolute;left:72px;right:72px;top:446px;font-family:${OLD_STANDARD};font-weight:400;font-size:69px;line-height:1.2;letter-spacing:.02em;color:#000;text-align:center;white-space:nowrap}
.ctsg__marco{position:absolute;left:125px;right:126px;top:555px;height:830px;display:flex;align-items:flex-start;justify-content:center}
.ctsg__foto{display:block;width:auto;height:auto;max-width:829px;max-height:830px}
.ctsg__arroba{position:absolute;left:150px;right:120px;top:1408px;font-family:${PLEX};font-weight:500;font-size:39px;line-height:1.3;color:#fff;text-shadow:0 1px 2px rgb(0 0 0 / .6);white-space:nowrap}
</style>
<div class="cts ctsg cts--story">
  <h1 class="ctsg__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
  <div class="ctsg__marco"><img class="ctsg__foto" src="${esc(url)}" alt=""></div>
  <p class="ctsg__arroba" data-campo="pie" data-ajuste>${esc(datos.pie ?? "")}</p>
</div>`;
}

const comun = { marca: "casa-tomas", formatos: ["story"], encaje: "marco", papel: "portada" } as const;

export const PLANTILLAS_VOSOTROS: readonly Plantilla[] = [
  {
    ...comun,
    id: "ct-vosotros-celebracion",
    nombre: "Celebración (Vosotros)",
    descripcion:
      "Story de una celebración: la foto en una tarjeta de esquinas redondas sobre la misma foto oscurecida, el logo arriba, los nombres en blanco y el motivo en oro («celebrando su 75 cumpleaños»).",
    // El motivo es obligatorio: sin él no es una celebración (y así no la eligen las campañas de la IA).
    obligatorios: ["foto", "cita"],
    admitidos: ["foto", "titular", "cita"],
    limites: { titular: 48, cita: 40 },
    html: htmlCelebracion,
  },
  {
    ...comun,
    id: "ct-vosotros-gracias",
    nombre: "Gracias por visitarnos",
    descripcion: "Story de agradecimiento: fondo gris claro, «Gracias por visitarnos», la foto del cliente y su @ debajo.",
    obligatorios: ["foto", "pie"],
    admitidos: ["foto", "titular", "pie"],
    limites: { titular: 24, pie: 32 },
    html: htmlGracias,
  },
];
