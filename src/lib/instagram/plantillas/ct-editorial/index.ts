/**
 * Plantillas v2 de Casa Tomás (08/11/2026): un juego por papel, hecho con el
 * sistema de marca del dueño (marca-base) y no con adornos de plantilla.
 *
 *   ct-portada         portada a sangre: el post del plato de redes-posts.html
 *                      (sello oro, titular, cita, logo e información).
 *   ct-portada-marco   portada con la foto entera (fotos de la carta, 1200×900):
 *                      foto arriba a la izquierda y texto debajo.
 *   ct-plato           interior del carrusel a sangre: foto limpia y rótulo
 *                      inferior pequeño con barra oro (como en los reels).
 *   ct-plato-marco     interior con la foto entera: la foto sale por la derecha
 *                      y el nombre del plato va debajo, pequeño.
 *   ct-cierre          última imagen a sangre: logo, lema, botón e información.
 *   ct-cierre-marco    última imagen con la foto entera.
 *   ct-cierre-marca    cierre sin foto: el post del lema del dueño (centrado,
 *                      tal cual) con botón opcional.
 *   ct-frase           sin foto: una frase o un anuncio, asimétrica.
 *
 * Sin rombos ni filetes; el logo solo en portada, cierre y frase; el botón
 * solo en portada (post suelto) y cierre. Post y story en todas.
 */
import { esc, type ContextoPlantilla, type DatosPieza, type EncajeFoto, type PapelPlantilla, type Plantilla } from "../../tipos.js";
import { campo, lineaInfo } from "../comun.js";
import { CSS_CT_EDITORIAL } from "./estilos.js";

/** Información del cierre por defecto (redes-posts.html y video-9x16.html del dueño). */
export const INFO_CIERRE = "966 10 78 87 · @casatomascrevillent";
/** Pie del post del lema del dueño. */
export const INFO_MARCA_POST = "Desde 1998 · Crevillent";
/** Lema en gallego (brand-voice.html). */
export const LEMA_CASA_TOMAS = "Nunca é longo o camiño que conduce á casa dun amigo.";
const PIE_FRASE = "@casatomascrevillent · Crevillent";

type Variante = "portada" | "plato" | "cierre" | "marca" | "frase";

function foto(datos: DatosPieza, ctx: ContextoPlantilla, encaje: EncajeFoto): string {
  const url = esc(ctx.urlFoto(datos.foto ?? ""));
  return encaje === "sangre"
    ? `<img class="cte__foto" src="${url}" alt="">`
    : `<div class="cte__marco"><img class="cte__foto-marco" src="${url}" alt=""></div>`;
}

/** Titular y/o lema del cierre: si llegan los dos, el titular encima y el lema debajo. */
function textosCierre(datos: DatosPieza, claseTitular = "cte__titular"): string {
  return `${campo("h1", claseTitular, "titular", datos.titular)}${campo("p", "cte__lema", "cita", datos.cita)}`;
}

function html(variante: Variante, encaje: EncajeFoto | null, datos: DatosPieza, ctx: ContextoPlantilla): string {
  const story = datos.formato === "story";
  const clases = ["cte", `cte--${variante}`, encaje ? `cte--${encaje}` : "", `cte--${story ? "story" : "post"}`].filter(Boolean).join(" ");
  const logoBlanco = esc(ctx.urlLogo("logo", "blanco"));
  const logoPizarra = esc(ctx.urlLogo("logo", "pizarra"));
  let cuerpo = "";

  if (variante === "portada") {
    const titular = campo("h1", "cte__titular", "titular", datos.titular);
    const cita = campo("p", "cte__cita", "cita", datos.cita);
    const info = lineaInfo("cte__info", datos.cta, datos.pie);
    if (encaje === "sangre") {
      const sello = campo("p", "cte__sello", "antetitulo", datos.antetitulo);
      cuerpo = `${foto(datos, ctx, "sangre")}<div class="cte__degradado"></div>${sello}
<div class="cte__bloque">${titular}${cita}<div class="cte__firma"><img class="cte__logo" src="${logoBlanco}" alt="Casa Tomás">${info}</div></div>`;
    } else {
      const etiqueta = campo("p", "cte__etiqueta", "antetitulo", datos.antetitulo);
      cuerpo = `${foto(datos, ctx, "marco")}
<div class="cte__texto">${etiqueta}${titular}${cita}<div class="cte__firma"><img class="cte__logo" src="${logoPizarra}" alt="Casa Tomás">${info}</div></div>`;
    }
  } else if (variante === "plato") {
    const etiqueta = campo("p", "cte__etiqueta", "antetitulo", datos.antetitulo);
    const titular = campo("h1", "cte__titular", "titular", datos.titular);
    const cita = campo("p", "cte__cita", "cita", datos.cita);
    cuerpo =
      encaje === "sangre"
        ? `${foto(datos, ctx, "sangre")}<div class="cte__degradado"></div>
<div class="cte__rotulo"><span class="cte__barra" aria-hidden="true"></span><div class="cte__rotulo-textos">${etiqueta}${titular}${cita}</div></div>`
        : `${foto(datos, ctx, "marco")}<div class="cte__texto">${etiqueta}${titular}${cita}</div>`;
  } else if (variante === "cierre") {
    const pie = datos.pie ?? INFO_CIERRE;
    const boton = campo("span", "cte__boton", "cta", datos.cta);
    const info = campo("p", "cte__info", "pie", pie);
    if (encaje === "sangre") {
      cuerpo = `${foto(datos, ctx, "sangre")}<div class="cte__degradado"></div>
<div class="cte__bloque"><img class="cte__logo" src="${logoBlanco}" alt="Casa Tomás">${textosCierre(datos)}${boton}${info}</div>`;
    } else {
      cuerpo = `${foto(datos, ctx, "marco")}
<div class="cte__texto"><img class="cte__logo" src="${logoPizarra}" alt="Casa Tomás">${textosCierre(datos)}${boton}${info}</div>`;
    }
  } else if (variante === "marca") {
    const pie = datos.pie ?? (story ? INFO_CIERRE : INFO_MARCA_POST);
    cuerpo = `<div class="cte__orbe" aria-hidden="true"></div>
<img class="cte__logo" src="${logoPizarra}" alt="Casa Tomás">${textosCierre(datos)}${campo("span", "cte__boton", "cta", datos.cta)}${campo("p", "cte__info", "pie", pie)}`;
  } else {
    // Frase: con cita, el titular hace de encabezado pequeño y la cita es la frase grande.
    const pie = datos.pie ?? PIE_FRASE;
    const frase = datos.cita
      ? `${campo("h2", "cte__titular cte__encabezado", "titular", datos.titular)}${campo("p", "cte__lema", "cita", datos.cita)}`
      : campo("h1", "cte__titular", "titular", datos.titular);
    cuerpo = `<div class="cte__orbe" aria-hidden="true"></div>${campo("p", "cte__etiqueta", "antetitulo", datos.antetitulo)}
<div class="cte__cuerpo">${frase}</div>
<div class="cte__firma"><img class="cte__logo" src="${esc(ctx.urlLogo("medallon", "pizarra"))}" alt="Casa Tomás">${campo("p", "cte__info", "pie", pie)}</div>`;
  }

  return `<style>${CSS_CT_EDITORIAL}</style>\n<div class="${clases}">\n${cuerpo}\n</div>`;
}

interface Def {
  id: string;
  nombre: string;
  descripcion: string;
  papel: PapelPlantilla;
  variante: Variante;
  encaje: EncajeFoto | null;
  admitidos: Plantilla["admitidos"];
  limites: Plantilla["limites"];
  titularOpcional?: boolean;
}

const DEFS: Def[] = [
  {
    id: "ct-portada",
    nombre: "Portada",
    descripcion: "Primera imagen (o post suelto): foto a sangre con un degradado solo abajo, sello oro opcional, titular grande, frase en cursiva y el logo con «botón · pie» en una línea.",
    papel: "portada",
    variante: "portada",
    encaje: "sangre",
    admitidos: ["foto", "antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 24, titular: 44, cita: 80, cta: 24, pie: 34 },
  },
  {
    id: "ct-portada-marco",
    nombre: "Portada · Foto enmarcada",
    descripcion: "Primera imagen con la foto entera, sin ampliar (fotos de la carta, 1200×900): la foto arriba a la izquierda y, debajo, titular, frase y el logo.",
    papel: "portada",
    variante: "portada",
    encaje: "marco",
    admitidos: ["foto", "antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 34, titular: 38, cita: 70, cta: 24, pie: 34 },
  },
  {
    id: "ct-plato",
    nombre: "Plato (interior)",
    descripcion: "Imagen del medio del carrusel: la foto limpia y, abajo a la izquierda, el nombre del plato pequeño con una barra oro. Sin logo ni botón.",
    papel: "plato",
    variante: "plato",
    encaje: "sangre",
    admitidos: ["foto", "antetitulo", "titular", "cita"],
    limites: { antetitulo: 30, titular: 34, cita: 60 },
  },
  {
    id: "ct-plato-marco",
    nombre: "Plato · Foto enmarcada",
    descripcion: "Imagen del medio con la foto entera (fotos de la carta): la foto sale por la derecha y el nombre del plato va debajo, pequeño. Sin logo ni botón.",
    papel: "plato",
    variante: "plato",
    encaje: "marco",
    admitidos: ["foto", "antetitulo", "titular", "cita"],
    limites: { antetitulo: 34, titular: 38, cita: 70 },
  },
  {
    id: "ct-cierre",
    nombre: "Cierre con foto",
    descripcion: "Última imagen: foto a sangre con degradado abajo, el logo, el lema en cursiva, el botón y la información.",
    papel: "cierre",
    variante: "cierre",
    encaje: "sangre",
    titularOpcional: true,
    admitidos: ["foto", "titular", "cita", "cta", "pie"],
    limites: { titular: 40, cita: 90, cta: 26, pie: 48 },
  },
  {
    id: "ct-cierre-marco",
    nombre: "Cierre · Foto enmarcada",
    descripcion: "Última imagen con la foto entera (fotos de la carta): debajo, el logo, el lema, el botón y la información.",
    papel: "cierre",
    variante: "cierre",
    encaje: "marco",
    titularOpcional: true,
    admitidos: ["foto", "titular", "cita", "cta", "pie"],
    limites: { titular: 40, cita: 80, cta: 26, pie: 48 },
  },
  {
    id: "ct-cierre-marca",
    nombre: "Cierre de marca (sin foto)",
    descripcion: "El post del lema del sistema de marca: logo grande, lema en cursiva, botón opcional y «Desde 1998 · Crevillent» (en story, teléfono y cuenta).",
    papel: "cierre",
    variante: "marca",
    encaje: null,
    titularOpcional: true,
    admitidos: ["titular", "cita", "cta", "pie"],
    limites: { titular: 40, cita: 70, cta: 26, pie: 30 },
  },
  {
    id: "ct-frase",
    nombre: "Frase (sin foto)",
    descripcion: "Una frase o un anuncio sin foto, alineado a la izquierda con mucho aire: antetítulo arriba, la frase abajo y el medallón con el pie.",
    papel: "tipografica",
    variante: "frase",
    encaje: null,
    titularOpcional: true,
    admitidos: ["antetitulo", "titular", "cita", "pie"],
    limites: { antetitulo: 40, titular: 60, cita: 90, pie: 48 },
  },
];

export const PLANTILLAS_CT_EDITORIAL: readonly Plantilla[] = DEFS.map((d) => ({
  id: d.id,
  marca: "casa-tomas",
  nombre: d.nombre,
  descripcion: d.descripcion,
  formatos: ["post", "story"],
  obligatorios: d.encaje ? ["foto"] : [],
  ...(d.titularOpcional ? { titularOpcional: true } : {}),
  admitidos: d.admitidos,
  limites: d.limites,
  ...(d.encaje ? { encaje: d.encaje } : {}),
  papel: d.papel,
  html: (datos: DatosPieza, ctx: ContextoPlantilla) => html(d.variante, d.encaje, datos, ctx),
}));
