/**
 * Mensajes de error para toasts (CT-REM-FE-08).
 *
 * Criterio (error de negocio vs error técnico):
 *  - NEGOCIO: texto en español pensado para la persona. Llega como `Error`
 *    "plano" lanzado por el propio código del panel, como `ErrorNegocio`, o
 *    como cuerpo `{ error: "..." }` de nuestras funciones (ver
 *    `mensajeErrorUsuarios`). Se muestra tal cual.
 *  - TÉCNICO: lo que devuelven PostgREST, Auth, Functions (relay/fetch/http),
 *    `fetch` (TypeError) o contiene jerga de BD/red. NO se muestra: se
 *    registra con console.error y la persona ve el mensaje genérico.
 */
export class ErrorNegocio extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorNegocio";
  }
}

const NOMBRES_TECNICOS = new Set([
  "PostgrestError",
  "AuthApiError",
  "AuthError",
  "AuthRetryableFetchError",
  "AuthUnknownError",
  "FunctionsHttpError",
  "FunctionsFetchError",
  "FunctionsRelayError",
  "StorageError",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
]);

const JERGA_TECNICA =
  /PGRST\d|SQLSTATE|violates|relation ".*"|column ".*"|constraint|duplicate key|null value|row-level security|permission denied|JWT|syntax error|does not exist|Failed to fetch|NetworkError|Load failed|fetch failed|non-2xx|Edge Function|\bat \w+.*\(|Unexpected token|<!DOCTYPE|\bundefined\b/i;

/**
 * SQLSTATE de clase P0 (PL/pgSQL): P0001 = `RAISE EXCEPTION` sin ERRCODE, que es
 * como las funciones/triggers de la BD (canjear_cheque_regalo, aforo de reservas...)
 * devuelven errores de negocio ya redactados en español. Llegan por supabase-js como
 * `{ code: "P0001", message }`. Los ERRCODE personalizados de las migraciones
 * (28000, 42501) son de acceso y siguen siendo técnicos.
 */
const esCodigoNegocioSql = (code: unknown) => typeof code === "string" && /^P0\d{3}$/.test(code);

export function esErrorTecnico(error: unknown): boolean {
  if (error instanceof ErrorNegocio) return false;
  if (error === null || error === undefined) return true;
  if (typeof error === "string") return JERGA_TECNICA.test(error);
  if (typeof error !== "object") return true;
  const e = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    details?: unknown;
    hint?: unknown;
    status?: unknown;
    context?: unknown;
  };
  if (esCodigoNegocioSql(e.code) && typeof e.message === "string" && e.message.trim()) return false;
  if (typeof e.name === "string" && NOMBRES_TECNICOS.has(e.name)) return true;
  if (e.code !== undefined || e.details !== undefined || e.hint !== undefined) return true;
  if (e.status !== undefined || e.context !== undefined) return true;
  if (typeof e.message !== "string" || !e.message.trim()) return true;
  return JERGA_TECNICA.test(e.message);
}

/**
 * Devuelve el texto a enseñar. El detalle técnico va siempre a console.error.
 * `generico` debe estar ya en español y no incluir datos internos.
 */
export function mensajeUsuario(
  error: unknown,
  generico = "Algo ha fallado. Inténtalo de nuevo y, si sigue igual, avisa al equipo.",
): string {
  if (esErrorTecnico(error)) {
    console.error("[panel] error técnico:", error);
    return generico;
  }
  return (error as { message: string }).message ?? String(error);
}
