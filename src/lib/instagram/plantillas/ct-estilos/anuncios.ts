/**
 * Stories de anuncio de Casa Tomás CALCADAS de las originales
 * (referencias-actuales/alta, medidas en MEDIDAS.md). Solo story, foto a sangre.
 *
 *   ct-reserva-mesa    vosotros-reserva: «RESERVA MESA» y «en tu restaurante
 *                      favorito» en DM Sans espaciada, un filete de 3 × 692 px,
 *                      el HUECO del sticker de enlace y el logo abajo (medallón
 *                      en y = 1526). Todo 40 px más abajo que la original: allí
 *                      el titular empieza en y = 222, dentro de los 250 px que
 *                      tapa la interfaz de Instagram. La API no pone stickers
 *                      de enlace: se añade desde la app (lo dice la descripción).
 *   ct-touza-descubre  touza-descubre: logo pequeño arriba, «DESCUBRE» en DM
 *                      Sans 300 muy espaciada y «TOUZA» debajo, alineadas a la
 *                      derecha (x = 907). Pie opcional como touza-reserva:
 *                      «RESERVA TU MESA» y un filete de 3 × 228 px (67 px más
 *                      arriba que en la original, que se mete en la zona segura).
 *   ct-tapas-poster    jueves-4: foto oscurecida entera, «JUEVES DE» en
 *                      Montserrat 600 espaciada, «Tapas y cóctel» en Great
 *                      Vibes oro (#c2bd9d), «¡TE ESPERAMOS!» y el logo abajo.
 */
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";
import { CSS_BASE, DM_SANS, GREAT_VIBES, MONT, fotoSangre, fuentes, velo, type Cara } from "./base.js";
import { LOGO } from "./rotulos.js";

/** Hueco que deja ct-reserva-mesa para el sticker de enlace (px, story 1080×1920). */
export const HUECO_STICKER = { arriba: 495, alto: 70 } as const;
export const AVISO_STICKER =
  "La API de Instagram no pone stickers de enlace: al publicar esta story, añade el sticker «Enlace» con la web de reservas desde la app, en el hueco libre bajo el filete.";

const logoAbajo = (ctx: ContextoPlantilla, medallon: number) =>
  `<img class="cts__logo" style="position:absolute;left:50%;top:${medallon - LOGO.desfaseMedallon}px;width:${LOGO.ancho}px;transform:translateX(-50%)" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">`;

export const CARAS_RESERVA: readonly Cara[] = ["dm-300"];

function htmlReserva(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const sub = datos.cita ? `<p class="ctsv__sub" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
  return `<style>${fuentes(ctx, CARAS_RESERVA)}${CSS_BASE}
.ctsv{position:absolute;left:72px;right:72px;top:250px;display:flex;flex-direction:column;align-items:center;text-align:center;font-family:${DM_SANS};font-weight:300}
.ctsv__titular{align-self:stretch;font-size:58px;line-height:70px;letter-spacing:.14em;padding-left:.14em;text-transform:uppercase;white-space:nowrap}
.ctsv__sub{align-self:stretch;margin-top:-2px;font-size:57px;line-height:70px;letter-spacing:.13em;padding-left:.13em;white-space:nowrap}
.ctsv__filete{position:absolute;left:194px;width:692px;top:419px;height:3px;background:#fff}
</style>
<div class="cts cts--story">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  ${velo("arriba", 640, 22)}
  <div class="ctsv">
    <h1 class="ctsv__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
    ${sub}
  </div>
  <span class="ctsv__filete" aria-hidden="true"></span>
  ${logoAbajo(ctx, 1526)}
</div>`;
}

export const CARAS_TOUZA: readonly Cara[] = ["dm-300"];

function htmlTouza(datos: DatosPieza, ctx: ContextoPlantilla): string {
  // «DESCUBRE» (primera palabra) grande y «TOUZA» (el resto) debajo, más pequeña, a la derecha.
  const [primera, ...resto] = datos.titular.split(/\s+/);
  const titular = `<span class="ctsz__l1">${esc(primera ?? "")}</span>${resto.length ? `<br><span class="ctsz__l2">${esc(resto.join(" "))}</span>` : ""}`;
  const sub = datos.cita ? `<p class="ctsz__sub" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
  const pie = datos.pie ? `<p class="ctsz__pie" data-campo="pie" data-ajuste>${esc(datos.pie)}</p><span class="ctsz__filete" aria-hidden="true"></span>` : "";
  return `<style>${fuentes(ctx, CARAS_TOUZA)}${CSS_BASE}
.ctsz__logo{position:absolute;left:50%;top:118px;width:315px;transform:translateX(-50%)}
.ctsz{position:absolute;left:72px;right:154px;top:425px;font-family:${DM_SANS};font-weight:300;text-align:right}
.ctsz__titular{font-size:118px;line-height:126px;letter-spacing:.1em;text-transform:uppercase;overflow-wrap:normal;max-height:${126 * 2 + 8}px}

.ctsz__l2{font-size:103px;letter-spacing:.123em}
.ctsz__sub{margin-top:12px;font-style:italic;font-size:36px;line-height:1.3;max-height:calc(1.3em * 2 + 2px)}
.ctsz__pie{position:absolute;left:72px;right:72px;top:1598px;font-family:${DM_SANS};font-weight:300;font-size:58px;line-height:70px;letter-spacing:.14em;padding-left:.14em;text-transform:uppercase;text-align:center;white-space:nowrap}
.ctsz__filete{position:absolute;left:426px;width:228px;top:1688px;height:3px;background:#fff}
</style>
<div class="cts cts--story">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  ${velo("arriba", 760, 22)}
  <img class="cts__logo ctsz__logo" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">
  <div class="ctsz">
    <h1 class="ctsz__titular" data-campo="titular" data-ajuste>${titular}</h1>
    ${sub}
  </div>
  ${pie}
</div>`;
}

export const CARAS_POSTER: readonly Cara[] = ["mont-400", "mont-600", "greatvibes"];

function htmlPoster(datos: DatosPieza, ctx: ContextoPlantilla): string {
  // «Tapas y cóctel» en una línea: 168 px como la original; menos si el texto es más largo (Great Vibes ≈ 0,40 em por letra).
  const cuerpo = Math.max(110, Math.min(168, Math.floor(936 / (Math.max(1, [...datos.titular].length) * 0.4))));
  const ante = datos.antetitulo ? `<p class="ctsp__ante" data-campo="antetitulo" data-ajuste>${esc(datos.antetitulo)}</p>` : "";
  const pie = datos.pie ? `<p class="ctsp__pie" data-campo="pie" data-ajuste>${esc(datos.pie)}</p>` : "";
  return `<style>${fuentes(ctx, CARAS_POSTER)}${CSS_BASE}
.ctsp__velo{position:absolute;inset:0;background:rgb(0 0 0 / .55)}
.ctsp__ante{position:absolute;left:72px;right:72px;top:786px;font-family:${MONT};font-weight:600;font-size:70px;line-height:80px;letter-spacing:.345em;padding-left:.345em;text-transform:uppercase;text-align:center;white-space:nowrap}
.ctsp__titular{position:absolute;left:72px;right:72px;top:822px;font-family:${GREAT_VIBES};font-weight:400;font-size:${cuerpo}px;line-height:210px;color:#c2bd9d;text-align:center;white-space:nowrap}
.ctsp__pie{position:absolute;left:72px;right:72px;top:1036px;font-family:${MONT};font-weight:400;font-size:38px;line-height:46px;letter-spacing:.38em;padding-left:.38em;text-transform:uppercase;text-align:center;white-space:nowrap}
</style>
<div class="cts cts--story">
  ${fotoSangre(ctx.urlFoto(datos.foto ?? ""))}
  <div class="ctsp__velo" aria-hidden="true"></div>
  <h1 class="ctsp__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
  ${ante}
  ${pie}
  ${logoAbajo(ctx, 1511)}
</div>`;
}

const comun = { marca: "casa-tomas", formatos: ["story"], obligatorios: ["foto"], encaje: "sangre" } as const;

export const PLANTILLAS_ANUNCIOS: readonly Plantilla[] = [
  {
    ...comun,
    id: "ct-reserva-mesa",
    nombre: "Reserva mesa",
    descripcion: `Story «RESERVA MESA / en tu restaurante favorito» con un filete, el logo abajo y un hueco libre para el sticker de enlace. ${AVISO_STICKER}`,
    papel: "cierre",
    admitidos: ["foto", "titular", "cita"],
    limites: { titular: 16, cita: 26 },
    html: htmlReserva,
  },
  {
    ...comun,
    id: "ct-touza-descubre",
    nombre: "Descubre Touza",
    descripcion:
      "Story de Casa Tomás que lleva a Touza: logo de Casa Tomás arriba, «DESCUBRE / TOUZA» en mayúsculas finas espaciadas a la derecha sobre la foto, y abajo, opcional, «RESERVA TU MESA» con un filete.",
    papel: "portada",
    admitidos: ["foto", "titular", "cita", "pie"],
    limites: { titular: 16, cita: 50, pie: 16 },
    html: htmlTouza,
  },
  {
    ...comun,
    id: "ct-tapas-poster",
    nombre: "Jueves de tapas (póster)",
    descripcion: "El póster del jueves de tapas: foto oscurecida, «JUEVES DE» en mayúsculas espaciadas, «Tapas y cóctel» en letra manuscrita oro, «¡TE ESPERAMOS!» y el logo abajo.",
    papel: "portada",
    admitidos: ["foto", "antetitulo", "titular", "pie"],
    limites: { antetitulo: 10, titular: 16, pie: 16 },
    html: htmlPoster,
  },
];
