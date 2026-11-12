/**
 * Stories de anuncio de Casa Tomás copiadas de lo que publican (12/11/2026).
 * Solo story, foto a sangre.
 *
 *   ct-reserva-mesa    «RESERVA MESA / en tu restaurante favorito» arriba, un
 *                      HUECO libre debajo para el sticker de enlace y el logo
 *                      abajo (destacada «Vosotros»). La API de Instagram no
 *                      pone stickers de enlace: hay que añadirlo desde la app
 *                      al publicar (lo dice la descripción).
 *   ct-touza-descubre  story de Casa Tomás que promociona Touza (destacada
 *                      «TOUZA»): logo de Casa Tomás arriba y «DESCUBRE TOUZA»
 *                      en mayúsculas finas espaciadas sobre la foto.
 *   ct-tapas-poster    el estilo B del jueves de tapas (que no estaba): «JUEVES
 *                      DE» en mayúsculas espaciadas, «Tapas y cóctel» en la
 *                      manuscrita en oro, «¡TE ESPERAMOS!» y el logo abajo.
 */
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";
import { CSS_BASE, MANUSCRITA, SANS, fotoSangre, fuentes, velo, type Cara } from "./base.js";

/** Hueco que deja ct-reserva-mesa para el sticker de enlace (px, story 1080×1920). */
export const HUECO_STICKER = { arriba: 560, alto: 170 } as const;
export const AVISO_STICKER =
  "La API de Instagram no pone stickers de enlace: al publicar esta story, añade el sticker «Enlace» con la web de reservas desde la app, en el hueco libre bajo el texto.";

export const CARAS_RESERVA: readonly Cara[] = ["sans-400"];

function htmlReserva(datos: DatosPieza, ctx: ContextoPlantilla): string {
  // En una línea: el cuerpo baja con el largo (Montserrat 400 en mayúsculas ≈ 0,74 em + 0,3 em de espaciado).
  const cuerpo = Math.max(40, Math.min(58, Math.floor(900 / (Math.max(1, [...datos.titular].length) * 1.04))));
  const sub = datos.cita ? `<p class="ctsv__sub" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
  return `<style>${fuentes(ctx, CARAS_RESERVA)}${CSS_BASE}
.ctsv{position:absolute;left:72px;right:72px;top:300px;display:flex;flex-direction:column;align-items:center;text-align:center}
.ctsv__titular{align-self:stretch;font-family:${SANS};font-weight:400;font-size:${cuerpo}px;line-height:1.2;letter-spacing:.3em;padding-left:.3em;text-transform:uppercase;white-space:nowrap}
.ctsv__sub{align-self:stretch;margin-top:14px;font-style:italic;font-size:38px;line-height:1.3;white-space:nowrap;color:rgb(255 255 255 / .94)}
.ctsv__logo{position:absolute;left:50%;bottom:290px;width:230px;transform:translateX(-50%)}
</style>
<div class="cts cts--story">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  ${velo("arriba", 900, 62)}
  ${velo("abajo", 600, 55)}
  <div class="ctsv">
    <h1 class="ctsv__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
    ${sub}
  </div>
  <img class="cts__logo ctsv__logo" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">
</div>`;
}

export const CARAS_TOUZA: readonly Cara[] = ["sans-300", "sans-400"];

function htmlTouza(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const sub = datos.cita ? `<p class="ctsz__sub" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
  const pie = datos.pie ? `<p class="ctsz__pie" data-campo="pie" data-ajuste>${esc(datos.pie)}</p>` : "";
  return `<style>${fuentes(ctx, CARAS_TOUZA)}${CSS_BASE}
.ctsz__logo{position:absolute;left:50%;top:290px;width:250px;transform:translateX(-50%)}
.ctsz{position:absolute;left:72px;right:72px;top:530px;display:flex;flex-direction:column;align-items:center;text-align:center}
.ctsz__titular{font-family:${SANS};font-weight:300;font-size:82px;line-height:1.22;letter-spacing:.24em;padding-left:.24em;text-transform:uppercase;max-height:calc(1.22em * 2 + 2px);text-wrap:balance;overflow-wrap:normal}
.ctsz__sub{margin-top:20px;font-style:italic;font-size:36px;line-height:1.3;max-width:800px;max-height:calc(1.3em * 2 + 2px);color:rgb(255 255 255 / .94);text-wrap:balance}
.ctsz__pie{position:absolute;left:72px;right:72px;bottom:300px;font-family:${SANS};font-weight:400;font-size:28px;line-height:1.3;letter-spacing:.28em;padding-left:.28em;text-transform:uppercase;text-align:center;white-space:nowrap}
</style>
<div class="cts cts--story">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  ${velo("arriba", 1020, 64)}
  ${datos.pie ? velo("abajo", 520, 55) : ""}
  <img class="cts__logo ctsz__logo" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">
  <div class="ctsz">
    <h1 class="ctsz__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
    ${sub}
  </div>
  ${pie}
</div>`;
}

export const CARAS_POSTER: readonly Cara[] = ["sans-400", "sans-600", "manuscrita"];

function htmlPoster(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const ante = datos.antetitulo ? `<p class="ctsp__ante" data-campo="antetitulo" data-ajuste>${esc(datos.antetitulo)}</p>` : "";
  const pie = datos.pie ? `<p class="ctsp__pie" data-campo="pie" data-ajuste>${esc(datos.pie)}</p>` : "";
  // Banda oscura SOLO detrás del texto (centro de la story), suave arriba y abajo.
  const banda = [0, 0.35, 0.78, 0.92, 0.92, 0.78, 0.35, 0]
    .map((k, i, a) => `color-mix(in srgb, var(--color-pizarra-oscura) ${Math.round(78 * k)}%, transparent) ${Math.round((i * 100) / (a.length - 1))}%`)
    .join(", ");
  return `<style>${fuentes(ctx, CARAS_POSTER)}${CSS_BASE}
.ctsp__banda{position:absolute;left:0;right:0;top:470px;height:880px;background:linear-gradient(to bottom, ${banda})}
.ctsp{position:absolute;left:72px;right:72px;top:640px;display:flex;flex-direction:column;align-items:center;text-align:center}
.ctsp__ante{align-self:stretch;font-family:${SANS};font-weight:600;font-size:66px;line-height:1.2;letter-spacing:.3em;padding-left:.3em;text-transform:uppercase;white-space:nowrap}
.ctsp__titular{margin-top:10px;font-family:${MANUSCRITA};font-style:italic;font-weight:400;font-size:150px;line-height:1;padding-block:.06em;color:var(--color-oro-claro);max-height:calc(1em * 2 + .12em + 2px);text-wrap:balance;overflow-wrap:normal}
.ctsp__pie{align-self:stretch;margin-top:22px;font-family:${SANS};font-weight:400;font-size:32px;line-height:1.3;letter-spacing:.3em;padding-left:.3em;text-transform:uppercase;white-space:nowrap}
.ctsp__logo{position:absolute;left:50%;bottom:290px;width:230px;transform:translateX(-50%)}
</style>
<div class="cts cts--story">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  <div class="ctsp__banda" aria-hidden="true"></div>
  ${velo("abajo", 560, 55)}
  <div class="ctsp">
    ${ante}
    <h1 class="ctsp__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
    ${pie}
  </div>
  <img class="cts__logo ctsp__logo" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">
</div>`;
}

const comun = { marca: "casa-tomas", formatos: ["story"], obligatorios: ["foto"], encaje: "sangre" } as const;

export const PLANTILLAS_ANUNCIOS: readonly Plantilla[] = [
  {
    ...comun,
    id: "ct-reserva-mesa",
    nombre: "Reserva mesa",
    descripcion: `Story «RESERVA MESA / en tu restaurante favorito» con el logo abajo y un hueco libre para el sticker de enlace. ${AVISO_STICKER}`,
    papel: "cierre",
    admitidos: ["foto", "titular", "cita"],
    limites: { titular: 16, cita: 32 },
    html: htmlReserva,
  },
  {
    ...comun,
    id: "ct-touza-descubre",
    nombre: "Descubre Touza",
    descripcion: "Story de Casa Tomás que lleva a Touza: logo de Casa Tomás arriba, «DESCUBRE TOUZA» en mayúsculas finas espaciadas sobre la foto, una frase y un pie opcionales.",
    papel: "portada",
    admitidos: ["foto", "titular", "cita", "pie"],
    limites: { titular: 22, cita: 60, pie: 34 },
    html: htmlTouza,
  },
  {
    ...comun,
    id: "ct-tapas-poster",
    nombre: "Jueves de tapas (póster)",
    descripcion: "El póster del jueves de tapas: «JUEVES DE» en mayúsculas espaciadas, «Tapas y cóctel» en letra manuscrita oro, «¡TE ESPERAMOS!» y el logo abajo, sobre la foto entera.",
    papel: "portada",
    admitidos: ["foto", "antetitulo", "titular", "pie"],
    limites: { antetitulo: 14, titular: 20, pie: 22 },
    html: htmlPoster,
  },
];
