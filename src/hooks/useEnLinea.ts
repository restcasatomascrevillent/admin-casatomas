import { useSyncExternalStore } from "react";

// ============================================================================
// ¿HAY RED? (07/11/2026, «Hoy» con poca cobertura)
// ----------------------------------------------------------------------------
// `navigator.onLine` solo es fiable cuando dice `false` (sin wifi ni datos): con
// cobertura mala suele seguir en `true` y las peticiones fallan igual. Por eso
// `AvisoSinConexion` mira las dos cosas: esto y si la consulta ha fallado por red
// (`esErrorDeRed`).
// ============================================================================

function suscribir(avisar: () => void): () => void {
  window.addEventListener("online", avisar);
  window.addEventListener("offline", avisar);
  return () => {
    window.removeEventListener("online", avisar);
    window.removeEventListener("offline", avisar);
  };
}

/** `false` solo si el navegador sabe que no hay red; sin `navigator` (pruebas), `true`. */
export function estaEnLinea(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Se vuelve a pintar al perder o recuperar la red (`online`/`offline`). */
export function useEnLinea(): boolean {
  return useSyncExternalStore(suscribir, estaEnLinea, () => true);
}

/**
 * Fallo de RED (no de permisos ni de datos): `fetch` rechazado. supabase-js no lanza, devuelve
 * `{ error }` con el mensaje del `TypeError` de `fetch`, que cambia según el navegador:
 * «Failed to fetch» (Chrome), «NetworkError…» (Firefox), «Load failed» (Safari).
 */
export function esErrorDeRed(error: unknown): boolean {
  if (!error) return false;
  const mensaje =
    typeof error === "string"
      ? error
      : typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(mensaje);
}
