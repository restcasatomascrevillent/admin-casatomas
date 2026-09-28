/**
 * Geometría del perímetro dibujado a mano (TS puro, sin Deno): corre bajo
 * vitest igual que chat-web/alergenos.ts.
 *
 * Por qué existe este módulo: el modelo pone la FORMA y nosotros ponemos la
 * ARITMÉTICA.
 *
 * Medido el 28/09/2026 con los dos croquis reales del restaurante (el comedor
 * de 11 mesas y la terraza de 18), gpt-5.4-mini recupera la forma de forma
 * impecable — en el comedor devolvió las 8 paredes y las 8 esquinas exactas al
 * metro — pero se equivoca al CALCULAR el área de una planta no convexa:
 * devolvió 95, 98, 98, 100, 103 y 104 m² en seis intentos sobre una sala que
 * mide 112 m². La fórmula del zapato (shoelace) aplicada a las esquinas que
 * devuelve ÉL MISMO da exactamente 112.
 *
 * Esto NO es corregir al modelo inventando datos: es no pedirle que haga a ojo
 * una cuenta que aquí sale exacta, gratis y de forma determinista.
 */

export interface Punto {
  x: number;
  y: number;
}

/** Longitud euclídea de un segmento. */
export function longitudSegmento(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

/**
 * Área del polígono por la fórmula del zapato (shoelace).
 *
 * Requiere las esquinas en orden de recorrido, que es como las devuelve el
 * modelo. Devuelve `null` si no hay al menos 3 esquinas, porque entonces no
 * hay polígono que medir y el llamante debe decidir qué hacer.
 */
export function areaPoligono(esquinas: Punto[]): number | null {
  if (esquinas.length < 3) return null;
  let suma = 0;
  for (let i = 0; i < esquinas.length; i++) {
    const a = esquinas[i];
    const b = esquinas[(i + 1) % esquinas.length];
    suma += a.x * b.y - b.x * a.y;
  }
  const area = Math.abs(suma) / 2;
  // Un area de 0 (o no finita) significa que las esquinas no forman un
  // poligono de verdad: vienen desordenadas, repetidas, alineadas o con
  // coordenadas ilegibles. Medido: con una variante del prompt que pedia
  // conservar todos los entrantes, el modelo devolvio una vez 10 esquinas
  // cuyo recorrido se cruza consigo mismo y el shoelace daba exactamente 0.
  // Devolver 0 m2 al lienzo seria peor que no calcular nada, asi que se
  // declara "no calculable" y el llamante cae a lo que dijera el modelo.
  if (!Number.isFinite(area) || area === 0) return null;
  return area;
}

/**
 * Perímetro como suma de las longitudes de las paredes, recalculadas desde sus
 * propios extremos (no desde el campo `length` que manda el modelo, que puede
 * venir descuadrado respecto a las coordenadas).
 *
 * Devuelve `null` si no hay paredes.
 */
export function perimetroDeParedes(
  paredes: Array<{ x1: number; y1: number; x2: number; y2: number }>,
): number | null {
  if (paredes.length === 0) return null;
  const total = paredes.reduce(
    (suma, p) => suma + longitudSegmento(p.x1, p.y1, p.x2, p.y2),
    0,
  );
  // Misma cautela que en areaPoligono: si alguna coordenada no era un numero,
  // el total sale NaN y es mejor declararlo no calculable que propagarlo.
  if (!Number.isFinite(total) || total === 0) return null;
  return total;
}

/**
 * Redondeo a 2 decimales: son metros, no hace falta más precisión y evita
 * arrastrar el ruido en coma flotante hasta la interfaz.
 */
export function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
