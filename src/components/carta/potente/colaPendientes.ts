/**
 * Lógica pura de la cola de vídeos pendientes de procesar en un dispositivo
 * potente: qué trabajos se pueden coger, el texto del aviso y cuándo volver a
 * avisar. Sin Supabase ni React (testeable).
 */

export type EstadoTrabajoVideo = "pendiente" | "procesando" | "listo" | "error";

export interface TrabajoVideo {
  id: string;
  plato_id: string;
  ruta_original: string;
  tema: string;
  estado: EstadoTrabajoVideo;
  creado_por: string | null;
  dispositivo_origen: string | null;
  procesado_por: string | null;
  dispositivo_proceso?: string | null;
  reclamado_en: string | null;
  intentos: number;
  error: string | null;
  created_at: string;
  /** Embebido de PostgREST: `Platos(nombre)`. */
  Platos?: { nombre: string | null } | null;
}

/** Igual que la RPC reclamar_trabajo_video: un 'procesando' de hace más de esto se puede retomar. */
export const MS_ABANDONADO = 10 * 60 * 1000;
/** Sondeo de pendientes en los dispositivos potentes (no se usa realtime). */
export const MS_SONDEO = 60 * 1000;

export function reclamable(t: Pick<TrabajoVideo, "estado" | "reclamado_en">, ahora = Date.now()): boolean {
  if (t.estado === "pendiente") return true;
  if (t.estado !== "procesando" || !t.reclamado_en) return false;
  const r = Date.parse(t.reclamado_en);
  return Number.isFinite(r) && ahora - r > MS_ABANDONADO;
}

/** Los que se pueden procesar aquí, del más antiguo al más nuevo. */
export function pendientesReclamables<T extends TrabajoVideo>(trabajos: readonly T[], ahora = Date.now()): T[] {
  return trabajos
    .filter((t) => reclamable(t, ahora))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

export function nombrePlato(t: Pick<TrabajoVideo, "Platos">): string {
  return t.Platos?.nombre?.trim() || "Plato sin nombre";
}

/** «Hay 1 vídeo pendiente: Arroz meloso. ¿Procesarlo aquí?» */
export function textoAviso(trabajos: readonly TrabajoVideo[], maxNombres = 3): string {
  const n = trabajos.length;
  if (n === 0) return "";
  const nombres = trabajos.slice(0, maxNombres).map(nombrePlato);
  const resto = n > maxNombres ? ` y ${n - maxNombres} más` : "";
  const cabeza = n === 1 ? "Hay 1 vídeo pendiente" : `Hay ${n} vídeos pendientes`;
  const pregunta = n === 1 ? "¿Procesarlo aquí?" : "¿Procesarlos aquí?";
  return `${cabeza}: ${nombres.join(", ")}${resto}. ${pregunta}`;
}

/**
 * ¿Hay que (volver a) enseñar el aviso? Sí si aparece algún pendiente que no
 * estaba en los que el usuario ya descartó con «Ahora no».
 */
export function hayQueAvisar(actuales: readonly Pick<TrabajoVideo, "id">[], descartados: ReadonlySet<string>): boolean {
  return actuales.some((t) => !descartados.has(t.id));
}

/** Extensión del vídeo en bruto según nombre o tipo MIME (la que admite la migración). */
export function extensionBruto(archivo: { name?: string; type?: string }): "mp4" | "mov" | "m4v" | "webm" | "3gp" | "mkv" {
  const porNombre = /\.([a-z0-9]+)$/i.exec(archivo.name ?? "")?.[1]?.toLowerCase();
  const validas = ["mp4", "mov", "m4v", "webm", "3gp", "mkv"] as const;
  if (porNombre && (validas as readonly string[]).includes(porNombre)) return porNombre as (typeof validas)[number];
  const t = (archivo.type ?? "").toLowerCase();
  if (t.includes("quicktime")) return "mov";
  if (t.includes("webm")) return "webm";
  if (t.includes("3gpp")) return "3gp";
  if (t.includes("matroska")) return "mkv";
  return "mp4";
}

export function tipoMimeBruto(ext: ReturnType<typeof extensionBruto>): string {
  return {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    "3gp": "video/3gpp",
    mkv: "video/x-matroska",
  }[ext];
}

/** Límite del vídeo en bruto. El plan gratuito de Supabase no admite ficheros de más de 50 MB. */
export const MAX_BYTES_BRUTO = 50 * 1024 * 1024;

/** «Chrome · Android» a partir del user agent (para dispositivo_origen / etiqueta push). */
export function describirDispositivo(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  const so = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "Otro";
  const nav = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /CriOS|Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Navegador";
  return `${nav} · ${so}`;
}

/** Error de PostgREST por tabla/función inexistente (migración sin aplicar). */
export function esErrorSinMigracion(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  if (["PGRST205", "PGRST202", "42P01", "42883"].includes(e.code ?? "")) return true;
  return /trabajos_video|suscripciones_push|reclamar_trabajo_video|guardar_suscripcion_push/.test(e.message ?? "") &&
    /does not exist|could not find|schema cache/i.test(e.message ?? "");
}
