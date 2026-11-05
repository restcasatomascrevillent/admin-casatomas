// Gráficas del copiloto de IA de Facturas › Análisis (parte pura, sin React).
//
// Desde el rediseño del 05/11/2026 el copiloto va PLEGADO en un panel lateral:
// sus gráficas (adjuntos `serie_precio` de la Edge Function) se ven dentro del
// panel, bajo su respuesta, y con «Fijar en el tablero» se añaden al final del
// tablero. Las fijadas se guardan en este navegador (localStorage): son una
// copia de la serie, así que siguen ahí aunque se borre la conversación.
//
// DECISIÓN (05/11/2026, se mantiene): el contexto de una gráfica, cuando se
// pregunta sobre ella, viaja DENTRO del texto del mensaje (al final, entre
// corchetes). Los mensajes antiguos que lo llevan se enseñan separados.
import { esSerieSinDatos, normalizarSerie, type SeriePrecio } from "./seriePrecio";
import type { MensajeChat } from "@/hooks/useChatFacturas";

// ─── Gráficas de una respuesta ──────────────────────────────────────────────

export interface GraficaIa {
  /** `${mensajeId}#${índice del adjunto}`: estable entre recargas (el id es el de la BD). */
  id: string;
  serie: SeriePrecio;
}

export const tituloSerie = (serie: Pick<SeriePrecio, "producto">) => `Evolución del precio · ${serie.producto || "producto"}`;

/** Las gráficas con datos de una respuesta de la IA. */
export function graficasDeMensaje(m: MensajeChat): GraficaIa[] {
  if (m.rol !== "assistant") return [];
  const salida: GraficaIa[] = [];
  (m.adjuntos ?? []).forEach((a, i) => {
    if (a.tipo === "serie_precio" && !esSerieSinDatos(a.datos)) salida.push({ id: `${m.id}#${i}`, serie: a.datos });
  });
  return salida;
}

// ─── Gráficas fijadas en el tablero ─────────────────────────────────────────

export interface GraficaFijada extends GraficaIa {
  /** ISO: cuándo se fijó (orden del tablero: la primera fijada, primero). */
  fijadaEn: string;
}

export const CLAVE_FIJADAS = "facturas-analisis-fijadas";
/** Tope: el tablero no crece sin límite (se quedan las últimas). */
export const MAX_FIJADAS = 8;

/** Lee lo guardado sin fiarse: basura, series rotas o repetidas se descartan. */
export function normalizarFijadas(entrada: unknown): GraficaFijada[] {
  if (!Array.isArray(entrada)) return [];
  const vistas = new Set<string>();
  const salida: GraficaFijada[] = [];
  for (const x of entrada) {
    if (!x || typeof x !== "object") continue;
    const { id, serie, fijadaEn } = x as Record<string, unknown>;
    const s = normalizarSerie(serie);
    if (typeof id !== "string" || vistas.has(id) || !s || esSerieSinDatos(s)) continue;
    vistas.add(id);
    salida.push({ id, serie: s, fijadaEn: typeof fijadaEn === "string" ? fijadaEn : "" });
  }
  return salida.slice(-MAX_FIJADAS);
}

/** Añade (sin repetir) y recorta al tope. */
export function fijar(lista: GraficaFijada[], g: GraficaIa, ahora: Date = new Date()): GraficaFijada[] {
  if (lista.some((x) => x.id === g.id)) return lista;
  return [...lista, { ...g, fijadaEn: ahora.toISOString() }].slice(-MAX_FIJADAS);
}

// ─── Contexto de una gráfica dentro del mensaje ─────────────────────────────

const INICIO_CONTEXTO = "[Sobre la gráfica seleccionada: ";
const PATRON_CONTEXTO = /\n\n\[Sobre la gráfica seleccionada: ([\s\S]*)\]\s*$/;

/** Pregunta + contexto, tal y como se guarda y se manda a `chat-facturas`. */
export function componerMensaje(pregunta: string, contexto?: string | null): string {
  const limpio = contexto?.replace(/[[\]]/g, "").trim();
  return limpio ? `${pregunta.trim()}\n\n${INICIO_CONTEXTO}${limpio}]` : pregunta.trim();
}

/** Separa la pregunta del contexto para enseñarla en el copiloto. */
export function separarContexto(contenido: string): { pregunta: string; contexto: string | null } {
  const m = PATRON_CONTEXTO.exec(contenido);
  if (!m) return { pregunta: contenido, contexto: null };
  return { pregunta: contenido.slice(0, m.index).trim(), contexto: m[1] };
}

/** Cómo se llama la gráfica en la etiqueta «sobre …» de un mensaje ya enviado. */
export function asuntoDeContexto(contexto: string): string {
  const serie = /evolución del precio unitario sin IVA de «([^»]+)»/.exec(contexto);
  if (serie) return `precio de ${serie[1]}`;
  const rapida = /respuesta al instante «([^»]+)»/.exec(contexto);
  if (rapida) return rapida[1];
  return "la gráfica";
}
