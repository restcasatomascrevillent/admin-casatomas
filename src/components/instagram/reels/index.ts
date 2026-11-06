/**
 * Reels en el panel (fase 5): editor de escenas, vista previa animada y el
 * pintor puro para el render futuro. Ver docs/instagram-reels.md.
 */
export { EditorReel, type EditorReelProps, type PeticionFotoReel } from "./EditorReel";
export { VistaPreviaReel, type ControlVistaPreviaReel, type VistaPreviaReelProps } from "./VistaPreviaReel";
export { EstudioReel, type EstudioReelProps } from "./EstudioReel";
export {
  pintarReelEnInstante,
  ReelEnInstante,
  crearReelDesdeBase,
  validarReel,
  INFO_BASES,
  type FotoElegida,
  type ReelPieza,
  type ResolverFoto,
} from "@/lib/instagram/reels";
