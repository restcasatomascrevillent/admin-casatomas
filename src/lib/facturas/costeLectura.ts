// ============================================================================
//  Coste de LEER cada documento (10-oct-2026) — cuentas puras (sin DOM)
// ----------------------------------------------------------------------------
//  El extractor (procesar-factura + ocr-trabajo) guarda en
//  `facturas.coste_lectura_usd` lo que costó leer cada documento (todas sus
//  llamadas a OpenAI). La RPC `estadisticas_lectura(p_dias)` (migración
//  20261010120000) resume una ventana: documentos, total, media, mediana, el
//  más caro y el reparto por nº de páginas y de líneas. Las cifras son de
//  céntimos, así que aquí se enseñan en CÉNTIMOS DE EURO («0,4 cént.»).
// ============================================================================

import { USD_EUR } from "@/components/costes/formato";

export interface TramoLectura {
  tramo: string;
  documentos: number;
  mediaUsd: number;
  totalUsd: number;
}

export interface MasCaraLectura {
  id: number;
  proveedor: string | null;
  numero: string | null;
  usd: number;
}

export interface EstadisticasLectura {
  documentos: number;
  totalUsd: number | null;
  mediaUsd: number | null;
  medianaUsd: number | null;
  llamadasMedia: number | null;
  masCara: MasCaraLectura | null;
  porPaginas: TramoLectura[];
  porLineas: TramoLectura[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function tramos(v: unknown): TramoLectura[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => {
      const r = (t ?? {}) as Record<string, unknown>;
      return {
        tramo: String(r.tramo ?? ""),
        documentos: num(r.documentos) ?? 0,
        mediaUsd: num(r.media_usd) ?? 0,
        totalUsd: num(r.total_usd) ?? 0,
      };
    })
    .filter((t) => t.tramo && t.documentos > 0);
}

/** Respuesta de `estadisticas_lectura` (una fila) → objeto tipado. Basura o sin documentos → null. */
export function normalizarEstadisticasLectura(datos: unknown): EstadisticasLectura | null {
  const fila = (Array.isArray(datos) ? datos[0] : datos) as Record<string, unknown> | null | undefined;
  if (!fila || typeof fila !== "object") return null;
  const documentos = Math.round(num(fila.documentos) ?? 0);
  if (documentos <= 0) return null;
  const idCara = num(fila.mas_cara_id);
  const usdCara = num(fila.mas_cara_usd);
  return {
    documentos,
    totalUsd: num(fila.total_usd),
    mediaUsd: num(fila.media_usd),
    medianaUsd: num(fila.mediana_usd),
    llamadasMedia: num(fila.llamadas_media),
    masCara:
      idCara !== null && usdCara !== null
        ? {
            id: idCara,
            proveedor: typeof fila.mas_cara_proveedor === "string" ? fila.mas_cara_proveedor : null,
            numero: typeof fila.mas_cara_numero === "string" ? fila.mas_cara_numero : null,
            usd: usdCara,
          }
        : null,
    porPaginas: tramos(fila.por_paginas),
    porLineas: tramos(fila.por_lineas),
  };
}

const f0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const f1 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * USD → «3,1 cént.» (céntimos de euro). Los decimales crecen al bajar el
 * importe para que una lectura de 0,05 cént. no salga como «0 cént.».
 * null → «sin datos».
 */
export function fmtCentimos(usd: number | null | undefined, eurPorUsd: number = USD_EUR): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "sin datos";
  const c = usd * eurPorUsd * 100;
  const a = Math.abs(c);
  if (a === 0) return "0 cént.";
  if (a >= 10) return `${f0.format(c)} cént.`;
  if (a >= 0.1) return `${f1.format(c)} cént.`;
  return `${f2.format(c)} cént.`;
}

const SUFIJOS_LEGALES = /^(s\.?l\.?u?\.?|s\.?a\.?u?\.?|s\.?c\.?|c\.?b\.?|s\.?l\.?l\.?|sl|sa|slu|sau)$/i;
/** Primeras palabras que no identifican a un proveedor («Salazones Garre» → Garre). */
const GENERICAS = new Set([
  "salazones", "distribuciones", "distribuidora", "hermanos", "hnos", "grupo", "comercial", "industrias", "frutas",
  "pescados", "carnicas", "cárnicas", "bebidas", "el", "la", "los", "las", "de", "del", "mercadona",
]);

/** «LUGA SABORES S.L.» → «Luga»; «Salazones Garre» → «Garre»; «Racionalismo Dulce, S.L.» → «Racionalismo». */
export function nombreCortoProveedor(proveedor: string | null | undefined): string {
  const palabras = (proveedor ?? "")
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p && !SUFIJOS_LEGALES.test(p));
  if (palabras.length === 0) return "";
  const elegida = palabras.find((p) => !GENERICAS.has(p.toLowerCase())) ?? palabras[0];
  const limpia = elegida.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return limpia.charAt(0).toUpperCase() + limpia.slice(1).toLowerCase();
}

/** «12 docs · media 0,8 cént./doc · más cara: Luga 3,1 cént.» (null si no hay documentos medidos). */
export function textoResumenLectura(e: EstadisticasLectura | null | undefined, eurPorUsd: number = USD_EUR): string | null {
  if (!e || e.documentos <= 0) return null;
  const partes = [`${f0.format(e.documentos)} ${e.documentos === 1 ? "doc" : "docs"}`];
  if (e.mediaUsd !== null) partes.push(`media ${fmtCentimos(e.mediaUsd, eurPorUsd)}/doc`);
  if (e.masCara) {
    const quien = nombreCortoProveedor(e.masCara.proveedor) || e.masCara.numero || `n.º ${e.masCara.id}`;
    partes.push(`más cara: ${quien} ${fmtCentimos(e.masCara.usd, eurPorUsd)}`);
  }
  return partes.join(" · ");
}

/** Número de `coste_usd` de una respuesta de procesar-factura / resultado de un trabajo; null si no hay. */
export function costeDeRespuesta(data: unknown): number | null {
  const n = num((data as { coste_usd?: unknown } | null | undefined)?.coste_usd);
  return n !== null && n >= 0 ? n : null;
}
