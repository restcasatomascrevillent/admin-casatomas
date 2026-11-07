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
