// ============================================================================
//  Reseñas · llamada a OpenAI para proponer respuestas (servidor)
//    · Clave: claveOpenAI("otros") (OPENAI_API_KEY), nunca sale del servidor.
//    · Modelo: ia_modelo_funcion (Super Admin › Servicios › Modelos) o el de
//      código; con respaldo si el modelo elegido no existe.
//    · Consumo: registrarUso (ia_uso → «Gasto IA»), también si la llamada falla.
//  Sin imports remotos: `fetch`, el registro y la clave se pueden inyectar.
// ============================================================================

import { claveOpenAI } from "../clave-openai.ts";
import { configModeloFuncion, esErrorDeModelo, parametrosChat, type ClienteSupabase } from "../modelo-funcion.ts";
import { AcumuladorUso, type OpcionesRegistro } from "../registrar-uso-ia.ts";
import type { MensajeChat } from "./contestador.ts";

export const FUNCION_CONTESTADOR = "resenas-contestador";
export const MODELO_CONTESTADOR = "gpt-4.1-mini";

export interface OpcionesIa {
  cliente: ClienteSupabase | null;
  registrar: (uso: AcumuladorUso, opciones: OpcionesRegistro) => Promise<void>;
  fetch?: typeof fetch;
  clave?: string;
  maxTokens?: number;
}

export function crearIaContestador(o: OpcionesIa) {
  const clave = o.clave ?? claveOpenAI("otros");
  if (!clave) return null;
  const f = o.fetch ?? fetch;
  return async (mensajes: MensajeChat[], disparador: string): Promise<{ texto: string; modelo: string }> => {
    const elegido = await configModeloFuncion(FUNCION_CONTESTADOR, MODELO_CONTESTADOR, { cliente: o.cliente });
    const modelos = [elegido.modelo, ...(elegido.respaldo ? [elegido.respaldo] : [])];
    let ultimo: Error | null = null;
    for (const modelo of modelos) {
      const uso = new AcumuladorUso(FUNCION_CONTESTADOR, modelo, "chat");
      const t0 = Date.now();
      let reintentar = false;
      try {
        const res = await f("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelo, messages: mensajes, ...parametrosChat(modelo, o.maxTokens ?? 500, 0.6) }),
          signal: AbortSignal.timeout(45_000),
        });
        const cuerpo = await res.json().catch(() => null);
        uso.sumar(cuerpo?.usage);
        if (!res.ok) {
          uso.marcarError();
          ultimo = new Error(`OpenAI ${res.status}`);
          reintentar = esErrorDeModelo(res.status, cuerpo);
          if (!reintentar) throw ultimo;
          continue;
        }
        const texto = cuerpo?.choices?.[0]?.message?.content;
        if (typeof texto !== "string" || !texto.trim()) throw new Error("OpenAI devolvió una respuesta vacía");
        return { texto, modelo };
      } catch (e) {
        uso.marcarError();
        ultimo = (e as Error)?.name === "TimeoutError" ? new Error("OpenAI no respondió en 45 s") : e instanceof Error ? e : new Error(String(e));
        throw ultimo;
      } finally {
        await o.registrar(uso, { disparador, duracionMs: Date.now() - t0, cliente: o.cliente as never });
      }
    }
    throw ultimo ?? new Error("Sin modelo de IA disponible");
  };
}
