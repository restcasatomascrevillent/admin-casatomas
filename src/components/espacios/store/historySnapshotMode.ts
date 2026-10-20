/**
 * Decide qué hacer con el historial de undo/redo cuando cambian
 * `elementos`/`mesasCanvas`/`pendingUnmerges` en `EditorPlanoEspacio.tsx`.
 *
 * Extraído como función pura (sin refs/efectos de React) para poder
 * testearlo de forma aislada: la lógica real vive en un `useEffect` que
 * observa ese estado y usa banderas en refs para saber SI el cambio que
 * acaba de ocurrir debe registrarse como un paso de historial nuevo
 * ("commit"), convertirse en la nueva base no deshacible ("reset" — p.ej.
 * tras cargar el plano, tras guardar, o tras una acción que ya escribió en
 * BBDD de forma inmediata como "Limpiar" o eliminar una mesa persistida), o
 * ignorarse por completo ("skip" — durante la hidratación inicial, durante
 * el guardado, o porque el cambio de estado es la propia aplicación de un
 * undo/redo y no una edición nueva del usuario).
 */
export type ModoSnapshot = "skip" | "commit" | "reset";

export interface DecidirModoSnapshotOpts {
  /** Aún cargando el estado inicial desde BBDD: ningún cambio cuenta todavía. */
  isHydrating: boolean;
  /** Guardado (handleSave) en curso: los renombres de ids intermedios no cuentan. */
  suppressed: boolean;
  /** El cambio de estado que se está evaluando es la propia aplicación de un undo/redo. */
  isApplyingHistory: boolean;
  /** Modo solicitado explícitamente por el llamador para este cambio ("commit" salvo que se haya marcado "reset" con `marcarNoDeshacible`). */
  modoSolicitado: "commit" | "reset";
}

export function decidirModoSnapshot(opts: DecidirModoSnapshotOpts): ModoSnapshot {
  if (opts.isHydrating || opts.suppressed || opts.isApplyingHistory) return "skip";
  return opts.modoSolicitado;
}
