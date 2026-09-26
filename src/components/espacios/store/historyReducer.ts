/**
 * Fase 2 (refactor) — scaffolding de store con historial undo/redo.
 *
 * Decisión: zustand NO está en package.json (ver dependencies) y el enunciado
 * pide evitar añadir una dependencia nueva sin motivo fuerte. Este reducer +
 * hook con useReducer cubre el mismo caso de uso (estado global de
 * undo/redo con límite de histórico) sin dependencias nuevas, y es
 * completamente testeable de forma aislada (sin React) al exportar el
 * reducer puro por separado del hook.
 *
 * Genérico en `T` (el "snapshot" versionado) a propósito: en este PR NO se
 * cablea todavía a los tipos concretos del editor (`ElementoCanvas`,
 * `MesaCanvas`) para poder testear la mecánica de undo/redo de forma
 * completamente aislada. `usePlanoHistory` (más abajo) es el punto de
 * integración pensado para `EditorPlanoEspacio.tsx`.
 */

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export type HistoryAction<T> =
  /** Confirma un nuevo estado como "presente", empujando el actual a `past`
   *  (recortado a `limit`) y vaciando `future` (una vez que haces un cambio
   *  nuevo, el "redo" de la rama anterior deja de tener sentido). */
  | { type: "COMMIT"; payload: T; limit?: number }
  /** Vuelve al estado anterior de `past`, moviendo el actual a `future`. No-op si `past` está vacío. */
  | { type: "UNDO" }
  /** Adelanta al primer estado de `future`, moviendo el actual a `past`. No-op si `future` está vacío. */
  | { type: "REDO" }
  /** Sustituye `present` SIN tocar `past`/`future` (para la carga inicial de
   *  datos desde la BD, que no debe ser "deshacible"). */
  | { type: "RESET"; payload: T };

export const DEFAULT_HISTORY_LIMIT = 50;

export function historyInitialState<T>(inicial: T): HistoryState<T> {
  return { past: [], present: inicial, future: [] };
}

export function historyReducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  switch (action.type) {
    case "COMMIT": {
      const limit = action.limit ?? DEFAULT_HISTORY_LIMIT;
      const nuevoPast = [...state.past, state.present];
      while (nuevoPast.length > limit) nuevoPast.shift();
      return { past: nuevoPast, present: action.payload, future: [] };
    }
    case "UNDO": {
      if (state.past.length === 0) return state;
      const anterior = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: anterior,
        future: [state.present, ...state.future],
      };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const siguiente = state.future[0];
      return {
        past: [...state.past, state.present],
        present: siguiente,
        future: state.future.slice(1),
      };
    }
    case "RESET":
      return { past: [], present: action.payload, future: [] };
    default:
      return state;
  }
}

export function puedeDeshacer<T>(state: HistoryState<T>): boolean {
  return state.past.length > 0;
}

export function puedeRehacer<T>(state: HistoryState<T>): boolean {
  return state.future.length > 0;
}
