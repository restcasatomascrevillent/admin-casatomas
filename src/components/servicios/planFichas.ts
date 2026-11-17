/**
 * Super Admin › Servicios › Estado: cómo repartir las fichas para que TODAS quepan en el alto
 * de la pestaña, sin scroll y sin huecos (17/11/2026, el dueño: «que no haya scroll en la
 * pestaña de Estado»). Cuentas puras; el componente mide el sitio que hay y pinta lo que diga.
 *
 * Se prueba de más a menos detalle: la ficha completa, la compacta (mismos datos, más
 * apretada) y la mínima (anillos y estado, sin la lista de datos). Para cada una se usan las
 * columnas que quepan a lo ancho (menos filas = filas más altas) y se mira si las filas caben a
 * lo alto. Si ni la mínima cabe (un móvil con diez servicios), `null`: la pestaña vuelve a su
 * disposición de siempre, con scroll.
 */
export type DensidadFicha = "completa" | "compacta" | "minima";

export interface PlanFichas {
  densidad: DensidadFicha;
  /** Fichas de cada fila, de arriba abajo: repartidas parejas (10 en 3 filas → 4, 3, 3). */
  filas: number[];
  /** Alto de cada fila (px). */
  altoFila: number;
}

/** Ancho y alto mínimos (px) de una ficha en cada densidad. Medidos sobre la ficha real. */
export const MEDIDAS_FICHA: Record<DensidadFicha, { ancho: number; alto: number }> = {
  completa: { ancho: 180, alto: 236 },
  compacta: { ancho: 165, alto: 190 },
  minima: { ancho: 140, alto: 138 },
};

/** Por encima de esto una ficha estirada ya no gana nada: el resto del alto se queda libre. */
export const ALTO_MAXIMO_FILA = 300;

const ORDEN: DensidadFicha[] = ["completa", "compacta", "minima"];

/** `n` fichas en `filas` filas lo más parejas posible; las primeras se llevan las que sobran. */
export function repartirFichas(n: number, filas: number): number[] {
  const base = Math.floor(n / filas);
  const extra = n % filas;
  return Array.from({ length: filas }, (_, i) => base + (i < extra ? 1 : 0));
}

export function planFichas(args: { ancho: number; alto: number; n: number; hueco?: number }): PlanFichas | null {
  const { ancho, alto, n, hueco = 12 } = args;
  if (!(n > 0) || !(ancho > 0) || !(alto > 0)) return null;
  for (const densidad of ORDEN) {
    const m = MEDIDAS_FICHA[densidad];
    const columnas = Math.max(1, Math.min(n, Math.floor((ancho + hueco) / (m.ancho + hueco))));
    const filas = Math.ceil(n / columnas);
    const altoFila = Math.floor((alto - (filas - 1) * hueco) / filas);
    if (altoFila >= m.alto) return { densidad, filas: repartirFichas(n, filas), altoFila: Math.min(altoFila, ALTO_MAXIMO_FILA) };
  }
  return null;
}
