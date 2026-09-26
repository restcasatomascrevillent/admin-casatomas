import { useCallback, useReducer } from "react";
import {
  historyInitialState,
  historyReducer,
  puedeDeshacer,
  puedeRehacer,
  DEFAULT_HISTORY_LIMIT,
  type HistoryState,
} from "./historyReducer";

/**
 * Snapshot versionable del editor de plano: lo mínimo que hace falta
 * restaurar para deshacer/rehacer un cambio (paredes/áreas/puertas +
 * mesas colocadas en el canvas). Tipado con `any[]` deliberadamente en vez
 * de importar `ElementoCanvas`/`MesaCanvas` desde `EditorPlanoEspacio.tsx`
 * para no crear una dependencia circular store -> componente -> store; el
 * consumidor (EditorPlanoEspacio) puede tipar más estrictamente en el sitio
 * de uso si hace falta.
 */
export interface PlanoSnapshot {
  elementos: unknown[];
  mesasCanvas: unknown[];
}

export interface UsePlanoHistoryResult {
  present: PlanoSnapshot;
  puedeDeshacer: boolean;
  puedeRehacer: boolean;
  /** Confirma un nuevo snapshot tras un cambio del usuario (añadir/mover/borrar
   *  un elemento o mesa). Cada llamada es un "paso" de undo. */
  commit: (snapshot: PlanoSnapshot) => void;
  /** Sustituye el snapshot actual sin crear un paso de historial (carga inicial). */
  reset: (snapshot: PlanoSnapshot) => void;
  undo: () => void;
  redo: () => void;
}

/**
 * Hook de historial undo/redo (past/present/future, límite `limit`) para el
 * editor de plano. Ver AVISO en el reporte de la Fase 2: por ahora este hook
 * está TESTEADO pero NO está cableado dentro de `EditorPlanoEspacio.tsx` —
 * la restauración de un snapshot antiguo requeriría poder "recargar" el
 * canvas de Fabric.js desde un `elementos`/`mesasCanvas` arbitrario, y el
 * efecto que hoy carga elementos en `CanvasPlano.tsx` (líneas ~1599-1704)
 * está escrito para SOLO AÑADIR objetos que aún no existen en el canvas, no
 * para reconciliar (quitar los que ya no deberían estar) ni para
 * re-ejecutarse cuando cambia `elementos` desde fuera (sus deps son
 * `[fabricCanvas, planoConfig, pixelsPerMeter]`, no `elementos`). Cablear
 * undo/redo de verdad necesita antes una función de "recarga completa" en
 * `CanvasPlanoRef` — ver detalles en el informe final.
 */
export function usePlanoHistory(
  inicial: PlanoSnapshot,
  limit: number = DEFAULT_HISTORY_LIMIT
): UsePlanoHistoryResult {
  const [state, dispatch] = useReducer(
    historyReducer<PlanoSnapshot>,
    inicial,
    historyInitialState
  );

  const commit = useCallback((snapshot: PlanoSnapshot) => {
    dispatch({ type: "COMMIT", payload: snapshot, limit });
  }, [limit]);

  const reset = useCallback((snapshot: PlanoSnapshot) => {
    dispatch({ type: "RESET", payload: snapshot });
  }, []);

  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);

  return {
    present: state.present,
    puedeDeshacer: puedeDeshacer(state),
    puedeRehacer: puedeRehacer(state),
    commit,
    reset,
    undo,
    redo,
  };
}

export type { HistoryState };
