/**
 * CSS de las plantillas v2 de Casa Tomás (08/11/2026). Fuente: el sistema de
 * marca del dueño (instagram-studio/propuesta/marca-base): templates/
 * redes-posts.html (post del plato y post del lema), templates/video-9x16.html
 * y reel-kit.jsx (rótulo inferior con barra oro y cierre con logo, lema y CTA).
 *
 * Solo variables de marca (generarCss): ningún hex a mano.
 *
 * Criterios: la foto manda (sin velo entero, solo un degradado donde va el
 * texto), alineación a la izquierda, mucho aire y tamaños contrastados. El
 * cierre de marca sin foto es el post del lema del dueño, centrado tal cual.
 *
 * Ajuste (el motor lo comprueba): los textos con data-ajuste tienen caja
 * acotada (líneas máximas) o van en una línea (nowrap). Si no caben,
 * DESBORDAN y el motor da error: nada se encoge ni se recorta.
 */
import { degradado } from "../comun.js";

/** Titular en Baskerville: el aire de los glifos va como relleno (ver ct-foto-titular). */
const titular = (clase: string, px: number, lh: number, lineas: number, extra = "") => `
${clase} {
  font-size: ${px}px;
  line-height: ${lh};
  max-height: calc(${lh}em * ${lineas} + 2 * var(--aire) + 2px);
  ${extra}
}`;

export const CSS_CT_EDITORIAL = `
.cte {
  position: absolute;
  inset: 0;
  overflow: hidden;
  font-family: var(--fuente-texto);
  color: var(--color-pizarra);
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
  font-kerning: normal;
}
.cte p, .cte h1, .cte h2 { width: 100%; }

/* Un titular al final de su bloque no se sale por abajo con el aire de los glifos. */
.cte__titular:last-child { margin-bottom: 0 !important; }

/* ── Piezas comunes ─────────────────────────────────────────────────────── */
.cte__titular {
  --aire: 0.14em;
  padding-block: var(--aire);
  margin-block: calc(-1 * var(--aire));
  font-family: var(--fuente-titular);
  font-weight: var(--peso-titular);
  letter-spacing: -0.015em;
  text-wrap: balance;
  overflow-wrap: normal;
  hyphens: manual;
}
.cte__etiqueta {
  font-weight: var(--peso-antetitulo);
  font-size: 22px;
  line-height: 1.3;
  letter-spacing: var(--tracking-antetitulo);
  text-transform: uppercase;
  white-space: nowrap;
}
.cte__cita {
  font-style: italic;
  font-weight: var(--peso-texto);
  line-height: 1.4;
  max-height: calc(1.4em * 2 + 2px);
  text-wrap: pretty;
}
.cte__lema {
  font-style: var(--estilo-lema);
  font-weight: var(--peso-lema);
  text-wrap: pretty;
}
.cte__info {
  white-space: nowrap;
  line-height: 1.3;
}
.cte__info .sep { white-space: pre; }
.cte__logo { display: block; flex: none; width: auto; }
.cte__boton {
  display: inline-block;
  max-width: 100%;
  border-radius: var(--radio-boton);
  background: var(--color-boton-fondo);
  color: var(--color-boton-texto);
  font-weight: var(--peso-titular);
  line-height: 1.2;
  white-space: nowrap;
}
.cte__orbe {
  position: absolute;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-oro) 20%, transparent);
  pointer-events: none;
}

/* ── A sangre: foto, degradado donde va el texto y bloque abajo ─────────── */
.cte--sangre { background: var(--color-pizarra-oscura); color: var(--color-blanco); }
.cte__foto {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cte__degradado { position: absolute; left: 0; right: 0; bottom: 0; pointer-events: none; }
.cte__bloque {
  position: absolute;
  left: var(--margen);
  right: var(--margen);
  bottom: var(--margen);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.cte--story .cte__bloque { bottom: 320px; }
.cte--sangre .cte__titular,
.cte--sangre .cte__lema { text-shadow: 0 2px 28px color-mix(in srgb, var(--color-pizarra-oscura) 40%, transparent); }

/* Portada (post del plato del dueño): sello oro arriba, titular, cita, logo + info. */
.cte--portada .cte__degradado { height: 62%; background: ${degradado("--color-pizarra-oscura", 88)}; }
.cte__sello {
  position: absolute;
  top: var(--margen);
  left: var(--margen);
  width: auto !important;
  max-width: calc(100% - 2 * var(--margen));
  padding: 12px 28px 13px;
  border-radius: var(--radio-boton);
  background: var(--color-oro);
  color: var(--color-blanco);
  font-weight: var(--peso-lema);
  font-size: 28px;
  line-height: 1.2;
  white-space: nowrap;
}
.cte--story .cte__sello { top: var(--story-zona-segura-arriba); font-size: 30px; }
${titular(".cte--portada.cte--sangre .cte__titular", 88, 1.05, 3, "color: var(--color-blanco); max-width: 900px;")}
${titular(".cte--portada.cte--sangre.cte--story .cte__titular", 100, 1.05, 3)}
.cte--sangre .cte__cita { font-size: 34px; margin-top: 22px; color: color-mix(in srgb, var(--color-blanco) 86%, transparent); max-width: 860px; }
.cte--sangre.cte--story .cte__cita { font-size: 38px; }
.cte__firma {
  width: 100%;
  margin-top: 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
}
.cte__firma .cte__info { width: auto; flex: 0 1 auto; min-width: 0; }
.cte--sangre .cte__firma .cte__logo { height: 96px; }
.cte--sangre.cte--story .cte__firma .cte__logo { height: 112px; }
.cte__firma > .cte__info { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; text-align: right; }
.cte__info-cta, .cte__info-pie { white-space: nowrap; line-height: 1.3; }
.cte__info-cta { font-weight: var(--peso-lema); font-size: 24px; letter-spacing: 0.2em; text-transform: uppercase; }
.cte__info-pie { font-size: 21px; letter-spacing: 0.04em; }
.cte--sangre .cte__info-cta { color: var(--color-blanco); }
.cte--sangre .cte__info-pie { color: color-mix(in srgb, var(--color-blanco) 82%, transparent); }

/* Plato (interior): rótulo inferior con barra oro, como en los reels. */
.cte--plato .cte__degradado { height: 44%; background: ${degradado("--color-pizarra-oscura", 74)}; }
.cte__rotulo {
  position: absolute;
  left: var(--margen);
  right: var(--margen);
  bottom: var(--margen);
  display: flex;
  align-items: stretch;
  gap: 28px;
}
.cte--story .cte__rotulo { bottom: 360px; }
.cte__barra { flex: none; width: 5px; background: var(--color-oro); }
.cte__rotulo-textos {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 780px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding-block: 4px 12px;
}
.cte--sangre .cte__rotulo .cte__etiqueta { color: var(--color-oro-claro); margin-bottom: 16px; text-shadow: 0 1px 3px color-mix(in srgb, var(--color-pizarra-oscura) 80%, transparent), 0 0 16px color-mix(in srgb, var(--color-pizarra-oscura) 70%, transparent); }
${titular(".cte--plato.cte--sangre .cte__titular", 60, 1.08, 2, "color: var(--color-blanco);")}
${titular(".cte--plato.cte--sangre.cte--story .cte__titular", 72, 1.08, 2)}
.cte--plato.cte--sangre .cte__cita { font-size: 28px; margin-top: 14px; }
.cte--plato.cte--sangre.cte--story .cte__cita { font-size: 32px; }

/* Cierre con foto: logo, lema, botón e información, a la izquierda. */
.cte--cierre .cte__degradado { height: 74%; background: ${degradado("--color-pizarra-oscura", 92)}; }
.cte--cierre.cte--sangre .cte__logo { height: 150px; }
.cte--cierre.cte--sangre.cte--story .cte__logo { height: 170px; }
${titular(".cte--cierre .cte__titular", 50, 1.12, 2, "margin-top: calc(40px - var(--aire));")}
.cte--cierre .cte__lema { font-size: 40px; line-height: 1.42; max-height: calc(1.42em * 3 + 2px); max-width: 880px; margin-top: 36px; }
.cte--cierre .cte__titular + .cte__lema { margin-top: 22px; font-size: 34px; }
.cte--cierre .cte__boton { margin-top: 46px; padding: 22px 52px 23px; font-size: 30px; width: auto !important; }
.cte--cierre .cte__info { margin-top: 32px; font-size: 24px; letter-spacing: 0.04em; }
.cte--cierre.cte--sangre .cte__info { color: color-mix(in srgb, var(--color-blanco) 86%, transparent); }
.cte--cierre.cte--sangre.cte--story .cte__lema { font-size: 44px; }
.cte--cierre.cte--sangre.cte--story .cte__boton { font-size: 34px; padding: 26px 60px 27px; }
.cte--cierre.cte--sangre.cte--story .cte__info { font-size: 28px; }

/* ── Foto enmarcada: la foto entera arriba, el texto debajo a la izquierda ─ */
.cte--marco {
  display: flex;
  flex-direction: column;
  background: linear-gradient(168deg, var(--color-blanco) 0%, var(--color-papel) 52%, var(--color-arena) 100%);
}
.cte__marco { flex: none; display: flex; align-items: flex-start; }
.cte__foto-marco {
  display: block;
  /* Nunca se amplía: solo se reduce hasta caber (sin recorte). */
  max-width: 100%;
  max-height: var(--alto-foto);
  width: auto;
  height: auto;
  box-shadow: 0 30px 60px -34px color-mix(in srgb, var(--color-pizarra) 45%, transparent);
}
.cte__texto {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 60px var(--margen) var(--margen);
}
.cte--story .cte__texto { padding-bottom: 320px; }
.cte__texto > .cte__firma { margin-top: auto; padding-top: 32px; }
.cte--marco .cte__etiqueta { color: var(--color-oro-texto); margin-bottom: 22px; font-size: 24px; }
.cte--marco .cte__titular { color: var(--color-pizarra); }
.cte--marco .cte__cita { font-size: 30px; margin-top: 20px; color: color-mix(in srgb, var(--color-pizarra) 80%, transparent); max-width: 860px; }
.cte--marco .cte__firma .cte__logo { height: 88px; }
.cte--marco .cte__info-cta { font-size: 21px; color: var(--color-oro-texto); }
.cte--marco .cte__info-pie { color: var(--color-gris-medio); }

/* Portada enmarcada: la foto sale de la esquina de arriba a la izquierda y el titular manda abajo. */
.cte--portada.cte--marco .cte__marco { --alto-foto: 680px; justify-content: flex-start; padding-right: var(--margen); }
.cte--portada.cte--marco .cte__texto { padding-top: 54px; }
${titular(".cte--portada.cte--marco .cte__titular", 86, 1.05, 3)}
.cte--portada.cte--marco .cte__cita { font-size: 32px; }
.cte--portada.cte--marco.cte--story .cte__marco { --alto-foto: 860px; padding-top: 180px; }
${titular(".cte--portada.cte--marco.cte--story .cte__titular", 92, 1.05, 3)}

/* Plato enmarcado: foto que sale por la derecha y el nombre como pie de foto; el conjunto, centrado en alto. */
.cte--plato.cte--marco { justify-content: center; }
.cte--plato.cte--marco .cte__marco { --alto-foto: 760px; justify-content: flex-end; padding-left: var(--margen); }
.cte--plato.cte--marco .cte__texto { flex: none; padding: 46px var(--margen) 0; }
${titular(".cte--plato.cte--marco .cte__titular", 64, 1.08, 2)}
.cte--plato.cte--marco .cte__cita { font-size: 32px; margin-top: 16px; }
.cte--plato.cte--marco.cte--story .cte__marco { --alto-foto: 900px; }
${titular(".cte--plato.cte--marco.cte--story .cte__titular", 72, 1.08, 2)}

/* Cierre enmarcado: foto más pequeña arriba y, abajo, logo, lema y botón. */
.cte--cierre.cte--marco .cte__marco { --alto-foto: 640px; justify-content: flex-start; padding-right: 216px; }
.cte--cierre.cte--marco .cte__texto { justify-content: flex-end; padding-top: 48px; }
.cte--cierre.cte--marco .cte__logo { height: 150px; }
.cte--cierre.cte--marco .cte__lema { font-size: 40px; color: var(--color-pizarra); margin-top: 30px; max-height: calc(1.42em * 2 + 2px); }
.cte--cierre.cte--marco .cte__titular + .cte__lema { font-size: 32px; }
.cte--cierre.cte--marco .cte__boton { margin-top: 38px; }
.cte--cierre.cte--marco .cte__info { margin-top: 26px; color: var(--color-gris-medio); }
.cte--cierre.cte--marco.cte--story .cte__marco { --alto-foto: 760px; padding-top: 180px; padding-right: 144px; }
.cte--cierre.cte--marco.cte--story .cte__logo { height: 170px; }
.cte--cierre.cte--marco.cte--story .cte__lema { font-size: 44px; max-height: calc(1.42em * 3 + 2px); }

/* ── Cierre de marca (sin foto): el post del lema del dueño, tal cual ───── */
.cte--marca {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 120px;
  background: linear-gradient(135deg, var(--color-blanco), var(--color-piedra-clara) 50%, var(--color-blanco));
}
.cte--marca .cte__orbe { top: 120px; left: -120px; width: 600px; height: 600px; filter: blur(90px); }
.cte--marca > :not(.cte__orbe) { position: relative; }
.cte--marca .cte__logo { height: 260px; margin-bottom: 80px; }
${titular(".cte--marca .cte__titular", 54, 1.12, 2, "margin-bottom: calc(28px - var(--aire));")}
.cte--marca .cte__lema { font-size: 64px; line-height: 1.4; max-height: calc(1.4em * 4 + 2px); color: var(--color-pizarra); }
.cte--marca .cte__boton { margin-top: 64px; padding: 24px 64px 25px; font-size: 34px; width: auto !important; }
.cte--marca .cte__info {
  margin-top: 72px;
  font-weight: var(--peso-lema);
  font-size: 24px;
  letter-spacing: 0.25em;
  padding-left: 0.25em;
  text-transform: uppercase;
  color: var(--color-oro);
}
.cte--marca.cte--story { padding: var(--story-zona-segura-arriba) 100px 320px; }
.cte--marca.cte--story .cte__orbe { top: 300px; left: -160px; width: 700px; height: 700px; filter: blur(100px); }
.cte--marca.cte--story .cte__logo { height: 340px; margin-bottom: 70px; }
.cte--marca.cte--story .cte__lema { font-size: 54px; line-height: 1.45; max-height: calc(1.45em * 4 + 2px); color: color-mix(in srgb, var(--color-pizarra) 85%, transparent); }
.cte--marca.cte--story .cte__boton { margin-top: 80px; padding: 34px 80px 35px; font-size: 44px; }
.cte--marca.cte--story .cte__info { margin-top: 44px; font-weight: var(--peso-texto); font-size: 32px; letter-spacing: 0.02em; padding-left: 0; text-transform: none; color: var(--color-gris-medio); }

/* ── Frase (sin foto): asimétrica, la frase abajo a la izquierda ───────── */
.cte--frase {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--margen);
  background: linear-gradient(168deg, var(--color-blanco) 0%, var(--color-papel) 58%, var(--color-arena) 100%);
}
.cte--frase.cte--story { padding-top: var(--story-zona-segura-arriba); padding-bottom: 320px; }
.cte--frase .cte__orbe { top: -180px; right: -200px; width: 640px; height: 640px; filter: blur(110px); opacity: 0.8; }
.cte--frase > :not(.cte__orbe) { position: relative; }
.cte--frase .cte__etiqueta { color: var(--color-oro-texto); }
.cte__cuerpo { margin-top: auto; width: 100%; max-width: 900px; display: flex; flex-direction: column; align-items: flex-start; }
${titular(".cte--frase .cte__titular", 100, 1.05, 4)}
${titular(".cte--frase .cte__encabezado", 34, 1.2, 2, "margin-bottom: calc(30px - var(--aire)); color: var(--color-pizarra);")}
.cte--frase .cte__lema { font-size: 64px; line-height: 1.3; max-height: calc(1.3em * 4 + 2px); color: var(--color-pizarra); }
.cte--frase.cte--story .cte__lema { font-size: 72px; max-height: calc(1.3em * 5 + 2px); }
${titular(".cte--frase.cte--story .cte__titular", 112, 1.05, 5)}
.cte--frase .cte__firma { margin-top: 110px; justify-content: flex-start; gap: 22px; }
.cte--frase .cte__firma .cte__logo { height: 54px; }
.cte--frase .cte__firma .cte__info { font-size: 22px; letter-spacing: 0.04em; color: var(--color-gris-medio); }
`;
