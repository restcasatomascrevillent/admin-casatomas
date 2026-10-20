/** Vocabulario compartido por el editor y la carta pública. La cantidad forma
 * parte de la unidad del precio: 150 g significa euros por 150 gramos. */
export function normalizarUnidadPlato(valor?: string | null): string {
  const texto = (valor ?? "").trim().replace(/\s+/g, " ");
  const clave = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.$/, "");
  if (!clave || /^(unidad(es)?|ud(s)?|und(s)?|u|pieza(s)?)$/.test(clave))
    return "Unidad";
  if (/^(kg|kilo(s)?|kilogramo(s)?)$/.test(clave)) return "kg";
  if (/^(g|gr|grs|gramo(s)?)$/.test(clave)) return "1 g";
  const gramos = clave.match(/^(\d+(?:[.,]\d+)?)\s*(g|gr|grs|gramo(s)?)$/);
  if (gramos && Number(gramos[1].replace(",", ".")) > 0)
    return `${Number(gramos[1].replace(",", "."))} g`;
  if (/^racion(es)?$/.test(clave)) return "Ración";
  return texto;
}
export function gramosDeUnidad(valor?: string | null): number | null {
  const match = normalizarUnidadPlato(valor).match(/^(\d+(?:\.\d+)?) g$/);
  return match ? Number(match[1]) : null;
}
export function descomponerUnidad(valor?: string | null) {
  const unidad = normalizarUnidadPlato(valor);
  const gramos = gramosDeUnidad(unidad);
  return { unidad: gramos === null ? unidad : "gramos", gramos: gramos ?? 100 };
}
export function opcionesUnidadPlato(
  valores: readonly (string | null | undefined)[] = [],
): string[] {
  const opciones = [
    "Unidad",
    "kg",
    "gramos",
    ...valores.map((v) => descomponerUnidad(v).unidad),
  ];
  const vistos = new Set<string>();
  return opciones.filter((v) => {
    const key = v.toLocaleLowerCase();
    if (vistos.has(key)) return false;
    vistos.add(key);
    return true;
  });
}
export function guardarUnidadPlato(unidad: string, gramos?: number): string {
  if (unidad === "gramos") {
    if (!Number.isFinite(gramos) || !Number.isInteger(gramos) || gramos! <= 0)
      throw new Error("Indica una cantidad de gramos entera y mayor que cero");
    return `${gramos} g`;
  }
  return normalizarUnidadPlato(unidad);
}
