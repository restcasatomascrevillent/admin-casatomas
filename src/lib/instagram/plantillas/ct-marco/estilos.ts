/**
 * CSS de ct-marco (Casa Tomás · Foto enmarcada).
 *
 * Solo variables de marca (generarCss): ningún hex escrito a mano. Fondo papel
 * con un degradado muy suave (blanco → papel → arena, como el hero de la web),
 * la foto ENTERA con paspartú blanco, filete oro de 1 px y sombra pizarra
 * suave (--shadow-elegant del sistema de marca).
 *
 * La foto nunca se amplía ni se recorta: <img> con max-width/max-height al
 * 100 % de su hueco (sin width/height fijos), así que una de 1200×900 se
 * REDUCE hasta caber y una pequeña se queda en su tamaño natural. El marco se
 * ciñe a la foto, sea apaisada, cuadrada o vertical.
 *
 * Reglas de ajuste (el motor las comprueba):
 * - Antetítulo, botón y pie van en una línea (nowrap): si no caben, desbordan
 *   en horizontal y el motor da error.
 * - Titular (2 líneas) y cita (2 líneas) tienen alto máximo: si no caben,
 *   desbordan en vertical y el motor da error. Nada se encoge ni se recorta.
 */

/** Medidas de composición por formato (px). */
const MEDIDAS = {
  post: { antetitulo: 21, titular: 62, cita: 30, cta: 26, pie: 20, medallon: 46, hueco: 34, paspartu: 16 },
  story: { antetitulo: 23, titular: 78, cita: 34, cta: 28, pie: 22, medallon: 52, hueco: 44, paspartu: 18 },
} as const;

function bloque(clase: string, m: Record<keyof (typeof MEDIDAS)["post"], number>): string {
  return `
.${clase} .ct-mc__antetitulo { font-size: ${m.antetitulo}px; }
.${clase} .ct-mc__titular { font-size: ${m.titular}px; }
.${clase} .ct-mc__cita { font-size: ${m.cita}px; }
.${clase} .ct-mc__cta { font-size: ${m.cta}px; }
.${clase} .ct-mc__pie { font-size: ${m.pie}px; }
.${clase} .ct-mc__medallon { width: ${m.medallon}px; height: ${m.medallon}px; }
.${clase} { gap: ${m.hueco}px; }
.${clase} .ct-mc__foto {
  box-shadow:
    0 0 0 ${m.paspartu}px var(--color-blanco),
    0 0 0 ${m.paspartu + 1}px color-mix(in srgb, var(--color-oro) 72%, transparent),
    0 34px 70px -26px color-mix(in srgb, var(--color-pizarra) 42%, transparent),
    0 10px 24px -12px color-mix(in srgb, var(--color-pizarra) 22%, transparent);
}
.${clase} .ct-mc__marco { padding: ${m.paspartu + 12}px; }
`;
}

export const CSS_MARCO = `
.ct-mc {
  position: absolute;
  inset: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: var(--margen);
  background:
    radial-gradient(ellipse 70% 45% at 12% 8%, color-mix(in srgb, var(--color-oro) 9%, transparent), transparent 70%),
    radial-gradient(ellipse 60% 40% at 92% 96%, color-mix(in srgb, var(--color-piedra) 12%, transparent), transparent 70%),
    linear-gradient(165deg, var(--color-blanco) 0%, var(--color-papel) 48%, color-mix(in srgb, var(--color-papel) 70%, var(--color-piedra-clara)) 100%);
  color: var(--color-pizarra);
  font-family: var(--fuente-texto);
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
  font-kerning: normal;
  text-align: center;
}
.ct-mc--story {
  padding-top: var(--story-zona-segura-arriba);
  /* Zona segura del sistema de marca para 9:16 (320 px abajo: barra de respuesta). */
  padding-bottom: 320px;
}

/* ── Cabecera y bloque de texto ─────────────────────────────────────────── */
.ct-mc__cabecera,
.ct-mc__bloque {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.ct-mc__ante-fila {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  width: 100%;
}
.ct-mc__raya {
  flex: 0 1 44px;
  min-width: 10px;
  height: 1.5px;
  background: color-mix(in srgb, var(--color-oro) 80%, transparent);
}
.ct-mc__antetitulo {
  flex: 0 1 auto;
  min-width: 0;
  font-family: var(--fuente-texto);
  font-weight: var(--peso-antetitulo);
  line-height: 1.3;
  letter-spacing: var(--tracking-antetitulo);
  /* El tracking deja aire tras la última letra: se compensa para centrar. */
  padding-left: var(--tracking-antetitulo);
  text-transform: uppercase;
  color: var(--color-oro-texto);
  white-space: nowrap;
}

.ct-mc__titular {
  width: 100%;
  /* Libre Baskerville sobresale de un interlineado apretado: el aire va como
     relleno y se compensa con margen negativo (como ct-foto-titular). */
  --aire: 0.14em;
  padding-block: var(--aire);
  margin-block: calc(-1 * var(--aire));
  font-family: var(--fuente-titular);
  font-weight: var(--peso-titular);
  line-height: 1.08;
  letter-spacing: -0.015em;
  /* 2 líneas como máximo: si no cabe, desborda y el motor da error. */
  max-height: calc(1.08em * 2 + 2 * var(--aire) + 2px);
  color: var(--color-pizarra);
  text-wrap: balance;
  overflow-wrap: normal;
  hyphens: manual;
}
.ct-mc__ante-fila + .ct-mc__titular { margin-top: calc(22px - var(--aire)); }

.ct-mc__cita {
  width: 100%;
  font-family: var(--fuente-texto);
  font-weight: var(--peso-lema);
  font-style: var(--estilo-lema);
  line-height: 1.4;
  max-height: calc(1.4em * 2 + 2px);
  color: color-mix(in srgb, var(--color-pizarra) 82%, transparent);
  text-wrap: balance;
}
.ct-mc__titular + .ct-mc__cita { margin-top: 18px; }

.ct-mc__cta {
  margin-top: 30px;
  max-width: 100%;
  display: inline-block;
  padding: 0.78em 1.75em 0.82em;
  border-radius: var(--radio-boton);
  background: var(--color-boton-fondo);
  color: var(--color-boton-texto);
  font-family: var(--fuente-texto);
  font-weight: var(--peso-titular);
  line-height: 1.2;
  letter-spacing: 0.01em;
  white-space: nowrap;
  box-shadow: 0 12px 28px -14px color-mix(in srgb, var(--color-oro) 75%, transparent);
}

.ct-mc__pie-fila {
  margin-top: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  max-width: 100%;
}
.ct-mc__bloque > .ct-mc__pie-fila:first-child { margin-top: 0; }
.ct-mc__medallon { flex: none; display: block; }
.ct-mc__pie {
  flex: 0 1 auto;
  min-width: 0;
  font-family: var(--fuente-texto);
  font-weight: var(--peso-texto);
  line-height: 1.3;
  letter-spacing: 0.04em;
  color: var(--color-gris-medio);
  white-space: nowrap;
}

/* ── Foto enmarcada (sin data-campo) ────────────────────────────────────── */
.ct-mc__marco {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ct-mc__foto {
  display: block;
  /* Nunca se amplía: solo se reduce hasta caber (sin recorte). */
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  background: var(--color-blanco);
}
${bloque("ct-mc--post", MEDIDAS.post)}
${bloque("ct-mc--story", MEDIDAS.story)}
`;
