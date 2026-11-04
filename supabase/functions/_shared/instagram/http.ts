/**
 * Respuestas JSON de las Edge Functions de Instagram: siempre saneadas, sin
 * caché y con CORS (el panel las llama desde su propio dominio).
 */
import { sanearProfundo } from "./secretos.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(estado: number, cuerpo: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(sanearProfundo(cuerpo)), {
    status: estado,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

/** Respuesta al preflight CORS. */
export function opciones(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** Error de autorización con la cabecera que pide 401. */
export function jsonAuth(estado: number, motivo: string): Response {
  return json(estado, { ok: false, error: motivo }, estado === 401 ? { "WWW-Authenticate": "Bearer" } : {});
}

/** Lee el cuerpo JSON con un tope de tamaño; null si no es JSON válido. */
export async function leerJson(request: Request, maxBytes = 256 * 1024): Promise<{ ok: true; valor: unknown } | { ok: false; estado: 400 | 413; error: string }> {
  const largo = Number(request.headers.get("content-length") ?? "0");
  if (largo > maxBytes) return { ok: false, estado: 413, error: "El cuerpo de la petición es demasiado grande" };
  const texto = await request.text().catch(() => "");
  if (texto.length > maxBytes) return { ok: false, estado: 413, error: "El cuerpo de la petición es demasiado grande" };
  try {
    return { ok: true, valor: JSON.parse(texto) };
  } catch {
    return { ok: false, estado: 400, error: "El cuerpo no es JSON válido" };
  }
}
