// Unidad de una línea de factura: uds/unidades/ud/u/un → 'ud'; kg/kgs/kilos →
// 'kg'; l/lt/litros → 'l'; vacío → 'ud'; cualquier otra (caja, ca, m…) se deja
// en minúsculas y sin espacios de los bordes: no se inventa una equivalencia.
//
// ESPEJO A MANO de normalizarUnidad() en
// supabase/functions/procesar-factura/magnitudes.ts y de la función SQL
// public.normalizar_unidad_factura (migración 20261005160000), que además la
// aplica con un trigger en cada INSERT/UPDATE de productos_factura.unidad. Si
// cambias el mapa, cámbialo en los tres.
const SINONIMOS: [RegExp, string][] = [
  [/^(u|un|ud|uds|und|unds|uni|unid|unids|unidad|unidades)$/, "ud"],
  [/^(kg|kgs|kgr|kgrs|kilo|kilos|kilogramo|kilogramos)$/, "kg"],
  [/^(l|lt|lts|ltr|ltrs|litro|litros)$/, "l"],
];

export function normalizarUnidadFactura(u: string | null | undefined): string {
  const original = String(u ?? "").trim().toLowerCase();
  const s = original.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.\s]/g, "");
  if (!s) return "ud";
  for (const [re, v] of SINONIMOS) if (re.test(s)) return v;
  return original;
}
