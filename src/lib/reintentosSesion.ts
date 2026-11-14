/**
 * Poca cobertura al abrir el panel (13/11/2026, «con el iPhone me ha echado»):
 * si la comprobación de la sesión o el registro del acceso fallan por la RED
 * (no porque el servidor diga que no), se reintenta con estas esperas antes de
 * mandar a la pantalla de entrar. Un 401/403 o un bloqueo no se reintentan.
 */
export const ESPERAS_REINTENTO_SESION_MS = [1000, 2500, 5000] as const;

export const esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/** ¿El fallo de Auth es de red o del servidor de paso (reintentable), no un «no» del servidor? */
export function esFalloTransitorioAuth(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; name?: unknown };
  if (e.name === "AuthRetryableFetchError") return true;
  const status = typeof e.status === "number" ? e.status : Number(e.status);
  if (!Number.isFinite(status) || status === 0) return true;
  return status === 408 || status === 429 || status >= 500;
}

