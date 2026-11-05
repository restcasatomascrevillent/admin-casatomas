/**
 * IA de textos de Instagram (Marketing). Ver docs/instagram-ia.md.
 *
 *   import { SugerirTextoIA } from "@/components/instagram/ia";
 *   <SugerirTextoIA contexto={…} onElegir={(caption, hashtags, altText) => …} />
 */
export { SugerirTextoIA, type SugerirTextoIAProps } from "./SugerirTextoIA";
export {
  ErrorIA,
  marcarElegida,
  sugerirRotulos,
  sugerirTexto,
  TONOS_IA,
  URL_IA,
  type CampoRotuloIA,
  type ContextoPiezaIA,
  type RespuestaRotulosIA,
  type RespuestaTextoIA,
  type RotulosIA,
  type TonoIA,
  type VarianteTextoIA,
} from "./api";
