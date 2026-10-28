/** Datos de versión que calcula `scripts/version.mjs` al compilar (ver docs/PROCESO-DE-CAMBIOS.md). */
export interface VersionApp {
  version: string;
  mayor: number | null;
  numero: number | null;
  commit: string | null;
  rama: string | null;
  entorno: "produccion" | "demo" | "preview" | "local";
  aviso: string | null;
}

/** La de este build. En los tests no hay build (vitest no aplica el `define` de Vite): "local". */
export const VERSION_APP: VersionApp = typeof __VERSION_APP__ !== "undefined"
  ? __VERSION_APP__
  : { version: "local", mayor: null, numero: null, commit: null, rama: null, entorno: "local", aviso: null };

export const NOMBRE_ENTORNO: Record<VersionApp["entorno"], string> = {
  produccion: "Producción",
  demo: "Demo",
  preview: "Preview",
  local: "Local",
};
