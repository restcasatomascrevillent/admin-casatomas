/**
 * Touza · foto + titular (post 1080×1350 y story 1080×1920).
 *
 * Foto a sangre con velo negro arriba y abajo (el del hero de la web:
 * touza-restaurant-website:src/components/home/Hero.tsx → from-black/70
 * via-black/40 to-black/90, aquí con el centro más limpio para que la foto
 * respire). Wordmark TOUZA en texto (Cormorant 700, tracking 0.05em, oro,
 * como Header.tsx/App.tsx), antetítulo en oro, titular en crema, botón
 * píldora blanco con texto negro (Hero.tsx → bg-white text-black
 * rounded-full font-medium) y pie (por defecto «@touzabar»).
 *
 * - Post: composición a la izquierda; el texto se apoya en el pie del lienzo.
 * - Story: composición CENTRADA (eje simétrico, como el hero en ≥ md) dentro
 *   de la zona segura (250 px arriba y abajo).
 *
 * Desbordes: titular (máx. 3 líneas), antetítulo y botón (una línea) y pie
 * (máx. 2 líneas) llevan data-ajuste con caja acotada. Si el texto no cabe,
 * desborda de forma medible y el motor falla: nada de puntos suspensivos ni
 * de reducir el cuerpo de letra.
 */
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";
import { estilos } from "./estilos.js";

const PIE_POR_DEFECTO = "@touzabar";

function html(datos: DatosPieza, ctx: ContextoPlantilla): string {
  if (!datos.foto) throw new Error("tz-foto-titular: falta la foto");
  const story = datos.formato === "story";
  const pie = datos.pie ?? PIE_POR_DEFECTO;

  const antetitulo = datos.antetitulo
    ? `<p class="tzf-antetitulo" data-campo="antetitulo" data-ajuste>${esc(datos.antetitulo)}</p>`
    : "";
  const cta = datos.cta
    ? `<div class="tzf-acciones"><span class="tzf-cta" data-campo="cta" data-ajuste>${esc(datos.cta)}</span></div>`
    : "";
  // En el post la cruz tau firma el pie a la derecha; en la story el pie va
  // solo y centrado (la cruz competiría con el wordmark del eje).
  const tau = story
    ? ""
    : `<img class="tzf-tau" src="${esc(ctx.urlLogo("cruz-tau", "oro"))}" alt="" />`;

  return `<style>${estilos(ctx)}</style>
<div class="tzf ${story ? "tzf--story" : "tzf--post"}">
  <img class="tzf-foto" src="${esc(ctx.urlFoto(datos.foto))}" alt="" />
  <div class="tzf-velo" aria-hidden="true"></div>
  <div class="tzf-contenido">
    <div class="tzf-marca" aria-label="Touza">TOUZA</div>
    <div class="tzf-bloque">
      <div class="tzf-cuerpo">
        ${antetitulo}
        <h1 class="tzf-titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
        ${cta}
      </div>
      <div class="tzf-pie-fila">
        <p class="tzf-pie" data-campo="pie" data-ajuste>${esc(pie)}</p>
        ${tau}
      </div>
    </div>
  </div>
</div>`;
}

const plantilla: Plantilla = {
  id: "tz-foto-titular",
  marca: "touza",
  nombre: "Touza · Foto y titular",
  descripcion:
    "Foto a sangre con velo negro, wordmark TOUZA, antetítulo en oro, titular en crema, botón píldora blanco opcional y pie (@touzabar por defecto). Story centrada en la zona segura.",
  formatos: ["post", "story"],
  obligatorios: ["foto"],
  admitidos: ["foto", "antetitulo", "titular", "cta", "pie"],
  // Calibrados renderizando (04/11/2026): lo típico cabe con holgura y lo
  // largo falla aquí antes de llegar al DOM. El DOM (data-ajuste) sigue
  // siendo la red final: p. ej. una palabra larguísima que no parte.
  limites: {
    antetitulo: 36,
    titular: 40,
    cta: 22,
    pie: 70,
  },
  tiposFoto: ["barra", "coctel", "bebida", "interior"],
  // A sangre: la foto tiene que cubrir el lienzo (si no, «Foto enmarcada»).
  encaje: "sangre",
  // Clásica (08/11/2026): sigue abriendo las piezas guardadas, pero ya no sale en los selectores.
  clasica: true,
  html,
};

export default plantilla;
