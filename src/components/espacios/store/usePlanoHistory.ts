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
  /**
   * Desagrupes pendientes (mesas fusionadas ya persistidas en BBDD que el
   * usuario desagrupó en esta sesión — ver EditorPlanoEspacio.pendingUnmerges).
   * Opcional para no romper snapshots más simples (tests, otros consumidores):
   * si el consumidor no la usa, undo/redo simplemente no la toca.
   */
  pendingUnmerges?: unknown[];
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
 * editor de plano. Cableado en `EditorPlanoEspacio.tsx`: cada cambio
 * confirmado (no las posiciones intermedias de un arrastre) hace `commit()`
 * de un snapshot `{ elementos, mesasCanvas, pendingUnmerges }`; undo/redo
 * restauran ese snapshot en React y piden a `CanvasPlanoRef.reloadFromSnapshot`
 * que reconstruya el canvas de Fabric.js desde cero (clear + recrear), ya que
 * el efecto de "cargar elementos" de `CanvasPlano.tsx` solo AÑADE objetos que
 * faltan y no reconcilia. La carga inicial desde BBDD y el estado justo tras
 * "Guardar" usan `reset()` en vez de `commit()`, para que no se pueda deshacer
 * más allá de lo ya persistido. Las acciones que escriben en BBDD de forma
 * inmediata (Limpiar, eliminar mesa persistida, "Añadir Mesa" del panel
 * lateral) también usan `reset()` — un undo no puede revertir un DELETE/INSERT
 * ya confirmado en BBDD sin re-ejecutar la mutación, así que se tratan como
 * no deshacibles y se avisa con un toast.
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
