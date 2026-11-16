// ============================================================================
//  chat-facturas · Excel de un presupuesto -> texto (solo Deno, 16/11/2026)
// ----------------------------------------------------------------------------
//  Las hojas se pasan a CSV (una sección por hoja) y se leen con el mismo
//  prompt que un PDF. Va aparte de presupuesto.ts porque importa SheetJS desde
//  esm.sh y los tests de vitest (TS puro) no pueden cargarlo.
// ============================================================================
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const MAX_HOJAS = 5;

export function textoDeExcel(bytes: Uint8Array): string {
  const libro = XLSX.read(bytes, { type: "array" });
  const salida: string[] = [];
  for (const nombre of libro.SheetNames.slice(0, MAX_HOJAS)) {
    const csv = XLSX.utils.sheet_to_csv(libro.Sheets[nombre], { blankrows: false });
    if (csv.trim()) salida.push(`## Hoja: ${nombre}\n${csv}`);
  }
  return salida.join("\n\n");
}
