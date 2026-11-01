import { createContext, useContext } from "react";
import type { NuevoTrabajoVideo, TrabajoVideo } from "./colaVideos";

export interface ContextoColaVideos {
  trabajos: readonly TrabajoVideo[];
  /** Pone el vídeo en la cola (y pide permiso de notificaciones la 1ª vez). Devuelve el id. */
  encolar: (nuevo: NuevoTrabajoVideo) => string;
  cancelar: (id: string) => void;
  reintentar: (id: string) => void;
  /** false = no hay ColaVideosProvider montado (tests de formularios sueltos). */
  disponible: boolean;
}

const SIN_COLA: ContextoColaVideos = {
  trabajos: [],
  encolar: () => {
    console.warn("[video-plato] no hay ColaVideosProvider montado");
    return "";
  },
  cancelar: () => undefined,
  reintentar: () => undefined,
  disponible: false,
};

export const ColaVideosContext = createContext<ContextoColaVideos>(SIN_COLA);

export function useColaVideos(): ContextoColaVideos {
  return useContext(ColaVideosContext);
}
