/**
 * Story del jueves de tapas de Casa Tomás (12/11/2026, pedido del dueño: «que
 * se suba la historia a Instagram con las tapas cuando estén las tapas […] hay
 * que mantener las plantillas que tienen ahora y mejorarlas»). Dos plantillas,
 * solo story (1080×1920), papel «anuncio» (no salen en los selectores: las
 * montan el botón del menú de tapas y el automático, src/lib/instagram/tapas.ts).
 *
 *   ct-tapas-clasica  réplica de la story que publican hoy
 *                     (instagram-studio/propuesta/referencias-actuales/
 *                     story-jueves-de-tapas.jpg): foto de la sala oscurecida y
 *                     desenfocada, logo blanco arriba, «Jueves» grande en oro
 *                     claro, «DE TAPAS» en versalitas, filete oro corto y la
 *                     lista centrada en blanco, sin precios, en Montserrat.
 *   ct-tapas          la mejorada, mismo espíritu: Libre Baskerville y el oro
 *                     oficial (tokens.ts), velo más denso para el contraste,
 *                     fecha («Jueves 13 de noviembre»), todo dentro de la zona
 *                     segura de story del sistema de marca (220 arriba, 320
 *                     abajo, 64 a los lados; y la del motor, 250/250/72) y un
 *                     pie opcional con los turnos.
 *
 * Las dos ajustan el tamaño de la lista al número y largo de las tapas (de 4 a
 * 10): `medidasLista` busca el cuerpo más grande con el que la lista cabe en su
 * caja; la caja lleva data-ajuste, así que si aun así no cupiera el motor daría
 * error (nunca se recorta en silencio).
 *
 * Campos: titular = el día («Jueves»); antetitulo = «De tapas»; lista = las
 * tapas (solo etiqueta, sin precio); cita = la fecha («13 de noviembre», solo
 * la mejorada); pie = turnos u horario (solo la mejorada); foto = el fondo.
 */
import { esc, type ContextoPlantilla, type DatosPieza, type ElementoLista, type Plantilla } from "../../tipos.js";

/** Máximo de tapas que caben bien (y mínimo con el que se ha probado: 4). */
export const MAX_TAPAS = 10;
/** Caracteres por tapa: «Costillas desmechadas con pan bao y crema de guacamole» tiene 54. Además, todas juntas tienen que caber (medidasTapas → cabe). */
export const MAX_CARACTERES_TAPA = 70;

export interface OpcionesMedidas {
  /** Ancho útil de la lista (px). */
  ancho: number;
  /** Alto útil de la lista (px). */
  alto: number;
  /** Ancho medio de un carácter en ems (Montserrat ≈ 0,56; Libre Baskerville ≈ 0,55). */
  ratio: number;
  /** Interlineado (múltiplo del cuerpo). */
  interlineado: number;
  /** Separación entre tapas (múltiplo del cuerpo). */
  separacion: number;
  min: number;
  max: number;
}

/**
 * Cuerpo (px) y separación de la lista para que quepa: el más grande entre
 * `min` y `max` con el que la altura estimada no pasa del 92 % de la caja
 * (margen para el reparto real de las líneas). Se estima palabra a palabra.
 */
export function medidasLista(tapas: readonly string[], o: OpcionesMedidas): { cuerpo: number; separacion: number; lineas: number; cabe: boolean } {
  const lineasDe = (texto: string, cuerpo: number): number => {
    const ancho = (t: string) => [...t].length * o.ratio * cuerpo;
    let lineas = 1;
    let actual = 0;
    for (const palabra of texto.split(/\s+/).filter(Boolean)) {
      const w = ancho(palabra);
      const conEspacio = actual === 0 ? w : actual + o.ratio * cuerpo + w;
      if (conEspacio <= o.ancho) actual = conEspacio;
      else {
        lineas += 1;
        actual = w;
      }
    }
    return lineas;
  };
  for (let cuerpo = o.max; cuerpo >= o.min; cuerpo -= 1) {
    const lineas = tapas.reduce((n, t) => n + lineasDe(t, cuerpo), 0);
    const alto = lineas * cuerpo * o.interlineado + Math.max(0, tapas.length - 1) * cuerpo * o.separacion;
    if (alto <= o.alto * 0.92) return { cuerpo, separacion: Math.round(cuerpo * o.separacion), lineas, cabe: true };
  }
  const lineas = tapas.reduce((n, t) => n + lineasDe(t, o.min), 0);
  return { cuerpo: o.min, separacion: Math.round(o.min * o.separacion), lineas, cabe: false };
}

/** Medidas de la lista en cada plantilla (las mismas que usa su html). */
export function medidasTapas(plantilla: "ct-tapas" | "ct-tapas-clasica", tapas: readonly string[], conPie = false) {
  if (plantilla === "ct-tapas-clasica") {
    return medidasLista(tapas, { ancho: LISTA_CLASICA.ancho, alto: LISTA_CLASICA.abajo - LISTA_CLASICA.arriba, ratio: 0.56, interlineado: 1.6, separacion: 0.55, min: 28, max: 42 });
  }
  const finLista = conPie ? ABAJO - 92 : ABAJO;
  return medidasLista(tapas, { ancho: LISTA_MEJORADA.ancho, alto: finLista - LISTA_MEJORADA.arriba, ratio: 0.55, interlineado: 1.32, separacion: 0.62, min: 30, max: 54 });
}

function lista(elementos: readonly ElementoLista[] | undefined, clase: string): string {
  const items = (elementos ?? []).map((e) => `<li class="${clase}__tapa">${esc(e.etiqueta)}</li>`).join("");
  return `<ul class="${clase}__lista" data-campo="lista" data-ajuste>${items}</ul>`;
}

function fondo(datos: DatosPieza, ctx: ContextoPlantilla, clase: string): string {
  return `<img class="${clase}__foto" src="${esc(ctx.urlFoto(datos.foto ?? ""))}" alt=""><div class="${clase}__velo"></div>`;
}

const comun = {
  marca: "casa-tomas",
  formatos: ["story"],
  obligatorios: ["foto", "lista"],
  // Fondo desenfocado: no importa ampliar la foto, así que vale cualquiera con
  // el lado largo de 800 px o más (también las de la carta, 1200×900).
  encaje: "marco",
  papel: "anuncio",
} as const;

// ── Clásica ──────────────────────────────────────────────────────────────────

/**
 * Medidas sacadas de la captura (739 px de ancho → ×1,461): logo de ~290 px,
 * «Jueves» de ~112 px, «DE TAPAS» de ~40 px, filete de 130×3, lista de ~40 px
 * con interlineado 1,6 y ~60 px entre tapas. Oro claro muestreado de la
 * captura (no es un token: es el que usan hoy). La lista arranca donde en la
 * captura y termina en el límite de la zona segura del motor (1670).
 */
const LISTA_CLASICA = { arriba: 760, abajo: 1660, ancho: 900 };
const ORO_CLASICA = "#d2bf8e";

function cssClasica(ctx: ContextoPlantilla, cuerpo: number, separacion: number): string {
  const f = (peso: number, rango: "latin" | "latin-ext") =>
    esc(ctx.urlFuente ? ctx.urlFuente(`montserrat/montserrat-${rango}-${peso}-normal.woff2`) : `/instagram/fuentes/montserrat/montserrat-${rango}-${peso}-normal.woff2`);
  const caras = [300, 400]
    .flatMap((peso) =>
      (["latin", "latin-ext"] as const).map(
        (r) =>
          `@font-face{font-family:"CT Tapas Montserrat";font-style:normal;font-weight:${peso};font-display:block;src:url("${f(peso, r)}") format("woff2");unicode-range:${
            r === "latin"
              ? "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
              : "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"
          }}`,
      ),
    )
    .join("\n");
  return `${caras}
.ctt-c{position:absolute;inset:0;overflow:hidden;background:#1b1d1f;font-family:"CT Tapas Montserrat","Montserrat",sans-serif;color:#fff;text-align:center}
.ctt-c__foto{position:absolute;inset:-40px;width:calc(100% + 80px);height:calc(100% + 80px);object-fit:cover;filter:blur(7px) saturate(.85)}
.ctt-c__velo{position:absolute;inset:0;background:rgb(18 20 22 / .58)}
.ctt-c__logo{position:absolute;left:50%;top:170px;width:290px;transform:translateX(-50%)}
.ctt-c__titular{position:absolute;left:72px;right:72px;top:470px;font-weight:400;font-size:112px;line-height:1;letter-spacing:-.005em;color:${ORO_CLASICA};text-shadow:0 2px 10px rgb(0 0 0 / .35);white-space:nowrap}
.ctt-c__sub{position:absolute;left:72px;right:72px;top:590px;font-weight:400;font-size:40px;line-height:1.1;text-transform:uppercase;letter-spacing:.02em;color:${ORO_CLASICA};white-space:nowrap}
.ctt-c__filete{position:absolute;left:50%;top:688px;width:130px;height:3px;margin-left:-65px;background:${ORO_CLASICA};opacity:.9}
.ctt-c__lista{position:absolute;left:${(1080 - LISTA_CLASICA.ancho) / 2}px;width:${LISTA_CLASICA.ancho}px;top:${LISTA_CLASICA.arriba}px;height:${LISTA_CLASICA.abajo - LISTA_CLASICA.arriba}px;list-style:none;display:flex;flex-direction:column;justify-content:flex-start;align-items:center;gap:${separacion}px}
.ctt-c__tapa{font-weight:400;font-size:${cuerpo}px;line-height:1.6;text-shadow:0 1px 6px rgb(0 0 0 / .35);text-wrap:balance}
`;
}

export const ctTapasClasica: Plantilla = {
  ...comun,
  id: "ct-tapas-clasica",
  nombre: "Jueves de tapas (la de siempre)",
  descripcion:
    "Story del jueves de tapas tal como la publican: sala oscurecida y desenfocada, logo blanco, «Jueves» en oro, «DE TAPAS», filete y la lista de tapas en blanco, sin precios.",
  admitidos: ["foto", "antetitulo", "titular", "lista"],
  limites: { antetitulo: 20, titular: 12, lista: MAX_TAPAS },
  html(datos, ctx) {
    const tapas = (datos.lista ?? []).map((e) => e.etiqueta);
    const { cuerpo, separacion } = medidasTapas("ct-tapas-clasica", tapas);
    return `
<style>${cssClasica(ctx, cuerpo, separacion)}</style>
<div class="ctt-c">
  ${fondo(datos, ctx, "ctt-c")}
  <img class="ctt-c__logo" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">
  <h1 class="ctt-c__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
  ${datos.antetitulo ? `<p class="ctt-c__sub" data-campo="antetitulo" data-ajuste>${esc(datos.antetitulo)}</p>` : ""}
  <div class="ctt-c__filete" aria-hidden="true"></div>
  ${lista(datos.lista, "ctt-c")}
</div>`;
  },
};

// ── Mejorada ─────────────────────────────────────────────────────────────────

/** Zona segura de story del sistema de marca (video-9x16.html): 220 arriba, 320 abajo, 64 a los lados. */
export const ZONA_SEGURA_MARCA = { arriba: 220, abajo: 320, lados: 64 } as const;
const ABAJO = 1920 - ZONA_SEGURA_MARCA.abajo; // 1600
const LISTA_MEJORADA = { arriba: 800, ancho: 880 };

function cssMejorada(cuerpo: number, separacion: number, conPie: boolean): string {
  const finLista = conPie ? ABAJO - 92 : ABAJO;
  return `
.ctt{position:absolute;inset:0;overflow:hidden;background:var(--color-pizarra-oscura);font-family:var(--fuente-texto);color:var(--color-blanco);text-align:center}
.ctt__foto{position:absolute;inset:-48px;width:calc(100% + 96px);height:calc(100% + 96px);object-fit:cover;filter:blur(9px) saturate(.8) brightness(.9)}
.ctt__velo{position:absolute;inset:0;background:
  linear-gradient(to bottom, color-mix(in srgb, var(--color-pizarra-oscura) 72%, transparent) 0%, color-mix(in srgb, var(--color-pizarra-oscura) 80%, transparent) 38%, color-mix(in srgb, var(--color-pizarra-oscura) 86%, transparent) 100%)}
.ctt__logo{position:absolute;left:50%;top:256px;width:236px;transform:translateX(-50%)}
.ctt__cabecera{position:absolute;left:72px;right:72px;top:452px;display:flex;flex-direction:column;align-items:center}
.ctt__titular{font-family:var(--fuente-titular);font-weight:700;font-size:118px;line-height:1.02;letter-spacing:-.01em;color:var(--color-oro);white-space:nowrap}
.ctt__fecha{margin-top:18px;font-style:italic;font-weight:400;font-size:44px;line-height:1.2;color:rgb(255 255 255 / .92);white-space:nowrap}
.ctt__sub{margin-top:30px;display:flex;align-items:center;gap:22px;font-weight:700;font-size:30px;line-height:1.2;letter-spacing:.3em;text-transform:uppercase;color:var(--color-oro-claro);white-space:nowrap}
.ctt__sub::before,.ctt__sub::after{content:"";width:56px;height:2px;background:var(--color-oro)}
.ctt__sub::after{margin-left:-.3em}
.ctt__lista{position:absolute;left:${(1080 - LISTA_MEJORADA.ancho) / 2}px;width:${LISTA_MEJORADA.ancho}px;top:${LISTA_MEJORADA.arriba}px;height:${finLista - LISTA_MEJORADA.arriba}px;list-style:none;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:${separacion}px}
.ctt__tapa{font-weight:400;font-size:${cuerpo}px;line-height:1.32;text-wrap:balance;text-shadow:0 1px 8px rgb(0 0 0 / .45)}
.ctt__pie{position:absolute;left:72px;right:72px;top:${ABAJO - 52}px;font-weight:700;font-size:28px;line-height:1.3;letter-spacing:.18em;text-transform:uppercase;color:rgb(255 255 255 / .82);white-space:nowrap}
`;
}

export const ctTapas: Plantilla = {
  ...comun,
  id: "ct-tapas",
  nombre: "Jueves de tapas",
  descripcion:
    "Story del jueves de tapas mejorada: sala desenfocada con velo pizarra, logo, «Jueves» en Libre Baskerville y oro oficial con la fecha, «De tapas», de 4 a 10 tapas ajustando el tamaño y pie opcional con los turnos.",
  admitidos: ["foto", "antetitulo", "titular", "cita", "lista", "pie"],
  limites: { antetitulo: 20, titular: 12, cita: 30, lista: MAX_TAPAS, pie: 44 },
  html(datos, ctx) {
    const tapas = (datos.lista ?? []).map((e) => e.etiqueta);
    const conPie = !!datos.pie;
    const { cuerpo, separacion } = medidasTapas("ct-tapas", tapas, conPie);
    const fecha = datos.cita ? `<p class="ctt__fecha" data-campo="cita" data-ajuste>${esc(datos.cita)}</p>` : "";
    const sub = datos.antetitulo ? `<p class="ctt__sub" data-campo="antetitulo" data-ajuste>${esc(datos.antetitulo)}</p>` : "";
    const pie = conPie ? `<p class="ctt__pie" data-campo="pie" data-ajuste>${esc(datos.pie!)}</p>` : "";
    return `
<style>${cssMejorada(cuerpo, separacion, conPie)}</style>
<div class="ctt">
  ${fondo(datos, ctx, "ctt")}
  <img class="ctt__logo" src="${esc(ctx.urlLogo("logo", "blanco"))}" alt="Casa Tomás restaurante">
  <div class="ctt__cabecera">
    <h1 class="ctt__titular" data-campo="titular" data-ajuste>${esc(datos.titular)}</h1>
    ${fecha}
    ${sub}
  </div>
  ${lista(datos.lista, "ctt")}
  ${pie}
</div>`;
  },
};

export const PLANTILLAS_CT_TAPAS: readonly Plantilla[] = [ctTapas, ctTapasClasica];
