// ============================================================================
//  Modelo de visión configurable (04b §1.10)
// ----------------------------------------------------------------------------
//  Una sola fuente de verdad para el modelo, el `detail` de las imágenes y los
//  techos de tokens. La usan el camino síncrono (index.ts), la función
//  asíncrona (ocr-trabajo) y el banco local de Node. Sin Deno: recibe las
//  variables de entorno como objeto.
//
//  Secretos opcionales:
//    · OCR_MODELO         → modelo de los dos caminos (p. ej. "gpt-5.4-mini").
//    · OCR_MODELO_PIEZAS  → solo para las piezas de documentos largos
//                           (páginas/franjas), si se quiere otro distinto.
//    · OCR_DETALLE        → "high" para forzar el detail clásico.
//  Por defecto gpt-5.6-luna con detail "original". El dueño pidió gpt-5.4-mini
//  (05-oct-2026) condicionado al banco de 19 documentos reales, y el banco lo
//  descarta: empeora documentos cortos (Osborne 21: total 574,40 en vez de
//  5.713,40 en 3 de 3; Campoluz 30: 16-17 de 19 filas; Candela 24: 13 de 14)
//  y no termina Luga ni en franjas. gpt-5.6-luna: 313/315 filas en los cortos,
//  Luga 54/54 de una vez y en franjas, y la mitad de coste. Detalle en
//  docs/funcionalidades/04b-facturas-multipagina-plan.md §1.14. gpt-5-mini se
//  apaga el 11-dic-2026.
// ============================================================================

import type { EsquemaTokens } from "./imagen.ts";

export type DetalleImagen = "high" | "original";

export interface ConfigModelo {
  modelo: string;
  detalle: DetalleImagen;
  /** Algoritmo de reescalado de OpenAI que le toca a este modelo (imagen.ts). */
  esquemaTokens: EsquemaTokens;
  maxTokensExtraccion: number;
  maxTokensPie: number;
  maxTokensContador: number;
  /** Precio USD por millón de tokens (entrada, entrada cacheada, salida). Solo
   *  para estimar el coste que se guarda en ocr_trabajos; no factura nada. */
  precio: { entrada: number; cacheada: number; salida: number } | null;
}

export const MODELO_POR_DEFECTO = "gpt-5.6-luna";

/** `detail: "original"` solo existe a partir de gpt-5.4 (#2277 punto 7). En los
 *  demás la API lo rechaza con 400, así que se cae a "high". */
export function admiteDetalleOriginal(modelo: string): boolean {
  return /^gpt-5\.(4|5|6)(\b|-|$)/.test(modelo) || /^gpt-6/.test(modelo);
}

// Precios publicados (USD / 1M tokens) consultados el 28-sep-2026.
const PRECIOS: Record<string, { entrada: number; cacheada: number; salida: number }> = {
  "gpt-5-mini": { entrada: 0.25, cacheada: 0.025, salida: 2.0 },
  "gpt-5.4-mini": { entrada: 0.75, cacheada: 0.075, salida: 4.5 },
  "gpt-5.4": { entrada: 2.5, cacheada: 0.25, salida: 15.0 },
  "gpt-5.6-luna": { entrada: 0.2, cacheada: 0.02, salida: 1.2 },
  "gpt-5.6-terra": { entrada: 2.0, cacheada: 0.2, salida: 12.0 },
};

function precioDe(modelo: string) {
  const exacto = PRECIOS[modelo];
  if (exacto) return exacto;
  const base = Object.keys(PRECIOS).find((k) => modelo.startsWith(k + "-"));
  return base ? PRECIOS[base] : null;
}

/**
 * Lee `OCR_MODELO` (y `OCR_DETALLE`, opcional: "high" | "original") del entorno.
 * Un valor vacío o con espacios se ignora y se usa el de por defecto.
 */
export function configModelo(
  env: { OCR_MODELO?: string | null; OCR_MODELO_PIEZAS?: string | null; OCR_DETALLE?: string | null } = {},
  camino: "unico" | "piezas" = "unico",
): ConfigModelo {
  const piezas = camino === "piezas" ? (env.OCR_MODELO_PIEZAS ?? "").trim() : "";
  const pedido = piezas || (env.OCR_MODELO ?? "").trim();
  const modelo = /^[a-z0-9][a-z0-9.\-]{2,60}$/i.test(pedido) ? pedido : MODELO_POR_DEFECTO;
  const original = admiteDetalleOriginal(modelo);
  const detallePedido = (env.OCR_DETALLE ?? "").trim();
  const detalle: DetalleImagen = detallePedido === "high"
    ? "high"
    : original ? "original" : "high";
  return {
    modelo,
    detalle,
    // gpt-5-mini/nano: parches de 32 px con presupuesto de 2.500 (imagen.ts).
    // gpt-5.4+ con "original" no reescala por debajo de 10.000 parches: para el
    // diagnóstico del log se trata como "parches" (sin encoger en la práctica).
    esquemaTokens: "parches",
    // Mismos techos que v101 (index.ts): 32k para extraer 54 filas + razonamiento.
    maxTokensExtraccion: 32000,
    maxTokensPie: 4000,
    maxTokensContador: 6000,
    precio: precioDe(modelo),
  };
}

/** Coste estimado de una llamada a partir de `usage`. */
export function costeUsd(
  cfg: Pick<ConfigModelo, "precio">,
  // deno-lint-ignore no-explicit-any
  usage: any,
): number {
  if (!cfg.precio || !usage) return 0;
  const entrada = Number(usage.prompt_tokens ?? 0);
  const cacheada = Number(usage.prompt_tokens_details?.cached_tokens ?? 0);
  const salida = Number(usage.completion_tokens ?? 0);
  const usd = ((entrada - cacheada) * cfg.precio.entrada + cacheada * cfg.precio.cacheada +
    salida * cfg.precio.salida) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
