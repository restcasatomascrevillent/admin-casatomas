/**
 * Estilo del informe mensual de tráfico web: la estructura del informe de
 * redes sociales del dueño (diapositivas 16:9, titular que cuenta la
 * conclusión, cifras enormes, tarjetas redondeadas, número de página) con la
 * identidad de marca de la web pública de Casa Tomás (web-casatomas,
 * `src/index.css`): papel cálido, pizarra, oro y piedra; titulares y cifras en
 * Libre Baskerville y textos de apoyo en sans.
 *
 * Las diapositivas se diseñan a 1280 × 720 px y se escalan al ancho disponible
 * (vista previa) o se rasterizan a ×3 (PDF), así que todas las medidas de los
 * componentes van en px de ese lienzo.
 *
 * Contraste del texto (WCAG 2), medido con la skill `dataviz`:
 *   papel #FBF8F4 → pizarra 9,8:1 · tenue 6,7:1 · gris medio 5,8:1 · oro 4,8:1
 *   pizarra #394147 → blanco 10,4:1 · piedra clara 5,2:1 · oro claro 5,0:1
 *   oro #8E6725 → blanco 5,1:1 · oro claro #D7AD65 → pizarra 5,0:1
 *   piedra #B1A49A → pizarra 4,3:1 (solo con letra grande en negrita, ≥ 3:1)
 *
 * Gráficas: la marca es casi neutra (solo el oro tiene color), así que el
 * validador de la skill marca «croma bajo» en pizarra y piedra; es a propósito
 * (hacen de gris de de-énfasis). Lo que sí se cumple, con `validate_palette.js`:
 *   · Sobre papel: oro / pizarra / piedra (3 categorías) separación CVD 17,7 y
 *     visión normal 20,0 en todos los pares. La piedra queda a 2,3:1 del papel:
 *     va siempre con leyenda y cifra (canal de alivio).
 *   · Sobre la tarjeta pizarra: oro claro frente a piedra media, CVD 16,3 y
 *     visión normal 17,5; la piedra media (2,7:1) lleva el valor en cada barra.
 */

export const ANCHO_DIAPOSITIVA = 1280;
export const ALTO_DIAPOSITIVA = 720;

/** Familias propias (cargadas por `fuente.ts`): sans de apoyo y serif de marca. */
export const FAMILIA_INFORME = "Inter Informe";
export const FAMILIA_TITULOS = "Libre Baskerville Informe";
export const PILA_FUENTES = `"${FAMILIA_INFORME}", "Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
export const PILA_TITULOS = `"${FAMILIA_TITULOS}", "Libre Baskerville", "Bodoni MT", Georgia, serif`;

export const COLOR = {
  /** --ticket-paper hsl(36 50% 97%): fondo de las diapositivas. */
  papel: "#FBF8F4",
  /** --dark-slate / --primary hsl(206 11% 25%): titulares, cifras, texto y tarjetas. */
  pizarra: "#394147",
  /** --muted-foreground hsl(15 4% 35%): textos de apoyo. */
  tenue: "#5D5756",
  /** --mid-gray hsl(15 4% 39%): ejes. */
  grisMedio: "#67615F",
  blanco: "#FFFFFF",
  /** --stone-light hsl(25 13% 72%): texto secundario sobre la tarjeta pizarra. */
  tenueSobrePizarra: "#C1B6AE",
  /** --muted hsl(25 13% 85%): rejilla, filetes finos y días sin datos. */
  rejilla: "#DED8D4",
  /** --gold hsl(38 59% 35%): acento principal y serie principal. */
  oro: "#8E6725",
  /** --gold-light hsl(38 59% 62%): acento sobre la tarjeta pizarra. */
  oroClaro: "#D7AD65",
  /** --stone a 65 % de luz, hsl(25 13% 65%): series secundarias sobre papel. */
  piedra: "#B1A49A",
  /** --stone a 50 % de luz, hsl(25 13% 50%): barras secundarias sobre la tarjeta pizarra. */
  piedraSobrePizarra: "#907D6F",
} as const;
