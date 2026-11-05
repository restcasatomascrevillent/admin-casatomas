/**
 * CSS de tz-foto-titular. Solo variables de marca (--color-*, --fuente-*,
 * --peso-*, --tracking-*, --radio-*); los tamaños en px son de composición.
 */
import type { ContextoPlantilla } from "../../tipos.js";

/** Negro de marca con transparencia (los velos). */
const negro = (pct: number): string => `color-mix(in srgb, var(--color-negro) ${pct}%, transparent)`;

/** Medidas de composición por formato. */
const MEDIDAS = {
  post: { marca: 44, titular: 112, interlineaTitular: 1.0, lineasTitular: 3, antetitulo: 20, cta: 24, pie: 20 },
  story: { marca: 52, titular: 124, interlineaTitular: 1.0, lineasTitular: 3, antetitulo: 21, cta: 26, pie: 21 },
} as const;

/** Colchón bajo el titular para los descendentes (em). */
const COLCHON = 0.14;

export function estilos(ctx: ContextoPlantilla): string {
  const m = ctx.alto > 1350 ? MEDIDAS.story : MEDIDAS.post;
  const arriba = ctx.margen + ctx.zonaSegura.arriba;
  const abajo = ctx.margen + ctx.zonaSegura.abajo;
  // En story la zona segura ya deja 250 px de aire: el contenido empieza en
  // su borde (más margen sería desperdiciar alto útil).
  const top = ctx.zonaSegura.arriba > 0 ? ctx.zonaSegura.arriba : arriba;
  const bottom = ctx.zonaSegura.abajo > 0 ? ctx.zonaSegura.abajo : abajo;
  const altoTitular = Math.ceil(m.titular * m.interlineaTitular * m.lineasTitular);
  const lineaPie = 1.45;
  // Alto del fundido del velo por encima del antetítulo.
  const fundido = ctx.zonaSegura.arriba > 0 ? 420 : 340;

  return `
.tzf {
  position: relative;
  width: ${ctx.ancho}px;
  height: ${ctx.alto}px;
  overflow: hidden;
  background: var(--color-negro);
  color: var(--color-crema);
}
.tzf-foto {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}
/* Velo en dos capas (el del hero de la web es negro 70 % arriba, 40 % en
   medio y 90 % abajo):
   1) .tzf-velo, fijo: negro arriba para el wordmark, centro limpio (en
      Instagram la foto es el gancho) y un poco de peso abajo.
   2) .tzf-bloque::before, PEGADO AL TEXTO: funde de transparente a negro
      ~85 % justo donde empieza el antetítulo y llega a ~92 % al pie. Así un
      titular de 1 o de 3 líneas siempre cae sobre oscuro, aunque la foto sea
      clara (touza-2, sofá mostaza), sin oscurecer de más la foto entera. */
.tzf-velo {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    ${negro(70)} 0%,
    ${negro(30)} 14%,
    ${negro(0)} 30%,
    ${negro(0)} 50%,
    ${negro(30)} 100%
  );
}
.tzf--story .tzf-velo {
  background: linear-gradient(
    to bottom,
    ${negro(86)} 0%,
    ${negro(84)} 14%,
    ${negro(40)} 21%,
    ${negro(0)} 32%,
    ${negro(0)} 50%,
    ${negro(30)} 100%
  );
}
.tzf-bloque {
  position: relative;
  margin-top: auto;
}
.tzf-bloque::before {
  content: "";
  position: absolute;
  z-index: -1;
  left: -${ctx.margen}px;
  right: -${ctx.margen}px;
  top: -${fundido}px;
  bottom: -${bottom}px;
  background: linear-gradient(
    to bottom,
    ${negro(0)} 0px,
    ${negro(30)} ${Math.round(fundido * 0.35)}px,
    ${negro(62)} ${Math.round(fundido * 0.7)}px,
    ${negro(84)} ${fundido}px,
    ${negro(92)} 100%
  );
}
.tzf-contenido {
  position: absolute;
  top: ${top}px;
  bottom: ${bottom}px;
  left: ${ctx.margen}px;
  right: ${ctx.margen}px;
  display: flex;
  flex-direction: column;
  /* Contexto de apilamiento propio: el velo del bloque (z-index -1) queda
     encima de la foto y debajo del texto. */
  z-index: 1;
}

/* Wordmark TOUZA: texto, Cormorant 700, tracking 0.05em, oro (App.tsx). */
.tzf-marca {
  font-family: var(--fuente-titular);
  font-weight: var(--peso-wordmark);
  letter-spacing: var(--tracking-wordmark);
  color: var(--color-oro);
  font-size: ${m.marca}px;
  line-height: 1;
  /* El tracking deja aire tras la última letra: se compensa. */
  margin-right: calc(-1 * var(--tracking-wordmark));
  align-self: flex-start;
}

.tzf-cuerpo {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.tzf-antetitulo {
  font-family: var(--fuente-texto);
  font-weight: var(--peso-antetitulo);
  letter-spacing: var(--tracking-antetitulo);
  text-transform: uppercase;
  color: var(--color-antetitulo);
  font-size: ${m.antetitulo}px;
  line-height: 1.2;
  white-space: nowrap;
  max-width: 100%;
  margin-bottom: 30px;
}
/* Titular: Cormorant 600 (--peso-titular, el de los h1-h6 de la web).
   Probado contra 500: sobre foto, y visto a tamaño de móvil (~38 %) tras la
   compresión de Instagram, los perfiles finos del 500 se deshacen encima de
   zonas claras (hielo, metal); el 600 los mantiene sin perder elegancia. */
.tzf-titular {
  font-family: var(--fuente-titular);
  font-weight: var(--peso-titular);
  color: var(--color-crema);
  font-size: ${m.titular}px;
  line-height: ${m.interlineaTitular};
  letter-spacing: -0.005em;
  text-wrap: balance;
  width: 100%;
  /* Con interlineado 1 los rasgos descendentes de la Cormorant salen de la
     caja de línea y cuentan como desborde: se les reserva un colchón abajo
     (no cabe ni media línea más, así que una 4.ª línea sigue fallando). */
  padding-bottom: ${COLCHON}em;
  margin-bottom: -${COLCHON}em;
  max-height: calc(${altoTitular}px + ${COLCHON}em);
}
.tzf-acciones {
  margin-top: 48px;
  max-width: 100%;
  display: flex;
}
/* Píldora blanca, texto negro, Montserrat 500 (Hero.tsx → bg-white text-black). */
.tzf-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  white-space: nowrap;
  height: ${Math.round(m.cta * 3.1)}px;
  padding: 0 ${Math.round(m.cta * 2)}px;
  border-radius: var(--radio-boton);
  background: var(--color-boton-fondo);
  color: var(--color-boton-texto);
  font-family: var(--fuente-texto);
  font-weight: 500;
  font-size: ${m.cta}px;
  letter-spacing: 0.01em;
  line-height: 1;
}

.tzf-pie-fila {
  margin-top: 56px;
  padding-top: 26px;
  border-top: 1px solid var(--color-blanco-10);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
}
.tzf-pie {
  font-family: var(--fuente-texto);
  font-weight: var(--peso-texto);
  color: var(--color-texto-suave);
  font-size: ${m.pie}px;
  line-height: ${lineaPie};
  letter-spacing: 0.02em;
  text-wrap: pretty;
  min-width: 0;
  max-height: ${Math.ceil(m.pie * lineaPie * 2)}px;
}
.tzf-tau {
  display: block;
  height: 44px;
  width: auto;
  flex: none;
}

/* ── Story: eje centrado ─────────────────────────────────────────────── */
.tzf--story .tzf-marca {
  align-self: center;
  margin-right: 0;
  /* Centrado óptico: el tracking añade aire a la derecha. */
  padding-left: var(--tracking-wordmark);
}
.tzf--story .tzf-cuerpo {
  align-items: center;
  text-align: center;
}
/* Sombra suave bajo el texto centrado (como el h1 del hero en móvil:
   text-shadow 0 4px 30px negro 45 %): en story el texto cae sobre el
   centro de la foto, donde suele estar lo más claro. */
.tzf--story .tzf-titular,
.tzf--story .tzf-antetitulo {
  text-shadow: 0 4px 30px ${negro(55)};
}
.tzf--story .tzf-antetitulo {
  padding-left: var(--tracking-antetitulo);
  margin-bottom: 36px;
}
.tzf--story .tzf-acciones {
  margin-top: 56px;
  justify-content: center;
}
.tzf--story .tzf-pie-fila {
  margin-top: 96px;
  border-top: 0;
  padding-top: 0;
  justify-content: center;
  text-align: center;
}
`;
}
