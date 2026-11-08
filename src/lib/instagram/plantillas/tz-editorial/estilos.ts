/**
 * CSS de las plantillas v2 de Touza (08/11/2026). Fuente: el sistema de marca
 * del dueño (instagram-studio/propuesta/marca-base): el post de Touza de
 * templates/redes-posts.html (etiqueta oro, TOUZA enorme, frase en Montserrat
 * light, horario arriba), los fotogramas de templates/video-9x16.html (rótulo
 * inferior: etiqueta oro → nombre → ingredientes → raya oro de 120 px) y el
 * cierre de reel-kit.jsx.
 *
 * Solo variables de marca. Cormorant Garamond en titulares y TOUZA,
 * Montserrat light en textos y etiquetas. Las imágenes enmarcadas llevan el
 * radio de 24 px de las imágenes grandes de Touza.
 *
 * Ajuste: como en Casa Tomás, cajas acotadas o una línea; si no cabe, desborda
 * y el motor da error.
 */
import { degradado } from "../comun.js";

const titular = (clase: string, px: number, lh: number, lineas: number, extra = "") => `
${clase} {
  font-size: ${px}px;
  line-height: ${lh};
  max-height: calc(${lh}em * ${lineas} + 2 * var(--aire) + 2px);
  ${extra}
}`;

export const CSS_TZ_EDITORIAL = `
.tze {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--color-negro);
  color: var(--color-crema);
  font-family: var(--fuente-texto);
  font-weight: var(--peso-texto);
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
  font-kerning: normal;
}
.tze p, .tze h1, .tze h2 { width: 100%; }

/* Un titular al final de su bloque no se sale por abajo con el aire de los glifos. */
.tze__titular:last-child { margin-bottom: 0 !important; }

/* ── Piezas comunes ─────────────────────────────────────────────────────── */
.tze__titular {
  --aire: 0.12em;
  padding-block: var(--aire);
  margin-block: calc(-1 * var(--aire));
  font-family: var(--fuente-titular);
  font-weight: var(--peso-titular);
  letter-spacing: -0.01em;
  color: var(--color-crema);
  text-wrap: balance;
  overflow-wrap: normal;
  hyphens: manual;
}
.tze__etiqueta {
  font-weight: var(--peso-antetitulo);
  font-size: 24px;
  line-height: 1.3;
  letter-spacing: var(--tracking-antetitulo);
  text-transform: uppercase;
  color: var(--color-oro);
  white-space: nowrap;
}
.tze__cita {
  font-weight: var(--peso-texto);
  font-size: 32px;
  line-height: 1.5;
  max-height: calc(1.5em * 2 + 2px);
  color: color-mix(in srgb, var(--color-blanco) 80%, transparent);
  text-wrap: pretty;
}
.tze__frase {
  font-family: var(--fuente-titular);
  font-style: italic;
  font-weight: 400;
  color: var(--color-crema);
  text-wrap: pretty;
}
.tze__info {
  white-space: nowrap;
  line-height: 1.3;
  font-weight: var(--peso-antetitulo);
  font-size: 21px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--color-crema) 70%, transparent);
}
.tze__info { display: flex; flex-direction: column; gap: 8px; }
.tze__info-cta, .tze__info-pie { white-space: nowrap; line-height: 1.3; }
.tze__info-cta { font-weight: var(--peso-antetitulo); font-size: 21px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--color-crema); }
.tze__info-pie { font-weight: var(--peso-texto); font-size: 22px; letter-spacing: 0.04em; color: color-mix(in srgb, var(--color-crema) 70%, transparent); }
.tze__firma .tze__info { align-items: flex-end; text-align: right; }
.tze__marca {
  font-family: var(--fuente-titular);
  font-weight: var(--peso-wordmark);
  letter-spacing: var(--tracking-wordmark);
  line-height: 0.85;
  color: var(--color-oro);
  white-space: nowrap;
}
.tze__boton {
  display: inline-block;
  width: auto !important;
  max-width: 100%;
  border-radius: var(--radio-boton);
  background: var(--color-boton-fondo);
  color: var(--color-boton-texto);
  font-weight: var(--peso-antetitulo);
  line-height: 1.2;
  white-space: nowrap;
}
.tze__raya { display: block; width: 120px; height: 2px; background: var(--color-oro); flex: none; }

/* ── A sangre ───────────────────────────────────────────────────────────── */
.tze__foto { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.tze__degradado { position: absolute; left: 0; right: 0; pointer-events: none; }
.tze__degradado--abajo { bottom: 0; }
.tze__degradado--arriba { top: 0; }
.tze__bloque {
  position: absolute;
  left: var(--margen);
  right: var(--margen);
  bottom: var(--margen);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.tze--story .tze__bloque { bottom: 320px; }
.tze--sangre .tze__titular { text-shadow: 0 4px 30px color-mix(in srgb, var(--color-negro) 45%, transparent); }
/* Etiqueta y frase sobre foto: un halo negro suave para que se lean sobre zonas con luz (botellas, reflejos). */
.tze--sangre .tze__etiqueta, .tze--sangre .tze__cita { text-shadow: 0 1px 3px color-mix(in srgb, var(--color-negro) 80%, transparent), 0 0 18px color-mix(in srgb, var(--color-negro) 70%, transparent); }

/* Portada: TOUZA pequeño arriba; abajo, etiqueta, titular grande y frase. */
.tze--portada .tze__degradado--abajo { height: 74%; background: ${degradado("--color-negro", 94)}; }
.tze--portada .tze__degradado--arriba { height: 260px; background: ${degradado("--color-negro", 50, "to bottom")}; }
.tze--portada.tze--sangre > .tze__marca { position: absolute; top: var(--margen); left: var(--margen); font-size: 46px; }
.tze--portada.tze--sangre.tze--story > .tze__marca { top: var(--story-zona-segura-arriba); font-size: 52px; }
.tze--portada .tze__degradado--arriba + .tze__marca { width: auto; }
.tze--sangre .tze__bloque > .tze__etiqueta { margin-bottom: 22px; }
${titular(".tze--portada.tze--sangre .tze__titular", 124, 0.96, 3, "max-width: 900px;")}
${titular(".tze--portada.tze--sangre.tze--story .tze__titular", 138, 0.96, 3)}
.tze--portada.tze--sangre .tze__cita { margin-top: 26px; max-width: 820px; }
.tze--portada .tze__info { margin-top: 40px; }

/* Plato / cóctel (interior): el rótulo inferior del vídeo del dueño. */
.tze--plato .tze__degradado--abajo { height: 48%; background: ${degradado("--color-negro", 82)}; }
.tze--plato .tze__bloque { right: 200px; }
.tze--plato.tze--story .tze__bloque { bottom: 360px; }
${titular(".tze--plato.tze--sangre .tze__titular", 88, 1, 2, "color: var(--color-blanco);")}
${titular(".tze--plato.tze--sangre.tze--story .tze__titular", 104, 1, 2)}
.tze--plato .tze__titular + .tze__cita { margin-top: 14px; }
.tze--plato .tze__raya { margin-top: 34px; }

/* Cierre con foto: el post de Touza del dueño (horario arriba, TOUZA enorme), centrado. */
.tze--cierre.tze--sangre .tze__degradado--abajo { height: 84%; background: ${degradado("--color-negro", 95)}; }
.tze--cierre.tze--sangre .tze__degradado--arriba { height: 300px; background: ${degradado("--color-negro", 62, "to bottom")}; }
.tze--cierre.tze--sangre .tze__arriba {
  position: absolute;
  width: auto;
  top: var(--margen);
  left: var(--margen);
  right: var(--margen);
  text-align: center;
  font-weight: var(--peso-texto);
  font-size: 22px;
  letter-spacing: 0.35em;
  padding-left: 0.35em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--color-crema) 66%, transparent);
  white-space: nowrap;
}
.tze--cierre.tze--sangre.tze--story .tze__arriba { top: var(--story-zona-segura-arriba); font-size: 24px; }
.tze--cierre.tze--sangre .tze__bloque { align-items: center; text-align: center; bottom: 80px; }
.tze--cierre.tze--sangre.tze--story .tze__bloque { bottom: 320px; }
.tze--cierre.tze--sangre .tze__etiqueta { font-size: 26px; padding-left: 0.3em; text-shadow: 0 2px 18px var(--color-negro), 0 0 6px var(--color-negro); }
/* Como el post de Touza del dueño (foto al 75 %): la foto un poco apagada para que TOUZA y la etiqueta se lean. */
.tze--cierre.tze--sangre .tze__foto { opacity: 0.8; }
.tze--cierre.tze--sangre .tze__cita { text-shadow: 0 2px 20px var(--color-negro); }
.tze--cierre.tze--sangre .tze__bloque > .tze__marca { font-size: 240px; letter-spacing: -0.05em; color: var(--color-blanco); margin: 26px 0 22px; }
.tze--cierre.tze--sangre.tze--story .tze__bloque > .tze__marca { font-size: 280px; }
${titular(".tze--cierre .tze__titular, .tze--marca .tze__titular", 56, 1.05, 2, "margin-bottom: calc(14px - var(--aire));")}
.tze--cierre.tze--sangre .tze__cita { font-size: 34px; max-width: 860px; }
.tze--cierre .tze__boton { margin-top: 42px; padding: 22px 52px 23px; font-size: 26px; letter-spacing: 0.04em; }

/* ── Foto enmarcada (radio 24 px), texto debajo a la izquierda ─────────── */
.tze--marco { display: flex; flex-direction: column; }
.tze__marco { flex: none; display: flex; align-items: flex-start; }
.tze__foto-marco {
  display: block;
  max-width: 100%;
  max-height: var(--alto-foto);
  width: auto;
  height: auto;
  border-radius: 24px;
}
.tze__texto {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 60px var(--margen) var(--margen);
}
.tze--story .tze__texto { padding-bottom: 320px; }
.tze--marco .tze__texto > .tze__etiqueta { margin-bottom: 22px; }
.tze__firma { margin-top: auto; padding-top: 32px; width: 100%; display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; }
.tze__firma .tze__marca { font-size: 52px; width: auto; flex: none; }
.tze__firma .tze__info { width: auto; flex: 0 1 auto; min-width: 0; }

.tze--portada.tze--marco .tze__marco { --alto-foto: 630px; padding: var(--margen) var(--margen) 0; }
${titular(".tze--portada.tze--marco .tze__titular", 104, 0.98, 2)}
.tze--portada.tze--marco .tze__cita { margin-top: 18px; font-size: 30px; }
.tze--portada.tze--marco.tze--story .tze__marco { --alto-foto: 820px; padding-top: 200px; }
${titular(".tze--portada.tze--marco.tze--story .tze__titular", 116, 0.98, 3)}

/* Plato enmarcado: la foto a la derecha y el rótulo debajo; el conjunto, centrado en alto. */
.tze--plato.tze--marco { justify-content: center; }
.tze--plato.tze--marco .tze__marco { --alto-foto: 700px; justify-content: flex-end; padding: 0 var(--margen) 0 144px; }
.tze--plato.tze--marco .tze__texto { flex: none; padding: 50px var(--margen) 0; }
${titular(".tze--plato.tze--marco .tze__titular", 88, 1, 2)}
.tze--plato.tze--marco.tze--story .tze__marco { --alto-foto: 860px; padding-left: var(--margen); }
${titular(".tze--plato.tze--marco.tze--story .tze__titular", 96, 1, 2)}

.tze--cierre.tze--marco .tze__marco { --alto-foto: 600px; padding: var(--margen) 216px 0 var(--margen); }
.tze--cierre.tze--marco .tze__texto { justify-content: flex-end; }
.tze--cierre.tze--marco .tze__texto > .tze__marca { font-size: 180px; letter-spacing: -0.03em; }
.tze--cierre.tze--marco .tze__texto > .tze__marca + * { margin-top: 30px; }
.tze--cierre.tze--marco .tze__frase { font-size: 46px; line-height: 1.25; max-height: calc(1.25em * 2 + 2px); }
.tze--cierre.tze--marco .tze__info { margin-top: 30px; text-transform: none; letter-spacing: 0.04em; font-weight: var(--peso-texto); font-size: 24px; }
.tze--cierre.tze--marco.tze--story .tze__marco { --alto-foto: 700px; padding-top: 200px; padding-right: 144px; }
.tze--cierre.tze--marco.tze--story .tze__texto > .tze__marca { font-size: 210px; }
.tze--cierre.tze--marco.tze--story .tze__frase { font-size: 50px; max-height: calc(1.25em * 3 + 2px); }

/* ── Cierre de marca (sin foto): intro del vídeo del dueño + cierre del reel ─ */
.tze--marca {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 120px var(--margen);
  background: radial-gradient(ellipse 75% 60% at 50% 45%, color-mix(in srgb, var(--color-oro) 9%, transparent) 0%, transparent 70%), var(--color-negro);
}
.tze--marca.tze--story { padding: var(--story-zona-segura-arriba) var(--margen) 320px; }
.tze--marca .tze__etiqueta {
  font-weight: var(--peso-texto);
  font-size: 26px;
  letter-spacing: 0.5em;
  padding-left: 0.5em;
  color: color-mix(in srgb, var(--color-crema) 55%, transparent);
}
.tze--marca > .tze__marca { font-size: 250px; letter-spacing: -0.05em; color: var(--color-blanco); margin-top: 40px; }
.tze--marca.tze--story > .tze__marca { font-size: 300px; }
.tze--marca > .tze__marca + * { margin-top: 60px; }
.tze--marca .tze__frase { font-size: 52px; line-height: 1.4; max-height: calc(1.4em * 3 + 2px); max-width: 860px; }
.tze--marca .tze__boton { margin-top: 64px; padding: 26px 64px 27px; font-size: 30px; }
.tze--marca .tze__info { margin-top: 40px; text-transform: none; letter-spacing: 0.04em; font-weight: var(--peso-texto); font-size: 26px; padding-left: 0; }

/* ── Frase (sin foto), asimétrica ───────────────────────────────────────── */
.tze--frase {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--margen);
  background: radial-gradient(ellipse 70% 50% at 100% 0%, color-mix(in srgb, var(--color-oro) 10%, transparent) 0%, transparent 70%), var(--color-negro);
}
.tze--frase.tze--story { padding-top: var(--story-zona-segura-arriba); padding-bottom: 320px; }
.tze__cuerpo { margin-top: auto; width: 100%; max-width: 900px; display: flex; flex-direction: column; align-items: flex-start; }
${titular(".tze--frase .tze__titular", 128, 0.96, 4)}
${titular(".tze--frase .tze__encabezado", 40, 1.1, 2, "margin-bottom: calc(26px - var(--aire)); color: var(--color-oro-claro);")}
.tze--frase .tze__frase { font-size: 76px; line-height: 1.16; max-height: calc(1.16em * 4 + 2px); }
.tze--frase.tze--story .tze__frase { font-size: 84px; max-height: calc(1.16em * 5 + 2px); }
.tze--frase .tze__firma { margin-top: 110px; }
`;
