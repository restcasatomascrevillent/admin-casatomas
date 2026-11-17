// ============================================================================
//  avisos-telegram · fallos internos para desarrolladores (12/11/2026)
//  Lógica pura (sin Deno ni red), probada en __tests__/fallos.test.ts.
//
//  Para un TIPO NUEVO: registrarlo con fallo_interno_registrar('<tipo>', datos)
//  (SQL) y, si quieres un formato propio, añadir una entrada a FORMATOS. Sin
//  formato propio sale el genérico (tipo + datos).
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

export function horaLegible(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "?";
  return new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

/** Id del albarán de un fallo albaran_aviso, o null. */
export function idAlbaran(f: Fallo): number | null {
  const n = Number(f.datos.factura_id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type Formato = (f: Fallo, ctx: Contexto) => string;

/** «Además: N más desde …»: los que llegaron agrupados (fallos_internos_agrupar, 15 min) desde el aviso anterior. */
function ademas(d: Record<string, unknown>, uno: string, varios: string): string[] {
  const n = Number(d.acumulados_antes);
  if (!(Number.isInteger(n) && n > 0)) return [];
  const ids = Array.isArray(d.acumulados_ids) ? d.acumulados_ids.map((x) => limpio(String(x))).filter(Boolean) : [];
  return [
    `Además: ${n} ${n === 1 ? uno : varios} más desde ${horaLegible(limpio(d.acumulados_desde))} (se agrupan: un aviso cada 15 min como mucho).`,
    ...(ids.length ? [`Ids: ${ids.slice(0, 10).join(", ")}${ids.length > 10 ? "…" : ""}`] : []),
  ];
}

const diaHora = (v: unknown): string => horaLegible(limpio(v) || null);

const FORMATOS: Record<string, Formato> = {
  albaran_aviso: (f, ctx) => {
    const a = ctx.albaran;
    const avisos = Array.isArray(f.datos.avisos) ? (f.datos.avisos as Record<string, unknown>[]) : [];
    const lineas = avisos.map((x) => `- ${limpio(x.mensaje) || limpio(x.codigo) || "(sin texto)"}${limpio(x.codigo) ? ` [${limpio(x.codigo)}]` : ""}`);
    return [
      "Aviso al subir un albarán",
      `Proveedor: ${limpio(a?.proveedor) || "(desconocido)"}`,
      `Fecha: ${limpio(a?.fecha) || "(sin fecha)"}`,
      `Albarán id: ${a?.id ?? idAlbaran(f) ?? "?"}`,
      ...(limpio(f.datos.archivo) ? [`Archivo: ${limpio(f.datos.archivo)}`] : []),
      `Aviso${lineas.length === 1 ? "" : "s"}:`,
      ...(lineas.length ? lineas : ["- (sin detalle)"]),
      ...ademas(f.datos, "aviso de albarán", "avisos de albarán"),
    ].join("\n");
  },
  chat_pulgar_abajo: (f) => {
    const d = f.datos;
    return [
      "Pulgar abajo en el chatbot de facturas",
      `Usuario: ${limpio(f.usuario) || "(desconocido)"}`,
      `Hora: ${horaLegible(limpio(d.hora) || f.created_at)}`,
      ...(limpio(d.modelo) ? [`Modelo: ${limpio(d.modelo)}`] : []),
      `Pregunta: ${recortar(limpio(d.pregunta), 800)}`,
      `Respuesta del bot: ${recortar(limpio(d.respuesta), 1800)}`,
      ...(limpio(d.comentario) ? [`Comentario: ${recortar(limpio(d.comentario), 400)}`] : []),
      ...ademas(d, "pulgar abajo", "pulgares abajo"),
    ].join("\n");
  },
  // 18/11/2026: agrupados en SQL (fallo_interno_registrar): como mucho uno cada 15 min; los
  // que llegaron mientras tanto vienen contados en acumulados_antes.
  chat_error: (f) => {
    const d = f.datos;
    const acumulados = Number(d.acumulados_antes);
    const herramientas = Array.isArray(d.herramientas)
      ? (d.herramientas as Record<string, unknown>[]).slice(0, 8).map((h) => `${limpio(h.nombre)}:${limpio(h.resultado)}`).join(", ")
      : "";
    return [
      "Fallo del copiloto de Facturas",
      `Motivo: ${limpio(d.motivo) || "(desconocido)"}${limpio(d.origen) ? ` (${limpio(d.origen)})` : ""}`,
      `Hora: ${horaLegible(f.created_at)}`,
      ...(Number.isFinite(Number(d.duracion_ms)) ? [`Duración: ${Math.round(Number(d.duracion_ms) / 100) / 10} s`] : []),
      ...(limpio(d.modelo) ? [`Modelo: ${recortar(limpio(d.modelo), 60)}`] : []),
      `Pregunta: ${recortar(limpio(d.pregunta), 300) || "(sin pregunta)"}`,
      ...(limpio(d.detalle) ? [`Detalle: ${recortar(limpio(d.detalle), 300)}`] : []),
      ...(herramientas ? [`Herramientas: ${recortar(herramientas, 400)}`] : []),
      ...(Number.isInteger(acumulados) && acumulados > 0
        ? [`Además: ${acumulados} fallo${acumulados === 1 ? "" : "s"} más del chat desde ${horaLegible(limpio(d.acumulados_desde))} (se agrupan: un aviso cada 15 min como mucho).`]
        : []),
    ].join("\n");
  },

  // 18/11/2026: los registra el vigilante (vigilante_fallos_telegram), ya agrupados y con tope.
  openai_sin_creditos: (f) => {
    const d = f.datos;
    return [
      "OpenAI sin créditos o con error de facturación",
      `Lecturas de facturas fallidas por esto: ${Number(d.trabajos) || "?"}${limpio(d.desde) ? ` (desde ${diaHora(d.desde)})` : ""}`,
      ...(limpio(d.ejemplo) ? [`Error: ${recortar(limpio(d.ejemplo), 250)}`] : []),
      "Qué hacer: revisa el saldo y la facturación de OpenAI; hasta entonces las facturas nuevas no se leen.",
    ].join("\n");
  },
  ocr_fallido: (f) => {
    const d = f.datos;
    const motivos = Array.isArray(d.motivos) ? (d.motivos as Record<string, unknown>[]).slice(0, 3).map((m) => `- ${recortar(limpio(m.error), 160)} (${Number(m.n) || 1})`) : [];
    return [
      "Lecturas de facturas fallidas",
      `Cuántas: ${Number(d.trabajos) || "?"}${limpio(d.desde) ? ` desde ${diaHora(d.desde)}` : ""}`,
      ...(motivos.length ? ["Motivos:", ...motivos] : []),
      "Qué hacer: míralas en Facturas y vuelve a subirlas si hace falta.",
    ].join("\n");
  },
  cron_caido: (f) => {
    const d = f.datos;
    const crons = Array.isArray(d.crons) ? (d.crons as Record<string, unknown>[]).slice(0, 8) : [];
    return [
      "Tarea programada sin éxito",
      ...crons.map((c) => `- ${limpio(c.job)}: ${Number(c.minutos) ? `${Math.round(Number(c.minutos))} min` : "mucho tiempo"} sin éxito (máx. ${Number(c.maximo) || "?"})${limpio(c.error) ? ` · ${recortar(limpio(c.error), 100)}` : ""}`),
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
      `Fallo interno: ${f.tipo.replace(/_/g, " ")}`,
      ...(f.usuario ? [`Usuario: ${f.usuario}`] : []),
      `Hora: ${horaLegible(f.created_at)}`,
      recortar(JSON.stringify(f.datos), 2500),
    ].join("\n");
  return recortar(texto, LIMITE_TELEGRAM);
}
