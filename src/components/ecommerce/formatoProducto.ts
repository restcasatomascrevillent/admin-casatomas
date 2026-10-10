/** Precio en euros («-» si no hay). */
export function formatearPrecio(precio: number | null | undefined): string {
  if (precio == null) return "-";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(precio);
}

/** «Coste 4,00 € · +6,00 € (150%)» o `null` si falta el coste o el precio. Se pinta en el detalle de la fila. */
export function rentabilidadProducto(coste: number | null | undefined, precio: number | null | undefined): string | null {
  if (coste == null || precio == null) return null;
  const ganancia = precio - coste;
  const base = `Coste ${formatearPrecio(coste)} · ${ganancia >= 0 ? "+" : ""}${formatearPrecio(ganancia)}`;
  return coste > 0 ? `${base} (${((ganancia / coste) * 100).toFixed(0)}%)` : base;
}
