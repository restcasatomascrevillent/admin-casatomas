// ============================================================================
//  chat-facturas · Excel de un presupuesto -> filas (solo Deno, 16/11/2026)
// ----------------------------------------------------------------------------
//  Cada hoja se devuelve como filas de celdas (números como números). La
//  lectura de columnas la hace hoja.ts, sin LLM por fila. Va aparte de
//  presupuesto.ts porque importa SheetJS desde esm.sh y los tests de vitest
//  (TS puro) no pueden cargarlo.
// ============================================================================
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import type { Filas } from "./hoja.ts";

const MAX_HOJAS = 5;

export function filasDeExcel(bytes: Uint8Array): Array<{ hoja: string; filas: Filas }> {
  const libro = XLSX.read(bytes, { type: "array" });
  return libro.SheetNames.slice(0, MAX_HOJAS).map((hoja: string) => ({
    hoja,
    filas: XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, raw: true, blankrows: false, defval: null }) as Filas,
  }));
}
