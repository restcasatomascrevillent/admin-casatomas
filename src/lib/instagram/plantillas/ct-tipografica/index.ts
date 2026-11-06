/**
 * ct-tipografica — Casa Tomás: pieza solo tipográfica sobre papel.
 *
 * Bloque central único (medallón oro → antetítulo en oro-texto → filete de oro
 * con rombo → frase), centrado ópticamente; el pie, en gris medio, abajo.
 * Solo post.
 *
 * La frase grande (Baskerville cursiva 600, pizarra) es:
 * - la «cita» si la hay (lema sin límite de palabras, p. ej. «Nunca é longo o
 *   camiño que conduce á casa dun amigo.»). Si además hay titular, este va
 *   encima como encabezado pequeño (Baskerville 700, pizarra);
 * - si no, el «titular» (máx. 6 palabras), como siempre.
 *
 * titularOpcional: basta con titular o con cita (al menos uno). Sin titular,
 * validarPieza entrega titular "" y aquí no se pinta.
 */
import { esc, type Plantilla } from "../../tipos.js";
import { CSS_TIPOGRAFICA } from "./estilos.js";

/** Pie por defecto si la pieza no trae uno (cuenta real de Instagram, Footer.tsx de la web). */
export const PIE_POR_DEFECTO = "@casatomascrevillent · Crevillent";

const plantilla: Plantilla = {
  id: "ct-tipografica",
  marca: "casa-tomas",
  nombre: "Tipográfica sobre papel",
  descripcion:
    "Fondo papel con grano, medallón oro, antetítulo, filete de oro con rombo y frase (titular o cita/lema) en Baskerville cursiva. Sin foto.",
  formatos: ["post"],
  obligatorios: [],
  titularOpcional: true,
  admitidos: ["antetitulo", "titular", "cita", "pie"],
  // Caracteres. La frase grande va en 4 líneas como máximo a 80 px (~70
  // caracteres de cita caben; ~90 desbordan y el motor da error). Con cita, el
  // titular va pequeño en 2 líneas como máximo. Antetítulo y pie en una línea.
  limites: {
    antetitulo: 40,
    titular: 60,
    cita: 70,
    pie: 48,
  },

  html(datos, ctx) {
    const pie = datos.pie ?? PIE_POR_DEFECTO;
    const antetitulo = datos.antetitulo
      ? `<p class="ct-tp__antetitulo" data-campo="antetitulo" data-ajuste>${esc(datos.antetitulo)}</p>`
      : "";

    let textos: string;
    if (datos.cita) {
      const titular = datos.titular
        ? `<h1 class="ct-tp__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>`
        : "";
      const etiqueta = datos.titular ? "p" : "h1";
      textos = `${titular}
    <${etiqueta} class="ct-tp__frase ct-tp__frase--cita" data-campo="cita" data-ajuste>${esc(datos.cita)}</${etiqueta}>`;
    } else {
      textos = `<h1 class="ct-tp__frase" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>`;
    }

    return `
<style>${CSS_TIPOGRAFICA}</style>
<div class="ct-tp">
  <div class="ct-tp__marco"></div>
  <div class="ct-tp__bloque">
    <img class="ct-tp__medallon" src="${esc(ctx.urlLogo("medallon", "oro"))}" alt="Casa Tomás">
    ${antetitulo}
    <div class="ct-tp__filete" aria-hidden="true"><span></span><span></span><span></span></div>
    ${textos}
  </div>
  <p class="ct-tp__pie" data-campo="pie" data-ajuste>${esc(pie)}</p>
</div>`;
  },
};

export default plantilla;
