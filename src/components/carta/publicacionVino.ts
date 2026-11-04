/**
 * Publicación de un vino: un interruptor por carta (04/11/2026, dueño: «que el
 * toggle de restaurante o touza sea para si está activo en web o no, el otro
 * toggle quítalo para no duplicar»).
 *
 *   · Restaurante → sale en la carta de la web de Casa Tomás (y en su tienda).
 *   · Touza       → sale en la carta de Touza.
 *   · Los dos apagados → no sale en ninguna.
 *
 * `activado` ya no tiene interruptor: la base de datos lo calcula
 * (restaurante OR touza, migración 20261104100000_vinos_publicacion_por_carta).
 */

export interface CartasVino {
  restaurante: boolean;
  touza: boolean;
}

/**
 * Lo que de verdad sale en cada carta: la web pide `activado AND restaurante`
 * (Touza, `activado AND touza`). Con la migración aplicada es igual que
 * `restaurante`/`touza`; sin ella (panel nuevo con la BD aún sin migrar), un
 * vino con `activado = false` se ve apagado en las dos, como en la web.
 */
export function cartasVino(vino: { activado?: boolean | null; restaurante?: boolean | null; touza?: boolean | null }): CartasVino {
  const activo = vino.activado !== false;
  return { restaurante: activo && vino.restaurante === true, touza: activo && vino.touza === true };
}

export const vinoPublicado = (cartas: CartasVino) => cartas.restaurante || cartas.touza;

/** Explicación de los dos interruptores (una vez, encima de las tarjetas). */
export const EXPLICACION_CARTAS_VINO =
  "Restaurante: sale en la carta de la web de Casa Tomás. Touza: sale en la carta de Touza. Con los dos apagados no se publica. Para publicarlo hace falta su origen (país, región y denominación).";

/** Lo que hacen ahora los interruptores de la tarjeta, en una línea. */
export function textoPublicacionVino(cartas: CartasVino): string {
  if (cartas.restaurante && cartas.touza) return "Sale en la carta de Casa Tomás y en la de Touza.";
  if (cartas.restaurante) return "Sale solo en la carta de la web de Casa Tomás.";
  if (cartas.touza) return "Sale solo en la carta de Touza.";
  return "No sale en ninguna carta.";
}
