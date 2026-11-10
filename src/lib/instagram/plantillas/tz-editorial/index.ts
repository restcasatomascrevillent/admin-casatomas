/**
 * Plantillas v2 de Touza (08/11/2026), con el sistema de marca del dueño.
 *
 *   tz-portada         portada a sangre: TOUZA pequeño arriba; abajo, etiqueta
 *                      oro, titular grande en Cormorant y frase en Montserrat.
 *   tz-portada-marco   portada con la foto entera (radio 24 px) y texto debajo.
 *   tz-plato           interior a sangre: el rótulo inferior del vídeo del
 *                      dueño (etiqueta → nombre → detalle → raya oro).
 *   tz-plato-marco     interior con la foto entera, que sale por la derecha.
 *   tz-cierre          última imagen a sangre: el post de Touza del dueño
 *                      (línea arriba, etiqueta, TOUZA enorme, frase) + botón.
 *   tz-cierre-marco    última imagen con la foto entera.
 *   tz-cierre-marca    cierre sin foto: la intro del vídeo (TOUZA enorme) con
 *                      frase, botón e información.
 *   tz-frase           sin foto: una frase o un anuncio, asimétrica.
 *
 * Touza no admite reservas: el botón nunca es «Reservar» (lo vigilan los
 * validadores de la IA; aquí no se pone ninguno por defecto).
 */
import { esc, type ContextoPlantilla, type DatosPieza, type EncajeFoto, type PapelPlantilla, type Plantilla } from "../../tipos.js";
import { campo, lineaInfo } from "../comun.js";
import { CSS_TZ_EDITORIAL } from "./estilos.js";

export const INFO_TOUZA = "@touzabar · Crevillent";
/** Frase de marca de Touza (brand-voice.html). */
export const FRASE_TOUZA = "Touza no es solo un bar; es una declaración de intenciones.";

type Variante = "portada" | "plato" | "cierre" | "marca" | "frase";

const MARCA = (clase = "tze__marca") => `<div class="${clase}" aria-label="Touza">TOUZA</div>`;

function foto(datos: DatosPieza, ctx: ContextoPlantilla, encaje: EncajeFoto): string {
  const url = esc(ctx.urlFoto(datos.foto ?? ""));
  return encaje === "sangre"
    ? `<img class="tze__foto" src="${url}" alt="">`
    : `<div class="tze__marco"><img class="tze__foto-marco" src="${url}" alt=""></div>`;
}

function html(variante: Variante, encaje: EncajeFoto | null, datos: DatosPieza, ctx: ContextoPlantilla): string {
  const story = datos.formato === "story";
  const clases = ["tze", `tze--${variante}`, encaje ? `tze--${encaje}` : "", `tze--${story ? "story" : "post"}`].filter(Boolean).join(" ");
  const etiqueta = campo("p", "tze__etiqueta", "antetitulo", datos.antetitulo);
  const titular = campo("h1", "tze__titular", "titular", datos.titular);
  let cuerpo = "";

  if (variante === "portada") {
    const cita = campo("p", "tze__cita", "cita", datos.cita);
    const info = lineaInfo("tze__info", datos.cta, datos.pie);
    cuerpo =
      encaje === "sangre"
        ? `${foto(datos, ctx, "sangre")}<div class="tze__degradado tze__degradado--arriba"></div><div class="tze__degradado tze__degradado--abajo"></div>${MARCA()}
<div class="tze__bloque">${etiqueta}${titular}${cita}${info}</div>`
        : `${foto(datos, ctx, "marco")}
<div class="tze__texto">${etiqueta}${titular}${cita}<div class="tze__firma">${MARCA()}${info}</div></div>`;
  } else if (variante === "plato") {
    const cita = campo("p", "tze__cita", "cita", datos.cita);
    const raya = `<span class="tze__raya" aria-hidden="true"></span>`;
    cuerpo =
      encaje === "sangre"
        ? `${foto(datos, ctx, "sangre")}<div class="tze__degradado tze__degradado--abajo"></div>
<div class="tze__bloque">${etiqueta}${titular}${cita}${raya}</div>`
        : `${foto(datos, ctx, "marco")}<div class="tze__texto">${etiqueta}${titular}${cita}${raya}</div>`;
  } else if (variante === "cierre") {
    const boton = campo("span", "tze__boton", "cta", datos.cta);
    const pie = datos.pie ?? INFO_TOUZA;
    if (encaje === "sangre") {
      cuerpo = `${foto(datos, ctx, "sangre")}<div class="tze__degradado tze__degradado--arriba"></div><div class="tze__degradado tze__degradado--abajo"></div>
${campo("p", "tze__arriba", "pie", pie)}
<div class="tze__bloque">${etiqueta}${MARCA()}${titular}${campo("p", "tze__cita", "cita", datos.cita)}${boton}</div>`;
    } else {
      cuerpo = `${foto(datos, ctx, "marco")}
<div class="tze__texto">${MARCA()}${titular}${campo("p", "tze__frase", "cita", datos.cita)}${boton}${campo("p", "tze__info", "pie", pie)}</div>`;
    }
  } else if (variante === "marca") {
    const pie = datos.pie ?? INFO_TOUZA;
    cuerpo = `${etiqueta}${MARCA()}${titular}${campo("p", "tze__frase", "cita", datos.cita)}${campo("span", "tze__boton", "cta", datos.cta)}${campo("p", "tze__info", "pie", pie)}`;
  } else {
    const pie = datos.pie ?? "@touzabar";
    const frase = datos.cita
      ? `${campo("h2", "tze__titular tze__encabezado", "titular", datos.titular)}${campo("p", "tze__frase", "cita", datos.cita)}`
      : titular;
    cuerpo = `${etiqueta}<div class="tze__cuerpo">${frase}</div><div class="tze__firma">${MARCA()}${campo("p", "tze__info", "pie", pie)}</div>`;
  }
  return `<style>${CSS_TZ_EDITORIAL}</style>\n<div class="${clases}">\n${cuerpo}\n</div>`;
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
    id: "tz-portada",
    nombre: "Touza · Portada",
    descripcion: "Primera imagen (o post suelto): foto a sangre con degradado abajo, TOUZA pequeño arriba, etiqueta oro, titular grande en Cormorant, frase y «botón · pie» opcionales.",
    papel: "portada",
    variante: "portada",
    encaje: "sangre",
    admitidos: ["foto", "antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 30, titular: 36, cita: 80, cta: 22, pie: 30 },
  },
  {
    id: "tz-portada-marco",
    nombre: "Touza · Portada · Foto enmarcada",
    descripcion: "Primera imagen con la foto entera y sin ampliar, con radio de 24 px: debajo, etiqueta, titular, frase y TOUZA con el pie.",
    papel: "portada",
    variante: "portada",
    encaje: "marco",
    admitidos: ["foto", "antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 30, titular: 36, cita: 70, cta: 22, pie: 30 },
  },
  {
    id: "tz-plato",
    nombre: "Touza · Cóctel o plato (interior)",
    descripcion: "Imagen del medio del carrusel: la foto limpia y el rótulo inferior del vídeo (etiqueta oro, nombre, detalle y raya oro). Sin marca ni botón.",
    papel: "plato",
    variante: "plato",
    encaje: "sangre",
    admitidos: ["foto", "antetitulo", "titular", "cita"],
    limites: { antetitulo: 30, titular: 32, cita: 64 },
  },
  {
    id: "tz-plato-marco",
    nombre: "Touza · Cóctel o plato · Foto enmarcada",
    descripcion: "Imagen del medio con la foto entera, que sale por la derecha; debajo, el nombre y el detalle con la raya oro.",
    papel: "plato",
    variante: "plato",
    encaje: "marco",
    admitidos: ["foto", "antetitulo", "titular", "cita"],
    limites: { antetitulo: 30, titular: 36, cita: 70 },
  },
  {
    id: "tz-cierre",
    nombre: "Touza · Cierre con foto",
    descripcion: "Última imagen: el post de Touza del sistema de marca (línea arriba, etiqueta oro, TOUZA enorme y frase) con botón opcional. Nunca «Reservar».",
    papel: "cierre",
    variante: "cierre",
    encaje: "sangre",
    titularOpcional: true,
    admitidos: ["foto", "antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 30, titular: 36, cita: 90, cta: 22, pie: 34 },
  },
  {
    id: "tz-cierre-marco",
    nombre: "Touza · Cierre · Foto enmarcada",
    descripcion: "Última imagen con la foto entera: debajo, TOUZA, la frase en cursiva, el botón y el pie.",
    papel: "cierre",
    variante: "cierre",
    encaje: "marco",
    titularOpcional: true,
    admitidos: ["foto", "titular", "cita", "cta", "pie"],
    limites: { titular: 36, cita: 70, cta: 22, pie: 40 },
  },
  {
    id: "tz-cierre-marca",
    nombre: "Touza · Cierre de marca (sin foto)",
    descripcion: "Sin foto: etiqueta espaciada, TOUZA enorme, frase en cursiva, botón e información (la intro y el cierre de los vídeos del sistema de marca).",
    papel: "cierre",
    variante: "marca",
    encaje: null,
    titularOpcional: true,
    admitidos: ["antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 28, titular: 36, cita: 80, cta: 22, pie: 40 },
  },
  {
    id: "tz-frase",
    nombre: "Touza · Frase (sin foto)",
    descripcion: "Una frase o un anuncio sin foto sobre negro, alineado a la izquierda: etiqueta arriba, la frase grande abajo y TOUZA con el pie.",
    papel: "tipografica",
    variante: "frase",
    encaje: null,
    titularOpcional: true,
    admitidos: ["antetitulo", "titular", "cita", "pie"],
    limites: { antetitulo: 36, titular: 40, cita: 90, pie: 30 },
  },
];

export const PLANTILLAS_TZ_EDITORIAL: readonly Plantilla[] = DEFS.map((d) => ({
  id: d.id,
  marca: "touza",
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
