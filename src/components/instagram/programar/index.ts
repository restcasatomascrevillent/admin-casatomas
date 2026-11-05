/**
 * Publicaciones programadas de Instagram (ver docs/instagram-programar.md).
 * Componentes autocontenidos: cada uno trae sus datos (TanStack Query) y sus
 * acciones; basta con montarlos dentro del QueryClientProvider del panel.
 */
export { ProgramarPiezaDialog, type ProgramarPiezaDialogProps } from "./ProgramarPiezaDialog";
export { CalendarioInstagram, type CalendarioInstagramProps } from "./CalendarioInstagram";
export {
  CLAVE_PROGRAMACION,
  useAccionesProgramacion,
  useCalendarioInstagram,
  useProgramacionDePieza,
  type ProgramacionInstagram,
} from "./useProgramacionInstagram";
export { validarProgramacion, madridAUtc, utcAMadrid, textoInstante } from "./logica";
