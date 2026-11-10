// «Menú cerrado» (de grupo) y su precio — dueño, 10/11/2026: «que se pueda poner
// si hay menú o no hay, y si hay que ponga el precio de ese menú» (p. ej. un menú
// de grupo de 55 €). NO es el «Menú del día» (`reservas.menu_del_dia`, martes a
// jueves a mediodía, ver menuDelDia.ts): son columnas propias,
// `reservas.menu_cerrado` y `reservas.menu_precio` (migración 20261122190000).
// Se puede marcar cualquier día. Puro, sin I/O.

/** Precio máximo que admite la columna numeric(6,2). */
export const PRECIO_MENU_MAXIMO = 9999.99;

/**
 * "18", "18,5", "18.50", " 18,50 € " → 18 / 18.5 / 18.5. Vacío → null (menú sin
 * precio). Texto que no es un precio válido (negativo, letras, más de 2
 * decimales, demasiado grande) → undefined.
 */
export function leerPrecioMenu(texto: string | number | null | undefined): number | null | undefined {
  if (texto == null) return null;
  if (typeof texto === "number") return Number.isFinite(texto) && texto >= 0 && texto <= PRECIO_MENU_MAXIMO ? texto : undefined;
  const limpio = texto.replace(/€/g, "").replace(/\s+/g, "").replace(",", ".");
  if (limpio === "") return null;
  if (!/^\d{1,4}(\.\d{0,2})?$/.test(limpio)) return undefined;
  const n = Number(limpio);
  return Number.isFinite(n) && n <= PRECIO_MENU_MAXIMO ? Math.round(n * 100) / 100 : undefined;
}

/** Error legible del campo «Precio del menú (€)», o null si vale (vacío también vale). */
export function errorPrecioMenu(texto: string | null | undefined): string | null {
  return leerPrecioMenu(texto) === undefined ? "Escribe un precio válido, p. ej. 18 o 18,50" : null;
}

/** 18 → "18 €", 18.5 → "18,50 €". */
export function formatearPrecioMenu(precio: number | string | null | undefined): string | null {
  if (precio == null || precio === "") return null;
  const n = Number(precio);
  if (!Number.isFinite(n)) return null;
  const texto = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",");
  return `${texto} €`;
}

/** Texto de la insignia: «Menú 55 €» con precio, «Menú cerrado» sin él. */
export function textoInsigniaMenu(precio: number | string | null | undefined, sinPrecio = "Menú cerrado"): string {
  const p = formatearPrecioMenu(precio);
  return p ? `Menú ${p}` : sinPrecio;
}

/** El precio guardado (numeric llega como número o texto) en el formato del campo: 18.5 → "18,50". */
export function precioMenuParaCampo(precio: number | string | null | undefined): string {
  const p = formatearPrecioMenu(precio);
  return p ? p.replace(" €", "") : "";
}
