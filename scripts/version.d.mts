// Tipos de scripts/version.mjs para vite.config.ts.
export interface DatosVersion {
  /** "1.2.3" en main y release/X.Y.Z; "1.2.3+abc1234" en la demo y el resto de ramas. */
  version: string;
  /** Última versión publicada (la de versionado.json). */
  publicada: string | null;
  /** true si el build lleva cambios todavía sin publicar (demo, ramas de trabajo, local). */
  desarrollo: boolean;
  commit: string | null;
  rama: string | null;
  entorno: "produccion" | "demo" | "preview" | "local";
  aviso: string | null;
}
export function detectarEntorno(env?: Record<string, string | undefined>, rama?: string): DatosVersion["entorno"];
export function esRamaDePublicacion(rama: string | null | undefined): boolean;
export function calcularVersion(opciones?: {
  ref?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
}): DatosVersion;
