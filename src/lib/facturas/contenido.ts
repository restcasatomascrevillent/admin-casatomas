/** «10,5» o «10.5» → 10.5; vacío o fuera de (0, 1000] → null. Contenido por caja o unidad (Compras › ficha de producto). */
export function leerContenido(texto: string): number | null {
  const n = Number(texto.trim().replace(",", "."));
  return texto.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 1000 ? n : null;
}
