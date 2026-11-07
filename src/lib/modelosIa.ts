/**
 * Centro de modelos de IA (Super Admin › Servicios › Modelos, 07/11/2026).
 * Tipos y cálculos sin React de lo que devuelve `ia_modelos_centro()`
 * (migración 20261107500000_ia_modelos_centro).
 */

export interface FuncionModelo {
  funcion: string;
  descripcion: string | null;
  /** NULL = el del código (modelo_codigo). */
  modelo: string | null;
  modelo_respaldo: string | null;
  modelo_codigo: string | null;
  /** true = la función ya lee ia_modelo_funcion (se puede cambiar aquí). */
  centralizado: boolean;
  /** Llama a Chat Completions con herramientas (chat-facturas, chat-web): 20261107620000. */
  usa_herramientas: boolean;
  notas: string | null;
  cambiado_por_email: string | null;
  cambiado_en: string | null;
  ultimo_modelo_usado: string | null;
  ultimo_uso: string | null;
  coste_usd: number | null;
  llamadas: number | null;
  coste_sin_tarifa: boolean;
}

export interface ModeloDisponible {
  id: string;
  owned_by: string | null;
  creado_openai: string | null;
  primera_vez_visto: string;
  ultima_vez_visto: string;
  retirado_en: string | null;
  de_interes: boolean;
  nuevo: boolean;
  usd_por_m_input: number | null;
  usd_por_m_output: number | null;
  precio_fuente: string | null;
  /** Resultado de «Probar» con una herramienta: null = sin probar (20261107620000). */
  compatible_herramientas: boolean | null;
  compatible_motivo: string | null;
  compatible_probado_en: string | null;
}

export interface CambioModelo {
  funcion: string;
  modelo_anterior: string | null;
  modelo_nuevo: string | null;
  respaldo_anterior: string | null;
  respaldo_nuevo: string | null;
  notas: string | null;
  cambiado_por_email: string | null;
  cambiado_en: string;
}

export interface CentroModelos {
  dias: number;
  funciones: FuncionModelo[];
  disponibles: ModeloDisponible[];
  ultima_lista: string | null;
  historial: CambioModelo[];
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Normaliza el JSON de la RPC (numeric llega como texto). */
export function normalizarCentro(raw: unknown): CentroModelos {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    dias: num(r.dias) ?? 30,
    funciones: lista<FuncionModelo>(r.funciones).map((f) => ({
      ...f,
      centralizado: f.centralizado === true,
      usa_herramientas: f.usa_herramientas === true,
      coste_usd: num(f.coste_usd),
      llamadas: num(f.llamadas),
      coste_sin_tarifa: f.coste_sin_tarifa === true,
    })),
    disponibles: lista<ModeloDisponible>(r.disponibles).map((d) => ({
      ...d,
      de_interes: d.de_interes === true,
      nuevo: d.nuevo === true,
      compatible_herramientas: typeof d.compatible_herramientas === "boolean" ? d.compatible_herramientas : null,
      compatible_motivo: typeof d.compatible_motivo === "string" ? d.compatible_motivo : null,
      compatible_probado_en: typeof d.compatible_probado_en === "string" ? d.compatible_probado_en : null,
      usd_por_m_input: num(d.usd_por_m_input),
      usd_por_m_output: num(d.usd_por_m_output),
    })),
    ultima_lista: typeof r.ultima_lista === "string" ? r.ultima_lista : null,
    historial: lista<CambioModelo>(r.historial),
  };
}

/** ¿Es un modelo de texto que nuestras funciones pueden usar con chat/completions? */
export function esModeloDeChat(id: string): boolean {
  return /^(gpt-|o[0-9]|chatgpt-)/.test(id) &&
    !/(embedding|tts|whisper|transcribe|audio|realtime|image|dall-e|moderation|search-api|computer-use|codex)/i.test(id);
}

/** Opciones del selector: de chat, no retirados y CON precio, del más barato al más caro. */
export function modelosSeleccionables(disponibles: ModeloDisponible[]): ModeloDisponible[] {
  return disponibles
    .filter((d) => !d.retirado_en && d.usd_por_m_input != null && esModeloDeChat(d.id))
    .sort((a, b) => (a.usd_por_m_input! - b.usd_por_m_input!) || a.id.localeCompare(b.id));
}

/**
 * ¿Se puede elegir este modelo en la función? Si la función usa herramientas y
 * «Probar» marcó el modelo como incompatible, no (la BD también lo rechaza:
 * ia_modelo_funcion_antes). Devuelve el motivo para enseñarlo deshabilitado.
 */
export function motivoNoElegible(f: Pick<FuncionModelo, "usa_herramientas">, d: Pick<ModeloDisponible, "compatible_herramientas" | "compatible_motivo">): string | null {
  if (!f.usa_herramientas || d.compatible_herramientas !== false) return null;
  return d.compatible_motivo || "No admite Chat Completions con herramientas";
}

/** Modelo que usa hoy la función (el elegido o el del código). */
export function modeloActual(f: FuncionModelo): { modelo: string; desdeTabla: boolean } {
  if (f.modelo) return { modelo: f.modelo, desdeTabla: true };
  const codigo = (f.modelo_codigo ?? "").split(/[\s(,]/)[0] || f.ultimo_modelo_usado || "—";
  return { modelo: codigo, desdeTabla: false };
}

/** Avisos de la fila: modelo elegido retirado o sin precio. */
export function avisosFuncion(f: FuncionModelo, disponibles: ModeloDisponible[]): string[] {
  const avisos: string[] = [];
  const porId = new Map(disponibles.map((d) => [d.id, d]));
  for (const [m, etiqueta] of [[f.modelo, "El modelo"], [f.modelo_respaldo, "El respaldo"]] as const) {
    if (!m) continue;
    const d = porId.get(m);
    if (!d || d.retirado_en) avisos.push(`${etiqueta} ${m} ya no está en la cuenta de OpenAI.`);
    else if (d.usd_por_m_input == null) avisos.push(`${etiqueta} ${m} no tiene precio: su gasto sale sin datos.`);
    else if (motivoNoElegible(f, d)) avisos.push(`${etiqueta} ${m} no sirve para esta función: ${motivoNoElegible(f, d)}`);
  }
  return avisos;
}

export function formatoUsd(v: number | null): string {
  if (v == null) return "—";
  if (v === 0) return "0 $";
  if (v < 0.01) return "< 0,01 $";
  return `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

export function formatoPrecio(d: Pick<ModeloDisponible, "usd_por_m_input" | "usd_por_m_output">): string {
  if (d.usd_por_m_input == null) return "sin precio";
  const f = (n: number | null) => (n == null ? "?" : n.toLocaleString("es-ES", { maximumFractionDigits: 3 }));
  return `${f(d.usd_por_m_input)} / ${f(d.usd_por_m_output)} $ por M`;
}
