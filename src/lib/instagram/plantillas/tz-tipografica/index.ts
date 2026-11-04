/**
 * Touza · tipográfica (solo post 1080×1350).
 *
 * Fondo negro, cruz tau en oro arriba a la izquierda, fila «01 ── ANTETÍTULO»
 * (numeral Cormorant en oro + trazo de 1 px al 40 % + antetítulo, como
 * touza-restaurant-website:src/components/home/Showcase.tsx), titular en
 * crema y lista con filetes blancos al 10 % (border-top en la lista y
 * border-bottom en cada elemento, como Claves.tsx): etiqueta a la izquierda
 * en Cormorant y valor a la derecha en Montserrat 300.
 *
 * Desbordes: titular (máx. 3 líneas) y lista (máx. 4 filas de una línea)
 * tienen caja acotada con data-ajuste; antetítulo, numeral y cada fila de la
 * lista van en una sola línea, así que un texto demasiado largo desborda en
 * horizontal y el motor falla. Nada de puntos suspensivos.
 */
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";
import { estilos, MAX_FILAS } from "./estilos.js";

const NUMERAL_POR_DEFECTO = "01";
const PIE_POR_DEFECTO = "@touzabar";

function html(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const lista = datos.lista ?? [];
  if (lista.length === 0) throw new Error("tz-tipografica: la lista está vacía");
  const numeral = datos.numeral ?? NUMERAL_POR_DEFECTO;
  const pie = datos.pie ?? PIE_POR_DEFECTO;

  const antetitulo = datos.antetitulo
    ? `<span class="tzt-antetitulo" data-campo="antetitulo" data-ajuste>${esc(datos.antetitulo)}</span>`
    : "";

  const filas = lista
    .map((el) => {
      const valor = el.valor ? `<span class="tzt-valor">${esc(el.valor)}</span>` : "";
      return `<li class="tzt-fila"><span class="tzt-etiqueta">${esc(el.etiqueta)}</span>${valor}</li>`;
    })
    .join("");

  return `<style>${estilos(ctx)}</style>
<div class="tzt">
  <div class="tzt-halo" aria-hidden="true"></div>
  <div class="tzt-contenido">
    <header class="tzt-cabecera">
      <img class="tzt-tau" src="${esc(ctx.urlLogo("cruz-tau", "oro"))}" alt="Touza" />
    </header>
    <div class="tzt-cuerpo">
      <div class="tzt-indice">
        <span class="tzt-numeral" data-campo="numeral">${esc(numeral)}</span>
        <span class="tzt-trazo" aria-hidden="true"></span>
        ${antetitulo}
      </div>
      <h1 class="tzt-titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
      <ul class="tzt-lista" data-campo="lista" data-ajuste>${filas}</ul>
    </div>
    <footer class="tzt-pie-fila">
      <p class="tzt-pie" data-campo="pie" data-ajuste>${esc(pie)}</p>
      <span class="tzt-marca" aria-hidden="true">TOUZA</span>
    </footer>
  </div>
</div>`;
}

const plantilla: Plantilla = {
  id: "tz-tipografica",
  marca: "touza",
  nombre: "Touza · Tipográfica",
  descripcion:
    "Fondo negro, cruz tau, fila numeral + trazo + antetítulo, titular en crema y lista de 1 a 4 filas (etiqueta / valor) con filetes finos. Para horarios, cartas cortas o datos.",
  formatos: ["post"],
  obligatorios: ["lista"],
  admitidos: ["numeral", "antetitulo", "titular", "lista", "pie"],
  // Calibrados renderizando (04/11/2026). En «lista» el número es el máximo
  // de ELEMENTOS (no caracteres); la longitud de cada fila la controla el DOM
  // (una sola línea por fila: si no cabe, desborda y el render falla).
  limites: {
    numeral: 3,
    antetitulo: 28,
    titular: 40,
    lista: MAX_FILAS,
    pie: 40,
  },
  html,
};

export default plantilla;
