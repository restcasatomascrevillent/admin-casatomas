/**
 * tz-marco — Touza · Foto enmarcada (08/11/2026).
 *
 * Para las fotos que NO cubren el lienzo (las de la carta, 1200×900, o
 * cualquiera apaisada o pequeña): la foto ENTERA, sin recortar ni ampliar,
 * sobre el negro de marca con un filete oro fino. Vale cualquier foto con el
 * lado largo ≥ 800 px (encaje «marco»).
 *
 * Post (1080×1350; también cada imagen del carrusel): wordmark TOUZA arriba;
 * la foto; debajo, antetítulo en oro, titular en Cormorant, nombre del plato
 * o cita en cursiva, botón píldora blanco y la cruz tau con el pie.
 * Story (1080×1920): TOUZA, antetítulo y titular arriba desde la zona segura;
 * la foto en el tercio central; cita, botón y pie abajo, por encima de los
 * 320 px de la barra de respuesta.
 */
import { esc, type Plantilla } from "../../tipos.js";
import { CSS_MARCO_TOUZA } from "./estilos.js";

const PIE_POR_DEFECTO = "@touzabar";

const plantilla: Plantilla = {
  id: "tz-marco",
  marca: "touza",
  nombre: "Touza · Foto enmarcada",
  descripcion:
    "La foto entera, sin recortar ni ampliar, con filete oro sobre negro; wordmark TOUZA, antetítulo en oro, titular en crema, nombre o cita en cursiva y botón píldora blanco. Para las fotos de la carta (1200×900) y cualquier foto apaisada o pequeña.",
  formatos: ["post", "story"],
  obligatorios: ["foto"],
  admitidos: ["foto", "antetitulo", "titular", "cita", "cta", "pie"],
  // Calibrados renderizando (08/11/2026).
  limites: {
    antetitulo: 34,
    titular: 38,
    cita: 70,
    cta: 22,
    pie: 48,
  },
  tiposFoto: ["plato", "barra", "coctel", "bebida", "interior", "ambiente", "sala"],
  encaje: "marco",

  html(datos, ctx) {
    const story = datos.formato === "story";
    const pie = datos.pie ?? PIE_POR_DEFECTO;

    const marca = `<div class="tzm__marca" aria-label="Touza">TOUZA</div>`;
    const antetitulo = datos.antetitulo
      ? `<div class="tzm__ante-fila"><span class="tzm__raya" aria-hidden="true"></span><p class="tzm__antetitulo" data-campo="antetitulo" data-ajuste>${esc(datos.antetitulo)}</p><span class="tzm__raya" aria-hidden="true"></span></div>`
      : "";
    const titular = datos.titular ? `<h1 class="tzm__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>` : "";
    const cita = datos.cita ? `<p class="tzm__cita" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
    const cta = datos.cta ? `<span class="tzm__cta" data-campo="cta" data-ajuste>${esc(datos.cta)}</span>` : "";
    const pieFila = `<div class="tzm__pie-fila"><img class="tzm__tau" src="${esc(ctx.urlLogo("cruz-tau", "oro"))}" alt=""><p class="tzm__pie" data-campo="pie" data-ajuste>${esc(pie)}</p></div>`;
    const foto = `<div class="tzm__marco"><img class="tzm__foto" src="${esc(ctx.urlFoto(datos.foto ?? ""))}" alt=""></div>`;

    const arriba = story ? `${marca}${antetitulo}${titular}` : marca;
    const abajo = story ? `${cita}${cta}${pieFila}` : `${antetitulo}${titular}${cita}${cta}${pieFila}`;

    return `
<style>${CSS_MARCO_TOUZA}</style>
<div class="tzm tzm--${story ? "story" : "post"}">
  <header class="tzm__cabecera">${arriba}</header>
  ${foto}
  <footer class="tzm__bloque">${abajo}</footer>
</div>`;
  },
};

export default plantilla;
