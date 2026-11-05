/**
 * Campañas e ideas de la semana de Instagram (fase 2). Ver docs/instagram-campanas.md.
 *
 *   import { CampanasInstagram, SugerenciaSemana } from "@/components/instagram/campanas";
 */
export { CampanasInstagram, type CampanasInstagramProps } from "./CampanasInstagram";
export { SugerenciaSemana, type SugerenciaSemanaProps } from "./SugerenciaSemana";
export {
  aceptarCampana,
  CLAVE_CAMPANAS,
  descartarCampana,
  fechasEntre,
  leerPieza,
  listarCampanas,
  pedirIdeasSemana,
  proponerCampana,
  type CampanaInstagram,
  type IdeaSemanaIA,
  type PiezaCampanaIA,
  type PropuestaCampana,
} from "./api";
