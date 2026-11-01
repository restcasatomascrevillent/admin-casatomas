/**
 * Dónde se sirven los ficheros de @ffmpeg/core (monohilo) en el propio panel.
 * Los copia/sirve el plugin `ffmpegCore` de vite.config.ts desde node_modules
 * (no se suben al repo, ~32 MB). La carpeta lleva la versión para poder
 * cachearlos como inmutables (vercel.json); si se actualiza @ffmpeg/core hay
 * que cambiarla aquí (el build falla si no coincide).
 */
export const VERSION_FFMPEG_CORE = "0.12.10";
export const RUTA_FFMPEG = `/ffmpeg/${VERSION_FFMPEG_CORE}`;
export const FICHEROS_FFMPEG = ["ffmpeg-core.js", "ffmpeg-core.wasm"] as const;
