// ============================================================================
//  Reintento cuando la base de datos corta una operación por tiempo
// ----------------------------------------------------------------------------
//  PostgREST corta cualquier sentencia a los 8 s (statement_timeout del rol
//  authenticator). Si la base va muy cargada un momento (p. ej. al guardar
//  muchas facturas a la vez, 18/11/2026), una operación que normalmente tarda
//  1–3 s se cancela y Postgres DESHACE todo lo que hizo: repetirla es seguro
//  si la operación es idempotente. Aquí: esperar un poco y volver a intentarlo.
//
//  Solo reintenta los cortes por tiempo (57014 statement_timeout / query
//  canceled, 55P03 lock_not_available): cualquier otro error se devuelve tal
//  cual a la primera. Sin Deno ni imports remotos (lo usan funciones y tests).
// ============================================================================

export interface ErrorBd {
  code?: string | null;
  message?: string | null;
}

/** Esperas por defecto entre intentos: 3 s y luego 8 s (tres intentos en total). */
export const ESPERAS_REINTENTO_MS: readonly number[] = [3000, 8000];

const PATRON_CORTE = /statement timeout|lock timeout|canceling statement due to/i;

/** ¿La base de datos canceló la sentencia por tiempo? */
export function esCortePorTiempo(error: ErrorBd | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "57014" || error.code === "55P03") return true;
  return PATRON_CORTE.test(error.message ?? "");
}

export const dormir = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

export interface OpcionesReintento {
  /** Espera antes de cada reintento ([] = sin reintentos). */
  esperasMs?: readonly number[];
  /** Para los tests. */
  dormir?: (ms: number) => Promise<void>;
  /** Se llama antes de cada reintento (para dejarlo en los registros). */
  alReintentar?: (intento: number, esperaMs: number, error: ErrorBd) => void;
}

/**
 * Ejecuta una llamada de supabase-js ({ data, error }) y, si la base la corta
 * por tiempo, la repite tras cada espera. Devuelve el último resultado (con su
 * error, si al final no entró). Solo para operaciones que se pueden repetir.
 */
export async function conReintentoPorTiempo<R extends { error: ErrorBd | null }>(
  llamada: () => PromiseLike<R>,
  opts: OpcionesReintento = {},
): Promise<R> {
  const esperas = opts.esperasMs ?? ESPERAS_REINTENTO_MS;
  const esperar = opts.dormir ?? dormir;
  let resultado = await llamada();
  for (let i = 0; i < esperas.length && esCortePorTiempo(resultado.error); i++) {
    opts.alReintentar?.(i + 1, esperas[i], resultado.error as ErrorBd);
    await esperar(esperas[i]);
    resultado = await llamada();
  }
  return resultado;
}
