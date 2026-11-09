// ============================================================================
//  Logs web · llamada a OpenAI para el análisis de incidencias y el resumen
//  del periodo. Solo la importan los index.ts (usa Deno y registrar-uso-ia).
//    · Clave: claveOpenAI("otros") (OPENAI_API_KEY), nunca sale del servidor.
//    · Modelo: ia_modelo_funcion (Super Admin › Servicios › Modelos) o el de
//      código; con respaldo si el modelo elegido no existe.
//    · Consumo: registrarUso (ia_uso), también si la llamada falla.
//    · Respuesta en JSON (response_format json_object), tope de tokens y 45 s.
// ============================================================================

import { claveOpenAI } from "../clave-openai.ts";
import { configModeloFuncion, esErrorDeModelo, parametrosChat, type ClienteSupabase } from "../modelo-funcion.ts";
import { AcumuladorUso, registrarUso } from "../registrar-uso-ia.ts";
import type { MensajeChat } from "../../procesar-logs-web/ia.ts";

export const MODELO_LOGS = "gpt-4.1-mini";

export function crearLlamadaIa(funcion: "procesar-logs-web" | "resumen-logs-web", cliente: ClienteSupabase, maxTokens = 1200) {
  const clave = claveOpenAI("otros");
  if (!clave) return null;
  return async (mensajes: MensajeChat[], disparador = funcion): Promise<{ texto: string; modelo: string }> => {
    const elegido = await configModeloFuncion(funcion, MODELO_LOGS, { cliente });
    const modelos = [elegido.modelo, ...(elegido.respaldo ? [elegido.respaldo] : [])];
    let ultimo: Error | null = null;
    for (const modelo of modelos) {
      const uso = new AcumuladorUso(funcion, modelo, "chat");
      const t0 = Date.now();
      const ctrl = new AbortController();
      const corte = setTimeout(() => ctrl.abort(), 45_000);
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelo, messages: mensajes, response_format: { type: "json_object" }, ...parametrosChat(modelo, maxTokens, 0.2) }),
          signal: ctrl.signal,
        });
        const cuerpo = await res.json().catch(() => null);
        uso.sumar(cuerpo?.usage);
        if (!res.ok) {
          uso.marcarError();
          ultimo = new Error(`OpenAI ${res.status}`);
          if (esErrorDeModelo(res.status, cuerpo)) continue; // probar el respaldo
          throw ultimo;
        }
        const texto = cuerpo?.choices?.[0]?.message?.content;
        if (typeof texto !== "string" || !texto.trim()) throw new Error("OpenAI devolvió una respuesta vacía");
        return { texto, modelo };
      } catch (e) {
        uso.marcarError();
        ultimo = e instanceof Error ? e : new Error(String(e));
        if ((e as Error)?.name === "AbortError") ultimo = new Error("OpenAI no respondió en 45 s");
        throw ultimo;
      } finally {
        clearTimeout(corte);
        await registrarUso(uso, { disparador, duracionMs: Date.now() - t0 });
      }
    }
    throw ultimo ?? new Error("Sin modelo de IA disponible");
  };
}
