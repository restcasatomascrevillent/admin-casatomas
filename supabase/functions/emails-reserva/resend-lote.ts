// ============================================================================
// ENVÍO POR LOTES CON REINTENTOS (Resend) + RECLAMO DE ENVÍOS ABANDONADOS
// ============================================================================
// El dueño avisó de volumen real: nada de soltar 200 correos de golpe.
// Resend admite 10 req/s por cuenta por defecto (resend.com/docs/api-
// reference/rate-limit, comprobado). Aquí se manda en lotes pequeños con
// una pausa entre lotes muy por debajo de ese límite — configurable por env
// var porque el límite real depende del plan contratado por el dueño, que
// esta sesión no puede consultar.
//
// La parte pura (testeable sin red): `enLotes` (en recordatorios.ts, se
// reutiliza aquí) y `filaEstaAbandonada`. La parte con I/O (llamar a Resend,
// leer/escribir `envios_email_reserva`) vive en index.ts, que importa estas
// utilidades — se mantienen separadas para no mezclar red con lógica.
// ============================================================================

export const TAMANO_LOTE_POR_DEFECTO = 3;
export const PAUSA_ENTRE_LOTES_MS_POR_DEFECTO = 750;
/** Una fila 'pendiente' más vieja que esto se considera abandonada (la
 * función murió a media ejecución) y puede reclamarse como 'fallido' para
 * liberar el hueco del índice único y permitir un reintento. */
export const MINUTOS_RECLAMO_POR_DEFECTO = 10;

export function leerEnteroEnv(valor: string | undefined, porDefecto: number): number {
  if (!valor) return porDefecto;
  const n = parseInt(valor, 10);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

export interface FilaEnvioPendiente {
  id: string;
  creado_at: string;
}

/** Verdadero si una fila 'pendiente' lleva más de `minutos` sin resolverse
 * y debe tratarse como abandonada. Pura: recibe "ahora" en vez de leerlo. */
export function filaEstaAbandonada(
  fila: FilaEnvioPendiente,
  ahoraIso: string,
  minutos = MINUTOS_RECLAMO_POR_DEFECTO,
): boolean {
  const creada = new Date(fila.creado_at).getTime();
  const ahora = new Date(ahoraIso).getTime();
  return ahora - creada > minutos * 60 * 1000;
}

/** Pequeña espera entre lotes. Aislada en una función para poder
 * sustituirla por un mock en tests que sí ejerciten el bucle de envío. */
export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
