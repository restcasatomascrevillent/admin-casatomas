// ============================================================================
//  Cifras que nunca se cortan (Facturas › Análisis, 06/11/2026)
// ----------------------------------------------------------------------------
//  Con la IA abierta o en el móvil, una tarjeta puede quedarse sin sitio para
//  «1.362.491,57 €» y antes salía «1.362.491,…». Ahora cada cifra trae de más
//  larga a más corta las formas que valen:
//      1.362.491,57 €  →  1.362.492 €  →  1,36 M €
//  y se enseña la primera que cabe (la cifra completa sigue en el `title` y
//  para el lector de pantalla). Aquí solo el texto; medir es cosa de React.
// ============================================================================

const EUR = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
const DEC = (min: number, max: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
const DEC_0_1 = DEC(0, 1);
const DEC_0_2 = DEC(0, 2);
const miles = (n: number) => String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** Signo menos tipográfico (el de los abonos en todo Análisis). */
const conSigno = (n: number, s: string) => (n < 0 ? `−${s}` : s);
/** Espacio duro (como `Intl`): la cifra y su «€» no se separan nunca. */
const E = "\u00a0";

/** «1.362.491,57 €» (con «−» tipográfico). */
export const importeCompleto = (n: number): string => EUR.format(n).replace(/^-/, "−");

/**
 * Forma abreviada: «1,36 M €» · «14,4 k €» · «850 €». Dos decimales en
 * millones (1,36 M) y uno en miles: lo justo para no confundir dos cifras
 * del mismo tablero.
 */
export function importeAbreviado(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return conSigno(n, `${DEC_0_2.format(abs / 1_000_000)}${E}M${E}€`);
  if (abs >= 10_000) return conSigno(n, `${DEC_0_1.format(abs / 1_000)}${E}k${E}€`);
  return conSigno(n, `${miles(abs)}${E}€`);
}

/** Las formas de un importe, de la más larga a la más corta (sin repetir). */
export function formasImporte(n: number | null | undefined): string[] {
  if (n === null || n === undefined || !Number.isFinite(n)) return ["—"];
  const formas = [importeCompleto(n), conSigno(n, `${miles(n)}${E}€`), importeAbreviado(n)];
  return formas.filter((f, i) => formas.indexOf(f) === i);
}

/** Entero: «1.883» → «1,9 k» solo si hace falta (casi nunca). */
export function formasEntero(n: number): string[] {
  const largo = conSigno(n, miles(n));
  const corto = Math.abs(n) >= 10_000 ? conSigno(n, `${DEC_0_1.format(Math.abs(n) / 1000)}${E}k`) : largo;
  return corto === largo ? [largo] : [largo, corto];
}
