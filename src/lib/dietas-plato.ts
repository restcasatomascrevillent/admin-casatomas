/**
 * Casilla «Vegetariano» de los platos (04/11/2026, dueño: «sí que tienen que haber productos
 * vegetarianos»). Se guarda en Platos.etiquetas_dieteticas (migración 20261104151000): un array con
 * 'vegetariano' y/o 'vegano', o NULL = sin confirmar. La web (web-casatomas, src/lib/filtros-carta.ts)
 * solo enseña en el filtro «Vegetariano» los platos que lo llevan; un plato vegano cuenta también.
 */
export type EtiquetaDietetica = "vegetariano" | "vegano";

function leer(valor: unknown): EtiquetaDietetica[] {
  const lista = Array.isArray(valor) ? valor : typeof valor === "string" && valor.trim().startsWith("[") ? safeParse(valor) : [];
  return lista.filter((e): e is EtiquetaDietetica => e === "vegetariano" || e === "vegano");
}

function safeParse(texto: string): unknown[] {
  try {
    const v = JSON.parse(texto);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** ¿El restaurante lo tiene marcado como vegetariano (o vegano)? */
export function esVegetariano(etiquetas: unknown): boolean {
  return leer(etiquetas).length > 0;
}

/**
 * Lo que hay que guardar al marcar o desmarcar la casilla. Marcarla añade 'vegetariano' (y conserva
 * 'vegano' si estaba); desmarcarla quita las dos (un vegano también es vegetariano). Sin ninguna,
 * NULL. Devuelve `{}` si no cambia nada: así el panel no manda la columna mientras no se toque (sigue
 * guardando aunque la migración aún no esté aplicada).
 */
export function cambioVegetariano(etiquetas: unknown, vegetariano: boolean): { etiquetas_dieteticas?: EtiquetaDietetica[] | null } {
  if (esVegetariano(etiquetas) === vegetariano) return {};
  if (!vegetariano) return { etiquetas_dieteticas: null };
  const actuales = leer(etiquetas);
  return { etiquetas_dieteticas: actuales.includes("vegetariano") ? actuales : ["vegetariano", ...actuales] };
}
