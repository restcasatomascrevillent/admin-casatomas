import * as z from "zod";

/**
 * Precio en carta de vinos y bebidas (alta y edición). Compartido por los
 * cuatro formularios para que la regla y los mensajes no se separen.
 *
 * - Acepta «4,50» y «4.50» (y espacios alrededor).
 * - Vacío, letras, 0 o negativo: no se guarda y sale el mensaje junto al campo.
 *   0 € no es un precio válido: la web publicaría «0€».
 * - Como mucho 2 decimales y hasta 9.999,99 € (la columna es numeric).
 *
 * El campo es `type="text" inputMode="decimal"` (ver `propsCampoPrecio`):
 * con `type="number"` el navegador pone su propio aviso para negativos o
 * letras (F-42) y en algunos teclados no deja escribir la coma.
 */
export const PRECIO_MAX = 9999.99;

export const MENSAJES_PRECIO = {
  obligatorio: "Pon el precio",
  noNumero: "El precio tiene que ser un número, p. ej. 4,50",
  noPositivo: "El precio tiene que ser mayor que 0 €",
  decimales: "El precio admite como mucho 2 decimales",
  maximo: "El precio no puede pasar de 9.999,99 €",
} as const;

/** Convierte lo escrito en número; deja el texto tal cual si no lo es (para que salga «no es un número»). */
export function normalizarPrecio(valor: unknown): unknown {
  if (typeof valor === "number") return Number.isNaN(valor) ? undefined : valor;
  if (valor === null || valor === undefined) return undefined;
  if (typeof valor !== "string") return valor;
  const limpio = valor.trim().replace(",", ".");
  if (limpio === "") return undefined;
  return /^-?\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : valor;
}

export const esquemaPrecioCarta = z.preprocess(
  normalizarPrecio,
  z
    .number({ required_error: MENSAJES_PRECIO.obligatorio, invalid_type_error: MENSAJES_PRECIO.noNumero })
    .positive(MENSAJES_PRECIO.noPositivo)
    .max(PRECIO_MAX, MENSAJES_PRECIO.maximo)
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, MENSAJES_PRECIO.decimales),
);

/** Valor del campo al abrir un formulario de edición (texto; vacío si no hay precio). */
export function precioParaCampo(precio: number | null | undefined): string {
  return precio === null || precio === undefined ? "" : String(precio);
}

/** Props del `<Input>` de precio: texto con teclado decimal, sin validación nativa. */
export const propsCampoPrecio = {
  type: "text",
  inputMode: "decimal",
  autoComplete: "off",
} as const;
