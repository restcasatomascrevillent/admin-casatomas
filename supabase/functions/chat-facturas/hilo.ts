// ============================================================================
//  chat-facturas · contexto del hilo y traza para el panel (11/11/2026)
// ----------------------------------------------------------------------------
//  TS puro (sin Deno) para que lo prueben los tests de vitest.
//
//  · trazaParaPanel: lo que la función devuelve al panel en `traza`. El panel
//    lo guarda (1) en la respuesta, como adjunto { tipo: "contexto", datos },
//    para que el siguiente turno sepa qué se consultó, y (2) con el 👍/👎 en
//    chat_feedback.herramientas.
//  · contextoDeAdjuntos: lee ese adjunto de la columna `adjuntos` de
//    chat_facturas_mensajes al montar el historial.
// ============================================================================
import type { ContextoHerramienta, HerramientaTrazada, ResumenResultado, Traza } from "./bucle.ts";

export const MAX_HERRAMIENTAS_TRAZA = 12;
const MAX_CHARS_ARGUMENTOS = 1_500;

export interface HerramientaPanel {
  nombre: string;
  argumentos: unknown;
  resultado: HerramientaTrazada["resultado"];
  error?: string;
  resumen?: ResumenResultado;
}

export interface TrazaPanel { herramientas: HerramientaPanel[] }

function argumentosAcotados(a: unknown): unknown {
  try {
    const s = JSON.stringify(a ?? {});
    return s.length <= MAX_CHARS_ARGUMENTOS ? a ?? {} : { recortado: s.slice(0, MAX_CHARS_ARGUMENTOS) };
  } catch {
    return {};
  }
}

/** Traza compacta para el panel: sin tiempos ni consumo, con argumentos acotados. */
export function trazaParaPanel(traza: Traza): TrazaPanel {
  return {
    herramientas: traza.herramientas.slice(0, MAX_HERRAMIENTAS_TRAZA).map((h) => ({
      nombre: h.nombre,
      argumentos: argumentosAcotados(h.argumentos),
      resultado: h.resultado,
      ...(h.error ? { error: h.error } : {}),
      ...(h.resumen ? { resumen: h.resumen } : {}),
    })),
  };
}

const listaTextos = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 6).map((x) => x.slice(0, 120)) : [];

/**
 * Herramientas guardadas con una respuesta (adjunto `contexto`). Lo que no
 * tenga la forma esperada se ignora: la columna la escribe el panel.
 */
export function contextoDeAdjuntos(adjuntos: unknown): ContextoHerramienta[] {
  if (!Array.isArray(adjuntos)) return [];
  const ctx = adjuntos.find((a) => a && typeof a === "object" && (a as { tipo?: unknown }).tipo === "contexto") as
    { datos?: { herramientas?: unknown } } | undefined;
  const lista = ctx?.datos?.herramientas;
  if (!Array.isArray(lista)) return [];
  const salida: ContextoHerramienta[] = [];
  for (const h of lista.slice(0, MAX_HERRAMIENTAS_TRAZA)) {
    if (!h || typeof h !== "object") continue;
    const { nombre, argumentos, error, resumen, resultado } = h as Record<string, unknown>;
    if (typeof nombre !== "string" || !/^[a-z_]{2,60}$/.test(nombre) || resultado === "no_ejecutada") continue;
    const r = resumen && typeof resumen === "object" ? resumen as Record<string, unknown> : {};
    const proveedores = listaTextos(r.proveedores);
    const productos = listaTextos(r.productos);
    salida.push({
      nombre,
      argumentos: argumentosAcotados(argumentos),
      ...(typeof error === "string" && error ? { error: error.slice(0, 200) } : {}),
      ...(proveedores.length || productos.length ? { resumen: { proveedores, productos } } : {}),
    });
  }
  return salida;
}
