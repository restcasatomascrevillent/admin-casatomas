/**
 * CSS de ct-tipografica (Casa Tomás, pieza solo tipográfica sobre papel).
 *
 * Gramática del «papel» de la web (web-casatomas:src/index.css → .ticket-grain
 * y components/espacios/CartaDelDia.tsx → FileteOro): fondo papel, grano
 * feTurbulence al 5 %, filete de oro con rombo. Solo variables de marca.
 *
 * Composición: medallón y textos forman UN bloque centrado en el hueco que
 * deja el pie (así no queda un vacío entre medallón y texto); el pie, abajo.
 *
 * Ajuste: la frase grande (cita, o titular si no hay cita) tiene ancho fijo y
 * alto máximo de 4 líneas; el titular pequeño (con cita) 2 líneas; antetítulo
 * y pie una línea. Si algo no cabe, DESBORDA y el motor da error (sin
 * recortes, sin puntos suspensivos, sin encoger la letra).
 */

/** Mismo SVG de grano que la web (.ticket-grain): fractalNoise 0.9, 3 octavas, opacidad 0,05. */
const GRANO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23g)' opacity='0.05'/%3E%3C/svg%3E";

export const CSS_TIPOGRAFICA = `
.ct-tp {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background-color: var(--color-papel);
  background-image: url("${GRANO}");
  background-size: 140px 140px;
  color: var(--color-pizarra);
  font-family: var(--fuente-texto);
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
  font-kerning: normal;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--margen);
}

/* Marco fino de oro, como el borde de una carta impresa (decoración, sin data-campo). */
.ct-tp__marco {
  position: absolute;
  inset: 36px;
  border: 1px solid color-mix(in srgb, var(--color-oro) 38%, transparent);
  pointer-events: none;
}

.ct-tp__bloque {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* Centro óptico: un poco por encima del centro geométrico del hueco. */
  padding-bottom: 36px;
}

.ct-tp__medallon {
  width: 176px;
  height: 176px;
  display: block;
  flex: none;
  margin-bottom: 60px;
}

.ct-tp__antetitulo {
  width: 100%;
  flex: none;
  font-weight: var(--peso-antetitulo);
  font-size: 21px;
  line-height: 1.3;
  letter-spacing: var(--tracking-antetitulo);
  text-indent: var(--tracking-antetitulo);
  text-transform: uppercase;
  color: var(--color-oro-texto);
  white-space: nowrap;
}

.ct-tp__filete {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 30px 0 40px;
}
.ct-tp__filete span:nth-child(odd) {
  width: 40px;
  height: 1.5px;
  background: color-mix(in srgb, var(--color-oro) 70%, transparent);
}
.ct-tp__filete span:nth-child(2) {
  width: 8px;
  height: 8px;
  transform: rotate(45deg);
  background: var(--color-oro);
}

/* Encabezado pequeño sobre la cita (solo si hay cita y titular). */
.ct-tp__titular {
  /* Misma medida que la cita: los titulares largos se equilibran en 2 líneas. */
  width: 820px;
  max-width: 100%;
  flex: none;
  font-family: var(--fuente-titular);
  font-weight: var(--peso-titular);
  font-size: 44px;
  line-height: 1.22;
  letter-spacing: -0.005em;
  /* 2 líneas como máximo: si no cabe, desborda y el motor da error. */
  max-height: calc(1.22em * 2 + 2px);
  margin-bottom: 30px;
  color: var(--color-pizarra);
  text-wrap: balance;
  overflow-wrap: normal;
  hyphens: manual;
}

.ct-tp__frase {
  width: 100%;
  flex: none;
  /* Aire para el área de glifos de Baskerville cursiva (ver ct-foto-titular). */
  --aire: 0.12em;
  padding-block: var(--aire);
  margin-block: calc(-1 * var(--aire));
  font-family: var(--fuente-titular);
  font-weight: var(--peso-lema);
  font-style: var(--estilo-lema);
  font-size: 80px;
  line-height: 1.18;
  letter-spacing: -0.01em;
  /* 4 líneas como máximo: si no cabe, desborda y el motor da error. */
  max-height: calc(1.18em * 4 + 2 * var(--aire) + 2px);
  color: var(--color-pizarra);
  text-wrap: balance;
  overflow-wrap: normal;
  hyphens: manual;
  font-feature-settings: "kern" 1, "liga" 1;
}

/*
 * Cita/lema: medida algo más estrecha que el titular (se lee como una cita y
 * deja más papel a los lados). Con 4 líneas caben ~70 caracteres; ~90 desbordan.
 */
.ct-tp__frase--cita {
  width: 820px;
  max-width: 100%;
}

.ct-tp__pie {
  width: 100%;
  flex: none;
  margin-bottom: 30px;
  font-weight: var(--peso-texto);
  font-size: 21px;
  line-height: 1.3;
  letter-spacing: 0.04em;
  color: var(--color-gris-medio);
  white-space: nowrap;
}
`;
