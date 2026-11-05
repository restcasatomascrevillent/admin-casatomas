/**
 * Instagram › Crear (rediseño a dos columnas, 05/11/2026). Ver CrearInstagram.tsx.
 * Contratos: «Montar con IA» en montar.ts (src/lib/instagram/montar.ts) y
 * publicar/programar sin prueba en publicar.ts (prepararYPublicar).
 */
export { CrearInstagram, type CrearInstagramProps } from "./CrearInstagram";
export { montarPieza, crearMontadorSimulado, normalizarRespuestaMontar, type Montador, type EntradaMontar } from "./montar";
export {
  prepararYPublicar,
  continuarPublicacion,
  crearApiSimulada,
  API_SERVIDOR,
  type ApiPublicacion,
  type PeticionPublicacion,
  type ResultadoPublicacion,
  type Progreso,
} from "./publicar";
export { estadoDesdePieza, type PiezaParaAbrir } from "./estado";
