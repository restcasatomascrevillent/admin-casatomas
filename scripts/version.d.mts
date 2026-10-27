// Tipos de scripts/version.mjs para vite.config.ts.
export interface DatosVersion {
  version: string;
  mayor: number | null;
  numero: number | null;
  commit: string | null;
  rama: string | null;
  entorno: "produccion" | "demo" | "preview" | "local";
  aviso: string | null;
}
export function detectarEntorno(env?: Record<string, string | undefined>, rama?: string): DatosVersion["entorno"];
export function calcularVersion(opciones?: {
  ref?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  completarHistorial?: boolean;
}): DatosVersion;
