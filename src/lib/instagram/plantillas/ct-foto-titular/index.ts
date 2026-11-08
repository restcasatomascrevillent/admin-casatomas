/**
 * ct-foto-titular — Casa Tomás: foto real a sangre + titular.
 *
 * Post (1080×1350): medallón blanco arriba a la izquierda, texto alineado a la
 * izquierda y apoyado abajo sobre un velo pizarra (92 % al pie).
 * Story (1080×1920): composición centrada, todo dentro de la zona segura;
 * medallón centrado al principio de la zona segura y texto apoyado en su final.
 */
import { esc, type Plantilla } from "../../tipos.js";
import { CSS_FOTO_TITULAR } from "./estilos.js";

/** Pie por defecto si la pieza no trae uno (cuenta real de Instagram, Footer.tsx de la web). */
export const PIE_POR_DEFECTO = "@casatomascrevillent · Crevillent";

/**
 * Encuadre por foto (object-position). Las fotos de sala tienen mucho techo
 * claro arriba: se baja el encuadre para dar peso a mesas y lámparas.
 * Lo que no esté aquí usa ENCUADRE_POR_DEFECTO.
 */
const ENCUADRE: Record<string, { post: string; story: string }> = {
  "ct-lampara": { post: "50% 30%", story: "44% 50%" },
  "ct-salon-1": { post: "50% 70%", story: "40% 50%" },
  "ct-salon-3": { post: "50% 60%", story: "30% 50%" },
  "ct-salon-4": { post: "50% 70%", story: "35% 50%" },
  "ct-salon-5": { post: "50% 75%", story: "50% 50%" },
  "ct-comedor-1": { post: "50% 65%", story: "50% 50%" },
  "ct-comedor-2": { post: "50% 55%", story: "60% 50%" },
  "ct-comedor-3": { post: "50% 60%", story: "50% 50%" },
};
const ENCUADRE_POR_DEFECTO = { post: "50% 55%", story: "50% 50%" };

const plantilla: Plantilla = {
  id: "ct-foto-titular",
  marca: "casa-tomas",
  nombre: "Foto con titular",
  descripcion:
    "Foto real a sangre con velo pizarra, medallón blanco, antetítulo, titular en Baskerville y botón píldora opcional.",
  formatos: ["post", "story"],
  obligatorios: ["foto"],
  admitidos: ["foto", "antetitulo", "titular", "cta", "pie"],
  // Caracteres. Medidos con el render: lo típico cabe con holgura y lo largo
  // desborda (y el motor da error) antes de llegar a estos máximos o justo en ellos.
  limites: {
    antetitulo: 40,
    titular: 44,
    cta: 26,
    pie: 48,
  },
  tiposFoto: ["plato", "sala", "ambiente", "bebida", "interior", "barra"],
  // A sangre: la foto tiene que cubrir el lienzo (si no, «Foto enmarcada»).
  encaje: "sangre",

  html(datos, ctx) {
    const story = datos.formato === "story";
    const idFoto = datos.foto ?? "";
    const encuadre = (ENCUADRE[idFoto] ?? ENCUADRE_POR_DEFECTO)[story ? "story" : "post"];
    const pie = datos.pie ?? PIE_POR_DEFECTO;

    const antetitulo = datos.antetitulo
      ? `<p class="ct-ft__antetitulo" data-campo="antetitulo" data-ajuste>${esc(datos.antetitulo)}</p>
         <div class="ct-ft__filete" aria-hidden="true"><span></span><span></span><span></span></div>`
      : "";
    const cta = datos.cta
      ? `<span class="ct-ft__cta" data-campo="cta" data-ajuste>${esc(datos.cta)}</span>`
      : "";

    return `
<style>${CSS_FOTO_TITULAR}</style>
<div class="ct-ft ct-ft--${story ? "story" : "post"}">
  <img class="ct-ft__foto" src="${esc(ctx.urlFoto(idFoto))}" alt="" style="object-position: ${encuadre}">
  <div class="ct-ft__velo ct-ft__velo--sup"></div>
  <div class="ct-ft__velo ct-ft__velo--inf"></div>
  <img class="ct-ft__medallon" src="${esc(ctx.urlLogo("medallon", "blanco"))}" alt="Casa Tomás">
  <div class="ct-ft__bloque">
    ${antetitulo}
    <h1 class="ct-ft__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
    ${cta}
    <p class="ct-ft__pie" data-campo="pie" data-ajuste>${esc(pie)}</p>
  </div>
</div>`;
  },
};

export default plantilla;
