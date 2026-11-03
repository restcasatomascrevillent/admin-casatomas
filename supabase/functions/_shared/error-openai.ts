/**
 * Motivo legible de un error de OpenAI para enseñarlo en el panel (03-11-2026:
 * la demo decía «No se pudo leer la etiqueta» cuando en realidad la cuenta de
 * OpenAI se había quedado sin saldo: 429 insufficient_quota).
 */
export const MENSAJE_SIN_SALDO_OPENAI =
  "La cuenta de OpenAI se ha quedado sin saldo: añade crédito en platform.openai.com → Billing";

/** Indica si el texto de un error de OpenAI es el de «sin saldo». */
export function esSinSaldoOpenAI(texto: string): boolean {
  return /insufficient_quota|credit_balance|no credits|exceeded your current quota|billing/i.test(texto);
}

export function motivoErrorOpenAI(status: number, cuerpo: string): string {
  if (esSinSaldoOpenAI(cuerpo)) return MENSAJE_SIN_SALDO_OPENAI;
  if (status === 401) return "La clave de OpenAI no es válida o ha caducado";
  if (status === 429) return "OpenAI está recibiendo demasiadas peticiones: espera un minuto y prueba otra vez";
  let detalle = "";
  try {
    const m = (JSON.parse(cuerpo) as { error?: { message?: unknown } })?.error?.message;
    if (typeof m === "string") detalle = m;
  } catch {
    /* cuerpo no JSON */
  }
  detalle = detalle.replace(/\s+/g, " ").trim().slice(0, 160);
  return `OpenAI respondió ${status}${detalle ? `: ${detalle}` : ""}`;
}
