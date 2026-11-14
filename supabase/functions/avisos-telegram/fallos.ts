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
