// ============================================================================
// ALTURA DEL CALENDARIO — cuentas puras (sin DOM) de la pestaña Calendario
// ----------------------------------------------------------------------------
// Encargo del dueño (2026-10-04): «que esta vista calcule la altura para el
// tamaño de la pantalla, para que sea fija, sin scroll». El hook
// `useAlturaDisponible` mide el DOM; aquí viven las cuentas, que son lo que se
// testea (jsdom no calcula layout).
//
// REGLAS (documentadas porque salen de decisiones, no del azar):
//
// 1. ALTURA DEL BLOQUE = alto del viewport VISUAL − posición del bloque en la
//    PÁGINA − relleno inferior del layout. La posición es relativa al documento
//    (top + scrollY), no a la ventana: si fuera la de la ventana, al hacer
//    scroll hacia el panel del día (vertical) el bloque encogería a cada paso.
//
// 2. SUELO (`ALTURA_MINIMA_BLOQUE`): por debajo, el bloque no encoge más y la
//    página hace scroll. Con 520 px las seis filas del mes siguen en ≥ 44 px
//    (tocables con el dedo) en el peor caso (mes de seis semanas, leyenda en
//    tres líneas). Equivale a una ventana de ~640 px de alto.
//
// 3. BREAKPOINT `lg` (1024 px, el mismo del menú lateral y del resto del panel):
//    · ≥ lg  calendario y panel del día van LADO A LADO, y el bloque entero
//      (cabecera + mes + panel + leyenda) mide exactamente la altura
//      disponible: cero scroll de página; el panel del día hace scroll interno.
//    · < lg  (iPad vertical 768/810/820, móviles) el panel del día va DEBAJO:
//      no cabe todo sin scroll. El calendario (cabecera + mes entero) ocupa la
//      altura visible y el panel y la leyenda quedan debajo, a un scroll.
//
// 4. DENSIDAD de casilla: según el alto REAL de cada fila (el mes de 5 o 6
//    semanas reparte la altura con `minmax(0,1fr)`), la casilla escala o se
//    simplifica en vez de desbordar. Ver `medirCasilla`.
// ============================================================================

/** Alto mínimo del bloque (px): por debajo, scroll de página antes que casillas ilegibles. */
export const ALTURA_MINIMA_BLOQUE = 520;

/** Alto de la tarjeta de cabecera del mes («Octubre 2026» + flechas), en px (`h-14`). */
export const ALTURA_CABECERA_MES = 56;

/** Separación vertical entre las piezas del bloque, en px (`gap-3`). */
export const SEPARACION_BLOQUE = 12;

/** Por encima de esta altura de bloque cabe la leyenda completa; por debajo se usa la compacta. */
export const ALTURA_LEYENDA_COMPLETA = 900;

/** Hueco entre casillas, en px (`gap-1`). */
export const HUECO_CASILLAS = 4;

export interface EntradaAltura {
  /** `getBoundingClientRect().top + scrollY` del bloque: su posición en el documento. */
  topPagina: number;
  /** Alto del viewport visual (`visualViewport.height`, o `innerHeight` sin soporte). */
  altoVisible: number;
  /** Relleno inferior del `<main>` del layout. */
  paddingInferior: number;
  minimo?: number;
}

/**
 * Alto (px, entero) que le queda al bloque desde su posición hasta el fondo
 * visible, con el relleno del layout respetado, y nunca menos que el suelo.
 * Entradas no finitas (medidas rotas) caen al suelo.
 */
export function calcularAlturaDisponible({
  topPagina,
  altoVisible,
  paddingInferior,
  minimo = ALTURA_MINIMA_BLOQUE,
}: EntradaAltura): number {
  const bruto = Math.floor(altoVisible - topPagina - paddingInferior);
  return Number.isFinite(bruto) ? Math.max(minimo, bruto) : minimo;
}

/** Alto de la tarjeta del calendario cuando va apilada (< lg): el bloque menos la cabecera y su hueco. */
export function alturaTarjetaCalendario(alturaBloque: number): number {
  return Math.max(0, alturaBloque - ALTURA_CABECERA_MES - SEPARACION_BLOQUE);
}

/** Semanas (filas) que ocupa un mes: `offsetLunes` = huecos vacíos antes del día 1 (Lun = 0). */
export function semanasDelMes(offsetLunes: number, diasDelMes: number): number {
  return Math.max(1, Math.ceil((offsetLunes + diasDelMes) / 7));
}

/** Tamaño de una casilla a partir del de la rejilla, descontando los huecos. */
export function tamanoCasilla(
  rejilla: { ancho: number; alto: number },
  semanas: number,
  hueco: number = HUECO_CASILLAS,
): { ancho: number; alto: number } {
  return {
    ancho: Math.max(0, (rejilla.ancho - hueco * 6) / 7),
    alto: Math.max(0, (rejilla.alto - hueco * (semanas - 1)) / Math.max(1, semanas)),
  };
}

export type DensidadCasilla = "completa" | "media" | "compacta";

/** Alto de fila (px) desde el que una casilla enseña TODO: nº de reservas incluido. */
export const FILA_COMPLETA = 110;
/** Alto de fila (px) desde el que cabe la cifra con barras y % escrito. Por debajo: una sola línea. */
export const FILA_MEDIA = 84;
/** Ancho de casilla (px) por debajo del cual se baja un nivel (no cabe número + indicadores + cifra). */
export const ANCHO_ESTRECHO = 56;

const entre = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Qué enseña una casilla y qué tamaño tiene su cifra, según su tamaño real.
 *   · completa: número, comensales GRANDES, «N res.», barras y %.
 *   · media:    número, comensales, barras y %. Sin «N res.».
 *   · compacta: UNA línea (número · indicadores · comensales) y la barra fina.
 *               Sin «N res.» ni % escrito (siguen en el tooltip y el aria-label).
 * `fuenteComensales` va en px: así la cifra escala con la altura y no solo con
 * el ancho (con `cqw` una casilla ancha y baja desbordaba). Los umbrales y los
 * `alto - N` salen de sumar lo que cada densidad apila (relleno + número de 24 +
 * huecos + «N res.» de 10 + barras y % de 18), medido en el navegador el
 * 2026-10-04: con ellos la cifra más grande aún cabe en su fila.
 */
export function medirCasilla({ ancho, alto }: { ancho: number; alto: number }): {
  densidad: DensidadCasilla;
  fuenteComensales: number;
} {
  let densidad: DensidadCasilla = alto >= FILA_COMPLETA ? "completa" : alto >= FILA_MEDIA ? "media" : "compacta";
  if (ancho < ANCHO_ESTRECHO && densidad !== "compacta") densidad = densidad === "completa" ? "media" : "compacta";

  const fuente =
    densidad === "completa"
      ? entre(Math.min(ancho * 0.3, alto * 0.28, alto - 84), 20, 40)
      : densidad === "media"
        ? entre(Math.min(ancho * 0.28, alto * 0.3, alto - 68), 16, 28)
        : entre(alto * 0.4, 16, 22);
  return { densidad, fuenteComensales: Math.round(fuente) };
}
