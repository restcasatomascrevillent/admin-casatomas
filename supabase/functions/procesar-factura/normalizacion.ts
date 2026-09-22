// ============================================================================
//  normalizacion.ts · Helpers puros de parseo numérico para procesar-factura
// ----------------------------------------------------------------------------
//  Separado de index.ts a propósito: index.ts hace `Deno.env.get(...)` y
//  `serve(...)` como efecto de CARGAR el módulo, y ninguna de las dos cosas
//  existe fuera de Deno. Este fichero no importa nada de Deno ni de red y no
//  tiene efectos al importarlo, así que se puede testear con vitest/Node
//  (ver normalizacion.test.ts) además de usarse desde la Edge Function.
// ============================================================================

/**
 * Convierte un valor recibido del JSON del modelo (GPT-5 Vision, sin esquema
 * estricto porque la llamada usa `response_format: { type: "json_object" }`)
 * a `number`.
 *
 * Acepta:
 *  - `number` tal cual.
 *  - `string` con un importe en formato español ("1.234,56"), inglés
 *    ("1,234.56") o JSON estándar / sin separador de miles ("45.20", "1234").
 *    Ver `parseImporte` para el detalle de cómo se decide el formato.
 *  - `null` / `undefined` / `""` → `null` si `allowNull`, si no `0`.
 *  - Cualquier otro tipo (objeto, boolean, un string que no es un número
 *    reconocible...) → `null` si `allowNull`, si no `0`.
 */
export function toNumber(value: unknown, allowNull = false): number | null {
  if (allowNull && (value === null || value === undefined || value === "")) return null;
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseImporte(value);
    return parsed === null ? (allowNull ? null : 0) : parsed;
  }
  return allowNull ? null : 0;
}

/**
 * Parsea un importe en texto a `number`, detectando cuál de "," y "." es el
 * separador DECIMAL en vez de asumir siempre uno fijo (ese era el bug: un
 * `value.replace(",", ".")` a ciegas convertía "1.200,50" en "1.200.50", que
 * `parseFloat` corta en el primer punto sobrante y deja en 1.2 — el importe
 * se divide por mil en silencio).
 *
 * Reglas, en este orden:
 *
 *  1. Si aparecen LOS DOS separadores ("," y "."): el que esté MÁS A LA
 *     DERECHA es el decimal (es el último que se escribe); el otro (y sus
 *     repeticiones) es de miles y se elimina.
 *       "1.234,56" → miles "."  decimal ","  → 1234.56  (España)
 *       "1,234.56" → miles ","  decimal "."  → 1234.56  (formato inglés)
 *       "1.234.567,89" → 1234567.89 (varios grupos de miles, España)
 *
 *  2. Si aparece UN SOLO tipo de separador:
 *     - Si se repite ("1.234.567" o "1,234,567") no puede ser decimal — un
 *       número no lleva dos comas/puntos decimales — así que es de miles:
 *       se eliminan todas sus apariciones.
 *     - Si aparece una única vez y le siguen EXACTAMENTE 3 dígitos
 *       ("1.234" o "1,234") se interpreta como separador de MILES sin parte
 *       decimal. En importes de factura (euros) es rarísimo tener 3
 *       decimales, y sí es habitual escribir miles redondos así. Es una
 *       ambigüedad real (podría ser 1.234 con tres decimales) que se
 *       resuelve a favor del caso más probable en este dominio.
 *     - En cualquier otro caso (1-2 dígitos detrás, 4 o más, o ninguno) se
 *       interpreta como separador DECIMAL.
 *
 *  3. Sin separadores: `parseFloat` tal cual (cubre el caso que ya
 *     funcionaba: "45.20" → 45.20, formato JSON estándar).
 *
 * Devuelve `null` si el resultado no es un número válido, para que el
 * llamante decida el valor por defecto según `allowNull`.
 */
export function parseImporte(raw: string): number | null {
  let s = raw.trim();
  if (s === "") return null;

  let negativo = false;
  if (s.startsWith("-")) {
    negativo = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  // Fuera símbolos de moneda, espacios (incluido NBSP) u otro ruido que a
  // veces cuela el OCR/el modelo: "1.234,56 €", "1 234,56".
  s = s.replace(/[^\d.,]/g, "");
  if (s === "") return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  let normalizado: string;

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      // Español: "." de miles, "," decimal.
      normalizado = s.replace(/\./g, "").replace(",", ".");
    } else {
      // Inglés: "," de miles, "." decimal.
      normalizado = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    const apariciones = s.split(",").length - 1;
    const digitosDetras = s.length - lastComma - 1;
    normalizado = apariciones > 1 || digitosDetras === 3
      ? s.replace(/,/g, "") // miles
      : s.replace(",", "."); // decimal
  } else if (lastDot !== -1) {
    const apariciones = s.split(".").length - 1;
    const digitosDetras = s.length - lastDot - 1;
    normalizado = apariciones > 1 || digitosDetras === 3
      ? s.replace(/\./g, "") // miles
      : s; // decimal: el "." ya es válido para parseFloat
  } else {
    normalizado = s;
  }

  const n = parseFloat(normalizado);
  if (isNaN(n)) return null;
  return negativo ? -n : n;
}
