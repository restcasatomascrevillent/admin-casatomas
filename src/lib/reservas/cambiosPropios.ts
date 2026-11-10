// ============================================================================
// CAMBIOS HECHOS DESDE ESTE PANEL (10/11/2026, «avisos más visibles»)
// ----------------------------------------------------------------------------
// Los avisos emergentes no deben saltar por lo que hace el propio usuario
// (p. ej. cancelar una reserva web desde la Lista). Cada escritura de una
// reserva desde el panel apunta aquí su id unos minutos; el detector de avisos
// nuevos (`lib/avisosEnVivo/detectar.ts`) los descarta.
// ============================================================================

const VIGENCIA_MS = 10 * 60_000;
const propios = new Map<string, number>();

/** Apunta que este panel acaba de cambiar (o crear) la reserva `id`. */
export function marcarCambioPropio(id: string | null | undefined, ahora = Date.now()): void {
  if (!id) return;
  propios.set(id, ahora);
}

/** ¿La cambió este panel hace menos de 10 minutos? */
export function esCambioPropio(id: string, ahora = Date.now()): boolean {
  const cuando = propios.get(id);
  if (cuando === undefined) return false;
  if (ahora - cuando > VIGENCIA_MS) {
    propios.delete(id);
    return false;
  }
  return true;
}

export function __resetCambiosPropiosParaTests(): void {
  propios.clear();
}
