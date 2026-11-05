/**
 * Reels de Instagram (fase 5): motor de tiempo, esquema ReelPieza, las 5
 * bases y ReelKit (el reel pintado en un instante t). Ver docs/instagram-reels.md.
 *
 * Va aparte de src/lib/instagram/index.ts a propósito: ReelKit usa React y ese
 * índice lo importan también las funciones de Vercel.
 */
export * from "./motor.js";
export * from "./marca.js";
export * from "./fotos.js";
export * from "./esquema.js";
export * from "./bases.js";
export * from "./edicion.js";
export { ReelEnInstante, ZonaSeguraReel, pintarReelEnInstante, type OpcionesPintarReel, type ReelEnInstanteProps } from "./ReelKit.js";
export * from "./captura.js";
