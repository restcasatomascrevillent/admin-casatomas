/**
 * ct-marco — Casa Tomás · Foto enmarcada (08/11/2026).
 *
 * Para las fotos que NO cubren el lienzo: las de la carta (tabla «Platos»,
 * 1200×900 apaisadas y comprimidas para la web), apaisadas o pequeñas. La foto
 * va ENTERA, sin recortar ni ampliar, con paspartú blanco y filete oro sobre
 * el papel de la marca. Vale cualquier foto con el lado largo ≥ 800 px
 * (encaje «marco», ver esAptaPara).
 *
 * Post (1080×1350; también cada imagen del carrusel): antetítulo entre rayas
 * oro arriba; la foto en el centro; debajo, titular en Baskerville, nombre del
 * plato o cita en cursiva, botón píldora oro y el medallón con el pie.
 * Story (1080×1920): antetítulo y titular arriba, desde la zona segura (250);
 * la foto en el tercio central; cita, botón y pie abajo, por encima de los
 * 320 px de la barra de respuesta (zona segura del sistema de marca 9:16).
 */
import { esc, type Plantilla } from "../../tipos.js";
import { CSS_MARCO } from "./estilos.js";

/** Pie por defecto (el mismo que ct-foto-titular). */
export const PIE_POR_DEFECTO = "@casatomascrevillent · Crevillent";

const plantilla: Plantilla = {
  id: "ct-marco",
  marca: "casa-tomas",
  nombre: "Foto enmarcada",
  descripcion:
    "La foto entera, sin recortar ni ampliar, con paspartú blanco y filete oro sobre papel; antetítulo, titular en Baskerville, nombre del plato o cita en cursiva y botón píldora. Para las fotos de la carta (1200×900) y cualquier foto apaisada o pequeña.",
  formatos: ["post", "story"],
  obligatorios: ["foto"],
  admitidos: ["foto", "antetitulo", "titular", "cita", "cta", "pie"],
  // Caracteres. Medidos con el render (08/11/2026): lo típico cabe con
  // holgura y lo largo desborda (el motor da error) antes de estos máximos.
  limites: {
    antetitulo: 34,
    titular: 38,
    cita: 70,
    cta: 26,
    pie: 48,
  },
  tiposFoto: ["plato", "sala", "ambiente", "bebida", "interior", "barra", "coctel"],
  encaje: "marco",
  // Clásica (08/11/2026): sigue abriendo las piezas guardadas, pero ya no sale en los selectores.
  clasica: true,

  html(datos, ctx) {
    const story = datos.formato === "story";
    const pie = datos.pie ?? PIE_POR_DEFECTO;

    const antetitulo = datos.antetitulo
      ? `<div class="ct-mc__ante-fila"><span class="ct-mc__raya" aria-hidden="true"></span><p class="ct-mc__antetitulo" data-campo="antetitulo" data-ajuste>${esc(datos.antetitulo)}</p><span class="ct-mc__raya" aria-hidden="true"></span></div>`
      : "";
    const titular = datos.titular ? `<h1 class="ct-mc__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>` : "";
    const cita = datos.cita ? `<p class="ct-mc__cita" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
    const cta = datos.cta ? `<span class="ct-mc__cta" data-campo="cta" data-ajuste>${esc(datos.cta)}</span>` : "";
    const pieFila = `<div class="ct-mc__pie-fila"><img class="ct-mc__medallon" src="${esc(ctx.urlLogo("medallon", "oro"))}" alt="Casa Tomás"><p class="ct-mc__pie" data-campo="pie" data-ajuste>${esc(pie)}</p></div>`;
    const foto = `<div class="ct-mc__marco"><img class="ct-mc__foto" src="${esc(ctx.urlFoto(datos.foto ?? ""))}" alt=""></div>`;

    // Post: arriba solo el antetítulo; el titular va con el resto debajo de la foto.
    // Story: antetítulo y titular arriba; cita, botón y pie abajo.
    const arriba = story ? `${antetitulo}${titular}` : antetitulo;
    const abajo = story ? `${cita}${cta}${pieFila}` : `${titular}${cita}${cta}${pieFila}`;

    return `
<style>${CSS_MARCO}</style>
<div class="ct-mc ct-mc--${story ? "story" : "post"}">
  ${arriba ? `<header class="ct-mc__cabecera">${arriba}</header>` : ""}
  ${foto}
  <footer class="ct-mc__bloque">${abajo}</footer>
</div>`;
  },
};

export default plantilla;
