/** Datos de versión que calcula `scripts/version.mjs` al compilar (ver docs/PROCESO-DE-CAMBIOS.md). */
export interface VersionApp {
  /** "1.2.3" en producción y en la candidata (release/X.Y.Z); "1.2.3+abc1234" en la demo y el resto. */
  version: string;
  /** Última versión publicada (versionado.json). */
  publicada: string | null;
  /** true si el build lleva cambios todavía sin publicar (demo, ramas de trabajo). */
  desarrollo: boolean;
  commit: string | null;
  rama: string | null;
  entorno: "produccion" | "demo" | "preview" | "local";
  aviso: string | null;
}

/** La de este build. En los tests no hay build (vitest no aplica el `define` de Vite): "local". */
export const VERSION_APP: VersionApp = typeof __VERSION_APP__ !== "undefined"
  ? __VERSION_APP__
  : { version: "local", publicada: null, desarrollo: true, commit: null, rama: null, entorno: "local", aviso: null };

export const NOMBRE_ENTORNO: Record<VersionApp["entorno"], string> = {
  produccion: "Producción",
  demo: "Demo",
  preview: "Preview",
  local: "Local",
};
