/**
 * CSS de tz-marco (Touza · Foto enmarcada). Solo variables de marca
 * (--color-*, --fuente-*, --peso-*, --tracking-*, --radio-*); los tamaños en
 * px son de composición.
 *
 * Fondo negro de marca con un halo ámbar muy suave (la penumbra con reflejos
 * del sistema de marca), la foto ENTERA con esquinas de 6 px y un filete oro
 * al 40 % (el «trazo» de la web) separado por 14 px de negro. La foto nunca
 * se amplía ni se recorta (max-width/max-height al 100 % de su hueco).
 *
 * Ajuste: antetítulo, botón y pie en una línea; titular y cita con 2 líneas
 * como máximo. Si no caben, desbordan y el motor da error.
 */

const MEDIDAS = {
  post: { marca: 44, antetitulo: 19, titular: 78, cita: 36, cta: 22, pie: 19, tau: 38, hueco: 34, filete: 14 },
  story: { marca: 50, antetitulo: 21, titular: 92, cita: 40, cta: 25, pie: 21, tau: 44, hueco: 44, filete: 16 },
} as const;

function bloque(clase: string, m: Record<keyof (typeof MEDIDAS)["post"], number>): string {
  return `
.${clase} { gap: ${m.hueco}px; }
.${clase} .tzm__marca { font-size: ${m.marca}px; }
.${clase} .tzm__antetitulo { font-size: ${m.antetitulo}px; }
.${clase} .tzm__titular { font-size: ${m.titular}px; }
.${clase} .tzm__cita { font-size: ${m.cita}px; }
.${clase} .tzm__cta { font-size: ${m.cta}px; }
.${clase} .tzm__pie { font-size: ${m.pie}px; }
.${clase} .tzm__tau { height: ${m.tau}px; }
.${clase} .tzm__marco { padding: ${m.filete + 12}px; }
.${clase} .tzm__foto {
  box-shadow:
    0 0 0 ${m.filete}px var(--color-negro),
    0 0 0 ${m.filete + 1}px var(--color-trazo),
    0 40px 90px -40px color-mix(in srgb, var(--color-oro) 30%, transparent);
}
`;
}

export const CSS_MARCO_TOUZA = `
.tzm {
  position: absolute;
  inset: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: var(--margen);
  background:
    radial-gradient(ellipse 75% 42% at 50% 48%, color-mix(in srgb, var(--color-oro) 11%, transparent), transparent 72%),
    radial-gradient(ellipse 90% 30% at 50% 100%, color-mix(in srgb, var(--color-oro-oscuro) 10%, transparent), transparent 70%),
    var(--color-negro);
  color: var(--color-crema);
  font-family: var(--fuente-texto);
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
  text-align: center;
}
.tzm--story {
  padding-top: var(--story-zona-segura-arriba);
  /* Zona segura del sistema de marca para 9:16 (320 px abajo). */
  padding-bottom: 320px;
}

.tzm__cabecera,
.tzm__bloque {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

/* Wordmark TOUZA: texto, Cormorant 700, tracking 0.05em, oro (App.tsx de la web). */
.tzm__marca {
  font-family: var(--fuente-titular);
  font-weight: var(--peso-wordmark);
  letter-spacing: var(--tracking-wordmark);
  color: var(--color-oro);
  line-height: 1;
}
.tzm__marca + .tzm__ante-fila { margin-top: 30px; }

.tzm__ante-fila {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  width: 100%;
}
.tzm__raya {
  flex: 0 1 44px;
  min-width: 10px;
  height: 1px;
  background: var(--color-trazo);
}
.tzm__antetitulo {
  flex: 0 1 auto;
  min-width: 0;
  font-family: var(--fuente-texto);
  font-weight: var(--peso-antetitulo);
  line-height: 1.3;
  letter-spacing: var(--tracking-antetitulo);
  padding-left: var(--tracking-antetitulo);
  text-transform: uppercase;
  color: var(--color-oro);
  white-space: nowrap;
}

.tzm__titular {
  width: 100%;
  /* Colchón para los descendentes de Cormorant con interlineado 1. */
  --aire: 0.12em;
  padding-block: var(--aire);
  margin-block: calc(-1 * var(--aire));
  font-family: var(--fuente-titular);
  font-weight: var(--peso-titular);
  line-height: 1.02;
  letter-spacing: -0.01em;
  max-height: calc(1.02em * 2 + 2 * var(--aire) + 2px);
  color: var(--color-crema);
  text-wrap: balance;
  overflow-wrap: normal;
  hyphens: manual;
}
.tzm__ante-fila + .tzm__titular,
.tzm__marca + .tzm__titular { margin-top: calc(22px - var(--aire)); }

.tzm__cita {
  width: 100%;
  font-family: var(--fuente-titular);
  font-weight: 400;
  font-style: italic;
  line-height: 1.3;
  max-height: calc(1.3em * 2 + 2px);
  color: color-mix(in srgb, var(--color-crema) 82%, transparent);
  text-wrap: balance;
}
.tzm__titular + .tzm__cita { margin-top: 16px; }

.tzm__cta {
  margin-top: 30px;
  max-width: 100%;
  display: inline-block;
  padding: 0.95em 2.2em 1em;
  border-radius: var(--radio-boton);
  background: var(--color-boton-fondo);
  color: var(--color-boton-texto);
  font-family: var(--fuente-texto);
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.tzm__pie-fila {
  margin-top: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  max-width: 100%;
}
.tzm__bloque > .tzm__pie-fila:first-child { margin-top: 0; }
.tzm__tau { flex: none; display: block; width: auto; }
.tzm__pie {
  flex: 0 1 auto;
  min-width: 0;
  font-family: var(--fuente-texto);
  font-weight: var(--peso-texto);
  line-height: 1.3;
  letter-spacing: 0.08em;
  color: var(--color-texto-suave);
  white-space: nowrap;
}

/* ── Foto enmarcada (sin data-campo) ────────────────────────────────────── */
.tzm__marco {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tzm__foto {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 6px;
}
${bloque("tzm--post", MEDIDAS.post)}
${bloque("tzm--story", MEDIDAS.story)}
`;
