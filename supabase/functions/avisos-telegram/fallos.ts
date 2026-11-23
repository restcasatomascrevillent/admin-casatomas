// ============================================================================
//  avisos-telegram · fallos internos para desarrolladores (12/11/2026)
//  Lógica pura (sin Deno ni red), probada en __tests__/fallos.test.ts.
//  Van SOLO al chat de Fallos técnicos (chat_fallos, 22/11/2026): nunca al de la dueña.
//
//  Para un TIPO NUEVO: registrarlo con fallo_interno_registrar('<tipo>', datos)
//  (SQL) y, si quieres un formato propio, añadir una entrada a FORMATOS. Sin
//  formato propio sale el genérico (tipo + datos).
//  22/11/2026: más cortos. La primera línea dice qué ha pasado (emoji + resumen); debajo, solo el detalle
//  que hace falta para investigarlo.
// ============================================================================
import { LIMITE_TELEGRAM, recortar, ZONA } from "./logica.ts";

export interface Fallo {
  id: number;
  tipo: string;
  datos: Record<string, unknown>;
  usuario: string | null;
  created_at: string;
}

/** Datos que la función añade buscando en la base (p. ej. el albarán). */
export interface Contexto {
  albaran?: { id: number; proveedor: string | null; fecha: string | null } | null;
}

const limpio = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** «13/11 11:30» (Madrid); «?» si no es una fecha. */
export function horaLegible(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "?";
  return new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d).replace(",", "");
}

/** Id del albarán de un fallo albaran_aviso, o null. */
export function idAlbaran(f: Fallo): number | null {
  const n = Number(f.datos.factura_id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type Formato = (f: Fallo, ctx: Contexto) => string;

/** «(+N más desde 13/11 11:30)» y sus ids: los que llegaron agrupados (un aviso cada 15 min como mucho). */
function ademas(d: Record<string, unknown>): string[] {
  const n = Number(d.acumulados_antes);
  if (!(Number.isInteger(n) && n > 0)) return [];
  const ids = Array.isArray(d.acumulados_ids) ? d.acumulados_ids.map((x) => limpio(String(x))).filter(Boolean) : [];
  return [`(+${n} más desde ${horaLegible(limpio(d.acumulados_desde))}${ids.length ? `; ids ${ids.slice(0, 10).join(", ")}${ids.length > 10 ? "…" : ""}` : ""})`];
}

const diaHora = (v: unknown): string => horaLegible(limpio(v) || null);

const FORMATOS: Record<string, Formato> = {
  albaran_aviso: (f, ctx) => {
    const a = ctx.albaran;
    const avisos = Array.isArray(f.datos.avisos) ? (f.datos.avisos as Record<string, unknown>[]) : [];
    const fecha = limpio(a?.fecha);
    const cabecera = [
      "🧾 Albarán con avisos",
      limpio(a?.proveedor) || "proveedor desconocido",
      ...(fecha ? [/^\d{4}-\d{2}-\d{2}/.test(fecha) ? `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}` : fecha] : []),
      `id ${a?.id ?? idAlbaran(f) ?? "?"}`,
    ].join(" · ");
    const lineas = avisos.slice(0, 5).map((x) => `- ${recortar(limpio(x.mensaje) || limpio(x.codigo) || "(sin texto)", 160)}${limpio(x.codigo) ? ` [${limpio(x.codigo)}]` : ""}`);
    return [cabecera, ...lineas, ...(avisos.length > 5 ? [`- y ${avisos.length - 5} más`] : []), ...ademas(f.datos)].join("\n");
  },
  chat_pulgar_abajo: (f) => {
    const d = f.datos;
    return [
      `👎 Chat de Facturas · ${limpio(f.usuario) || "usuario desconocido"} · ${horaLegible(limpio(d.hora) || f.created_at)}`,
      `P: ${recortar(limpio(d.pregunta), 300) || "(sin pregunta)"}`,
      `R: ${recortar(limpio(d.respuesta), 600) || "(sin respuesta)"}`,
      ...(limpio(d.comentario) ? [`Nota: ${recortar(limpio(d.comentario), 300)}`] : []),
      ...ademas(d),
    ].join("\n");
  },
  // 18/11/2026: agrupados en SQL (fallo_interno_registrar): como mucho uno cada 15 min; los
  // que llegaron mientras tanto vienen contados en acumulados_antes.
  chat_error: (f) => {
    const d = f.datos;
    const dur = Number.isFinite(Number(d.duracion_ms)) && d.duracion_ms !== null && d.duracion_ms !== undefined
      ? ` · ${Math.round(Number(d.duracion_ms) / 100) / 10} s` : "";
    const herramientas = Array.isArray(d.herramientas)
      ? (d.herramientas as Record<string, unknown>[]).slice(0, 8).map((h) => `${limpio(h.nombre)}:${limpio(h.resultado)}`).join(", ")
      : "";
    return [
      `💥 Chat de Facturas sin respuesta · ${limpio(d.motivo) || "motivo desconocido"}${limpio(d.origen) ? ` (${limpio(d.origen)})` : ""}${dur}`,
      `P: ${recortar(limpio(d.pregunta), 200) || "(sin pregunta)"}`,
      ...(limpio(d.detalle) ? [`Detalle: ${recortar(limpio(d.detalle), 200)}`] : []),
      ...(herramientas ? [`Herramientas: ${recortar(herramientas, 200)}`] : []),
      ...(limpio(d.modelo) ? [`Modelo: ${recortar(limpio(d.modelo), 60)}`] : []),
      ...ademas(d),
    ].join("\n");
  },

  // 18/11/2026: los registra el vigilante (vigilante_fallos_telegram), ya agrupados y con tope.
  openai_sin_creditos: (f) => {
    const d = f.datos;
    return [
      `💳 OpenAI sin créditos: ${Number(d.trabajos) || "?"} lecturas de facturas fallidas${limpio(d.desde) ? ` desde ${diaHora(d.desde)}` : ""}. Hasta recargar, no se leen facturas.`,
      ...(limpio(d.ejemplo) ? [recortar(limpio(d.ejemplo), 200)] : []),
    ].join("\n");
  },
  ocr_fallido: (f) => {
    const d = f.datos;
    const motivos = Array.isArray(d.motivos) ? (d.motivos as Record<string, unknown>[]).slice(0, 3).map((m) => `- ${recortar(limpio(m.error), 140)} (${Number(m.n) || 1})`) : [];
    return [`📄 ${Number(d.trabajos) || "?"} lecturas de facturas fallidas${limpio(d.desde) ? ` desde ${diaHora(d.desde)}` : ""}`, ...motivos].join("\n");
  },
  cron_caido: (f) => {
    const d = f.datos;
    const crons = Array.isArray(d.crons) ? (d.crons as Record<string, unknown>[]).slice(0, 8) : [];
    return [
      "⏰ Tareas programadas sin éxito",
      ...crons.map((c) => `- ${limpio(c.job)}: ${Number(c.minutos) ? `${Math.round(Number(c.minutos))} min` : "mucho tiempo"} (máx. ${Number(c.maximo) || "?"})${limpio(c.error) ? ` · ${recortar(limpio(c.error), 100)}` : ""}`),
      ...(crons.length === 0 ? ["- (sin detalle)"] : []),
    ].join("\n");
  },
};

/** Texto de un fallo (tipo conocido o genérico), siempre ≤ LIMITE_TELEGRAM. */
export function mensajeFallo(f: Fallo, ctx: Contexto = {}): string {
  const formato = FORMATOS[f.tipo];
  const texto = formato
    ? formato(f, ctx)
    : [
      `🛠 ${f.tipo.replace(/_/g, " ")} · ${horaLegible(f.created_at)}${f.usuario ? ` · ${f.usuario}` : ""}`,
      recortar(JSON.stringify(f.datos), 1500),
    ].join("\n");
  return recortar(texto, LIMITE_TELEGRAM);
}
