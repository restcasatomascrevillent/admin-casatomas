// Lógica sin Deno de ia-modelos-openai (la prueban los tests con vitest).
import type { ProcesoOpenAI } from "../_shared/clave-openai.ts";
import { esNombreDeModelo, parametrosChat } from "../_shared/modelo-funcion.ts";

export interface ModeloOpenAI {
  id: string;
  owned_by: string | null;
  created: number | null;
}

/** Lista limpia de GET /v1/models ({ data: [{ id, owned_by, created }] }). Lanza si no tiene forma de lista. */
export function modelosDeRespuesta(json: unknown): ModeloOpenAI[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error("La respuesta de /v1/models no trae «data»");
  const vistos = new Map<string, ModeloOpenAI>();
  for (const m of data) {
    const id = typeof m?.id === "string" ? m.id.trim() : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id) || vistos.has(id)) continue;
    vistos.set(id, {
      id,
      owned_by: typeof m?.owned_by === "string" ? m.owned_by.slice(0, 120) : null,
      created: Number.isInteger(m?.created) ? m.created : null,
    });
  }
  return [...vistos.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Familias que vigilamos: gpt-*, o1/o3/o4…, text-embedding-*. Igual que `de_interes` en SQL. */
export function esDeInteres(id: string): boolean {
  return /^(gpt-|o[0-9]|text-embedding-)/.test(id);
}

/** Clave de OpenAI con la que se prueba cada función (la de su proyecto: _shared/clave-openai.ts). */
export function procesoDeFuncion(funcion: string | null | undefined): ProcesoOpenAI {
  switch (funcion) {
    case "chat-facturas": return "chat";
    case "chat-web": return "chatweb";
    case "procesar-factura":
    case "ocr-trabajo":
    case "clasificar-productos": return "ocr";
    case "extraer-vino-foto": return "vinos";
    default: return "otros";
  }
}

/** ¿Se puede probar con chat/completions? (los embeddings, audio, imagen… no). */
export function esModeloDeChat(id: string): boolean {
  return /^(gpt-|o[0-9]|chatgpt-)/.test(id) &&
    !/(embedding|tts|whisper|transcribe|audio|realtime|image|dall-e|moderation|search-api|computer-use|codex)/i.test(id);
}

/**
 * Cuerpo de la llamada mínima de prueba («Probar»): los mismos parámetros que
 * usan nuestras funciones (parametrosChat) y UNA herramienta de mentira, para
 * comprobar también que el modelo admite function calling (chat-facturas y
 * chat-web lo usan). tool_choice "auto": puede contestar o pedir la herramienta.
 */
export function cuerpoPrueba(modelo: string): Record<string, unknown> {
  if (!esNombreDeModelo(modelo)) throw new Error("Nombre de modelo no válido");
  return {
    model: modelo,
    messages: [
      { role: "system", content: "Eres una prueba de conexión. Responde en español con una sola palabra, sin usar herramientas." },
      { role: "user", content: "Di «funciona»." },
    ],
    tools: [{
      type: "function",
      function: { name: "hora_actual", description: "Devuelve la hora (no hace falta para esta prueba).", parameters: { type: "object", properties: {} } },
    }],
    tool_choice: "auto",
    ...parametrosChat(modelo, 16, 0),
  };
}

/** Texto de la respuesta de chat/completions, recortado. */
export function textoRespuesta(json: unknown): string {
  type Choice = { message?: { content?: unknown }; finish_reason?: string };
  const c = (json as { choices?: Choice[] } | null)?.choices?.[0];
  const contenido = c?.message?.content;
  const t = typeof contenido === "string" ? contenido.trim() : "";
  if (t) return t.slice(0, 200);
  if (c?.finish_reason) return `(sin texto; finish_reason=${c.finish_reason})`;
  return "(sin texto)";
}

// ─── Acción «evaluar» (07/11/2026, docs/facturas/EVAL-MODELOS.md) ───────────

/** Turnos de una pregunta de la batería (los seguimientos llevan el turno anterior). */
export interface PreguntaEval {
  id: string;
  mensaje: string;
  historial: { role: "user" | "assistant"; content: string }[];
}

export interface PeticionEval {
  modelo: string;
  preguntas: PreguntaEval[];
  /** Tope de gasto ACUMULADO de todas las evaluaciones (ia_uso), en USD. */
  presupuestoUsd: number;
}

/** Máximo de preguntas por llamada: cada una puede tardar hasta 110 s (PRESUPUESTO_MS del bucle). */
export const MAX_PREGUNTAS_EVAL = 3;
/** Tope duro del presupuesto de evaluación (pedido del dueño: 3 $ en total). */
export const PRESUPUESTO_EVAL_MAX_USD = 3;

/** Valida el cuerpo de «evaluar». Lanza Error con un mensaje en español. */
export function peticionEvaluar(body: Record<string, unknown>): PeticionEval {
  const modelo = typeof body.modelo === "string" ? body.modelo.trim() : "";
  if (!esNombreDeModelo(modelo) || !esModeloDeChat(modelo)) throw new Error("Modelo no válido para evaluar");
  const lista = Array.isArray(body.preguntas) ? body.preguntas : [];
  if (lista.length === 0) throw new Error("Faltan preguntas");
  if (lista.length > MAX_PREGUNTAS_EVAL) throw new Error(`Como máximo ${MAX_PREGUNTAS_EVAL} preguntas por llamada`);
  const preguntas = lista.map((p, i): PreguntaEval => {
    const o = (p ?? {}) as Record<string, unknown>;
    const mensaje = typeof o.mensaje === "string" ? o.mensaje.trim() : "";
    if (!mensaje || mensaje.length > 2000) throw new Error(`Pregunta ${i + 1}: mensaje vacío o demasiado largo`);
    const id = typeof o.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(o.id) ? o.id : `p${i + 1}`;
    const hist = Array.isArray(o.historial) ? o.historial : [];
    if (hist.length > 6) throw new Error(`Pregunta ${i + 1}: historial de más de 6 turnos`);
    const historial = hist.map((t) => {
      const r = (t ?? {}) as Record<string, unknown>;
      const role: "user" | "assistant" = r.rol === "user" || r.role === "user" ? "user" : "assistant";
      const content = typeof r.contenido === "string" ? r.contenido : typeof r.content === "string" ? r.content : "";
      if (!content || content.length > 4000) throw new Error(`Pregunta ${i + 1}: turno de historial vacío o demasiado largo`);
      return { role, content };
    });
    return { id, mensaje, historial };
  });
  const pedido = Number(body.presupuesto_usd);
  const presupuestoUsd = Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, PRESUPUESTO_EVAL_MAX_USD) : PRESUPUESTO_EVAL_MAX_USD;
  return { modelo, preguntas, presupuestoUsd };
}

export interface PrecioModelo {
  usd_por_m_input: number;
  usd_por_m_cached: number | null;
  usd_por_m_output: number;
}

export interface TokensEval {
  entrada: number;
  cacheados: number;
  salida: number;
  razonamiento: number;
}

const n0 = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/** Suma los `usage` de chat/completions (prompt_tokens incluye los cacheados; completion, el razonamiento). */
export function sumarUsage(usos: unknown[]): TokensEval {
  const t: TokensEval = { entrada: 0, cacheados: 0, salida: 0, razonamiento: 0 };
  for (const x of usos) {
    if (!x || typeof x !== "object") continue;
    const u = x as {
      prompt_tokens?: unknown; completion_tokens?: unknown;
      prompt_tokens_details?: { cached_tokens?: unknown } | null;
      completion_tokens_details?: { reasoning_tokens?: unknown } | null;
    };
    const p = n0(u.prompt_tokens);
    const c = n0(u.completion_tokens);
    t.entrada += p;
    t.cacheados += Math.min(n0(u.prompt_tokens_details?.cached_tokens), p);
    t.salida += c;
    t.razonamiento += Math.min(n0(u.completion_tokens_details?.reasoning_tokens), c);
  }
  return t;
}

/**
 * Coste en USD con la tarifa de ia_precios (misma regla que ia_registrar_uso):
 * entrada no cacheada a precio de entrada, cacheada a su precio (o al de
 * entrada si no tiene), salida (con el razonamiento dentro) a precio de salida.
 * null si no hay precio.
 */
export function costeUsd(precio: PrecioModelo | null | undefined, t: TokensEval): number | null {
  if (!precio) return null;
  const pin = n0(precio.usd_por_m_input);
  const pcache = precio.usd_por_m_cached === null || precio.usd_por_m_cached === undefined ? pin : n0(precio.usd_por_m_cached);
  const pout = n0(precio.usd_por_m_output);
  const usd = ((t.entrada - t.cacheados) * pin + t.cacheados * pcache + t.salida * pout) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
