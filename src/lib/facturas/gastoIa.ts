// ============================================================================
//  MONITOR DE GASTO DE IA EN FACTURAS — cuentas puras (sin DOM)
// ----------------------------------------------------------------------------
//  Encargo del dueño (08-oct-2026): lo gastado en IA el último mes, en EUROS,
//  por proceso, visible en «IA» (chatbot) y en «Cargar» (OCR). Los datos
//  salen de `gasto_ia_resumen` (agregados de `ia_uso`, en USD) y se pasan a
//  euros con el MISMO tipo de cambio que Super Admin › Costes (`USD_EUR`).
//
//  Regla de oro de Costes: sin filas = «sin datos todavía», nunca «0 €».
// ============================================================================

import { USD_EUR } from "@/components/costes/formato";

export { USD_EUR };

/** Una fila de `gasto_ia_resumen` (una por función). */
export interface FilaGastoIa {
  funcion: string;
  coste_usd: number | null;
  filas: number;
  llamadas: number;
  /** Preguntas (chat), tandas (clasificación) o documentos distintos (OCR). */
  unidades: number;
  filas_sin_tarifa: number;
  /** Documentos distintos entre procesar-factura y ocr-trabajo (igual en todas las filas). */
  documentos_ocr: number;
  ultima: string | null;
}

export type ModoMonitor = "chat" | "ocr";

/** Funciones que entran en el monitor (las mismas que acepta la RPC). */
export const FUNCIONES_GASTO_IA = ["chat-facturas", "procesar-factura", "ocr-trabajo", "clasificar-productos"] as const;
export const DIAS_GASTO_IA = 30;

export interface LineaDesglose {
  clave: "chat" | "ocr" | "clasificacion";
  etiqueta: string;
  /** null = sin filas todavía. */
  eur: number | null;
  unidades: number;
  unidad: string;
}

export interface ResumenGastoIa {
  /** Gasto del proceso de la pestaña (EUR). null = sin datos todavía. */
  eur: number | null;
  unidades: number;
  /** «pregunta» o «documento», ya en singular/plural según `unidades`. */
  unidadTexto: string;
  porUnidadEur: number | null;
  desglose: LineaDesglose[];
  /** Todo lo de Facturas (EUR). null si no hay ninguna fila. */
  totalFacturasEur: number | null;
  /** Filas con un modelo sin tarifa: su coste no se suma (aviso). */
  filasSinTarifa: number;
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** USD → EUR con el tipo de Costes. null se queda null. */
export const usdAEur = (usd: number | null | undefined): number | null =>
  usd === null || usd === undefined || !Number.isFinite(Number(usd)) ? null : Number(usd) * USD_EUR;

/** Normaliza lo que llega de PostgREST (numeric puede venir como texto). */
export function normalizarFilas(datos: unknown): FilaGastoIa[] {
  if (!Array.isArray(datos)) return [];
  return datos
    .filter((f) => f && typeof f === "object" && typeof (f as FilaGastoIa).funcion === "string")
    .map((f) => {
      const r = f as Record<string, unknown>;
      return {
        funcion: String(r.funcion),
        coste_usd: r.coste_usd === null || r.coste_usd === undefined ? null : n(r.coste_usd),
        filas: n(r.filas),
        llamadas: n(r.llamadas),
        unidades: n(r.unidades),
        filas_sin_tarifa: n(r.filas_sin_tarifa),
        documentos_ocr: n(r.documentos_ocr),
        ultima: typeof r.ultima === "string" ? r.ultima : null,
      };
    });
}

/** Suma de coste (USD) de unas funciones. null si no hay ninguna fila con coste. */
function sumaUsd(filas: FilaGastoIa[], funciones: string[]): number | null {
  const propias = filas.filter((f) => funciones.includes(f.funcion) && f.filas > 0);
  if (propias.length === 0) return null;
  const conCoste = propias.filter((f) => f.coste_usd !== null);
  return conCoste.length === 0 ? null : conCoste.reduce((s, f) => s + (f.coste_usd ?? 0), 0);
}

const plural = (k: number, uno: string, varios: string) => (k === 1 ? uno : varios);

export function resumirGastoIa(filas: FilaGastoIa[], modo: ModoMonitor): ResumenGastoIa {
  const chat = filas.find((f) => f.funcion === "chat-facturas");
  const clasif = filas.find((f) => f.funcion === "clasificar-productos");
  const docsOcr = filas.find((f) => f.funcion === "procesar-factura" || f.funcion === "ocr-trabajo")?.documentos_ocr ?? 0;

  const eurChat = usdAEur(sumaUsd(filas, ["chat-facturas"]));
  const eurOcr = usdAEur(sumaUsd(filas, ["procesar-factura", "ocr-trabajo"]));
  const eurClasif = usdAEur(sumaUsd(filas, ["clasificar-productos"]));

  const desglose: LineaDesglose[] = [
    { clave: "chat", etiqueta: "Chatbot de facturas", eur: eurChat, unidades: chat?.unidades ?? 0, unidad: plural(chat?.unidades ?? 0, "pregunta", "preguntas") },
    { clave: "ocr", etiqueta: "Lectura de facturas (OCR)", eur: eurOcr, unidades: docsOcr, unidad: plural(docsOcr, "documento", "documentos") },
    { clave: "clasificacion", etiqueta: "Clasificación de productos", eur: eurClasif, unidades: clasif?.unidades ?? 0, unidad: plural(clasif?.unidades ?? 0, "tanda", "tandas") },
  ];

  const sumaNull = (vs: (number | null)[]): number | null =>
    vs.every((v) => v === null) ? null : vs.reduce<number>((s, v) => s + (v ?? 0), 0);

  let eur: number | null;
  let unidades: number;
  let unidadTexto: string;
  if (modo === "chat") {
    eur = eurChat;
    unidades = chat?.unidades ?? 0;
    unidadTexto = plural(unidades, "pregunta", "preguntas");
  } else {
    // Sin lecturas registradas todavía, el OCR está «sin datos» aunque haya
    // alguna tanda de clasificación: el coste por documento no tendría base.
    eur = eurOcr === null ? null : sumaNull([eurOcr, eurClasif]);
    unidades = docsOcr;
    unidadTexto = plural(unidades, "documento", "documentos");
  }

  return {
    eur,
    unidades,
    unidadTexto,
    porUnidadEur: eur !== null && unidades > 0 ? eur / unidades : null,
    desglose,
    totalFacturasEur: sumaNull([eurChat, eurOcr, eurClasif]),
    filasSinTarifa: filas.reduce((s, f) => s + f.filas_sin_tarifa, 0),
  };
}

const fmt = (dec: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const f2 = fmt(2);
const f3 = fmt(3);
const f4 = fmt(4);

/**
 * Euros de IA: las cifras son de céntimos y milésimas, así que los decimales
 * crecen al bajar el importe (con 2 decimales todo sería «0,00 €» y parecería
 * gratis). null → «sin datos».
 */
export function fmtEurIa(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "sin datos";
  const a = Math.abs(v);
  if (a === 0) return "0 €";
  if (a >= 0.1) return `${f2.format(v)} €`;
  if (a >= 0.001) return `${f3.format(v)} €`;
  return `${f4.format(v)} €`;
}
