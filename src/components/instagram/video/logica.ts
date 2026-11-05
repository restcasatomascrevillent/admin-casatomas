/**
 * Reels en MP4 en el panel (fase 6, docs/instagram-video.md): lógica pura de
 * la pestaña Reels (estado del trabajo de render, qué botones se pueden
 * pulsar, fotos que hay que preparar). Sin React ni Supabase: se prueba sola.
 */
import { esMuestra, type ReelPieza } from "@/lib/instagram/reels";

export type EstadoTrabajo = "pendiente" | "renderizando" | "listo" | "error" | "cancelado";

/** Fila de instagram_trabajos_render (lo que lee el panel). */
export interface TrabajoRender {
  id: string;
  pieza_id: string;
  estado: EstadoTrabajo;
  progreso: number;
  fotogramas: number | null;
  dispositivo: string | null;
  error: string | null;
  avisos: string[] | null;
  intentos: number;
  created_at: string;
  reclamado_en: string | null;
  latido_en: string | null;
  terminado_en: string | null;
}

/** Columnas de instagram_piezas que usa la pestaña Reels. */
export interface PiezaReel {
  id: string;
  marca: string;
  plantilla: string;
  tipo_medio: string;
  estado: "borrador" | "generada" | "procesando" | "prueba_ok" | "publicada" | "error";
  datos: unknown;
  caption: string | null;
  video_ruta: string | null;
  portada_ruta: string | null;
  duracion_s: number | string | null;
  video_bytes: number | null;
  contenedor_id: string | null;
  permalink: string | null;
  error: string | null;
  procesando_accion: string | null;
  procesando_desde: string | null;
  updated_at: string;
  created_at: string;
}

/** Un trabajo pendiente más viejo que esto: probablemente el equipo de render está apagado. */
export const ESPERA_SIN_TRABAJADOR_MS = 2 * 60_000;

export interface EstadoVisible {
  etiqueta: string;
  detalle: string | null;
  tono: "neutro" | "trabajando" | "bien" | "mal";
  /** 0-100 o null si no aplica. */
  progreso: number | null;
  activo: boolean;
}

/** Cómo se enseña el último trabajo de render de la pieza. */
export function estadoVisible(t: TrabajoRender | null | undefined, ahora = Date.now()): EstadoVisible | null {
  if (!t) return null;
  switch (t.estado) {
    case "pendiente": {
      const espera = ahora - Date.parse(t.created_at);
      return {
        etiqueta: "En cola",
        detalle:
          espera > ESPERA_SIN_TRABAJADOR_MS
            ? "Lo montaremos en cuanto el ordenador de vídeo esté encendido; te avisamos cuando esté."
            : "Lo estamos montando; te avisamos cuando esté.",
        tono: "neutro",
        progreso: null,
        activo: true,
      };
    }
    case "renderizando":
      return {
        etiqueta: "Renderizando",
        detalle: t.dispositivo ? `Montándolo en ${t.dispositivo}` : "Montando el vídeo…",
        tono: "trabajando",
        progreso: Math.max(0, Math.min(100, t.progreso ?? 0)),
        activo: true,
      };
    case "listo":
      return { etiqueta: "Listo", detalle: null, tono: "bien", progreso: 100, activo: false };
    case "error":
      return { etiqueta: "Error", detalle: t.error, tono: "mal", progreso: null, activo: false };
    case "cancelado":
      return { etiqueta: "Cancelado", detalle: t.error, tono: "neutro", progreso: null, activo: false };
    default:
      return null;
  }
}

/** JSON con las claves ordenadas: jsonb no conserva el orden, así se compara el reel con datos. */
export function firmaEstable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(firmaEstable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${firmaEstable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** ids de foto del reel (escenas y cierre), sin repetir. */
export function idsFotosReel(reel: Pick<ReelPieza, "escenas" | "cierre">): string[] {
  return [...new Set([...reel.escenas.map((e) => e.foto), reel.cierre.foto].filter((x): x is string => !!x))];
}

/** Fotos que hay que preparar (copia tmp/ del cubo) para el render: las de Drive y la carta. */
export function fotosAPreparar(reel: Pick<ReelPieza, "escenas" | "cierre">): string[] {
  return idsFotosReel(reel).filter((id) => !esMuestra(id) && (id.startsWith("drive:") || id.startsWith("carta:") || id.startsWith("plato:")));
}

export interface Botones {
  generar: boolean;
  probar: boolean;
  publicar: boolean;
  /** Por qué no se puede probar/publicar (texto para el usuario). */
  motivo: string | null;
}

/**
 * Qué se puede pulsar. Igual que las imágenes: probar con el vídeo al día;
 * publicar y programar, tras una prueba correcta con el mismo texto.
 */
export function botonesReel(o: {
  valido: boolean;
  ocupado: boolean;
  trabajoActivo: boolean;
  pieza: Pick<PiezaReel, "estado" | "video_ruta" | "caption"> | null;
  reelAlDia: boolean;
  caption: string;
  captionValido: boolean;
}): Botones {
  const { pieza } = o;
  const publicada = pieza?.estado === "publicada";
  const generar = o.valido && !o.ocupado && !o.trabajoActivo && !publicada && pieza?.estado !== "procesando";
  let motivo: string | null = null;
  if (publicada) motivo = "Ya está publicado.";
  else if (!pieza?.video_ruta) motivo = "Primero genera el vídeo.";
  else if (!o.reelAlDia) motivo = "Has cambiado el reel: vuelve a generar el vídeo.";
  else if (pieza.estado === "procesando") motivo = "Instagram está procesando el vídeo.";
  else if (!o.captionValido) motivo = "Revisa el texto.";
  const base = !motivo && !o.ocupado && !o.trabajoActivo;
  const pruebaVigente = pieza?.estado === "prueba_ok" && (pieza.caption ?? "") === o.caption;
  return {
    generar,
    probar: base,
    publicar: base && pruebaVigente,
    motivo: motivo ?? (base && !pruebaVigente ? "Publicar y Programar se activan cuando la prueba sin publicar sale bien." : null),
  };
}

/** «18,3 MB · 20,5 s» */
export function resumenVideo(p: Pick<PiezaReel, "video_bytes" | "duracion_s">): string {
  const partes: string[] = [];
  if (p.video_bytes) partes.push(`${(p.video_bytes / 1048576).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`);
  if (p.duracion_s !== null && p.duracion_s !== undefined) partes.push(`${Number(p.duracion_s).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s`);
  return partes.join(" · ");
}

/** Pistas de audio admitidas (con licencia propia): extensión → tipo. */
export const TIPOS_AUDIO: Readonly<Record<string, string>> = { m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac", wav: "audio/wav" };
export const MAX_BYTES_AUDIO = 50 * 1024 * 1024;

/** Extensión válida de una pista o el motivo por el que no vale. */
export function revisarPista(nombre: string, bytes: number): { ok: true; ext: string } | { ok: false; motivo: string } {
  const ext = nombre.toLowerCase().split(".").pop() ?? "";
  if (!(ext in TIPOS_AUDIO)) return { ok: false, motivo: "La pista tiene que ser M4A, MP3, AAC o WAV." };
  if (bytes > MAX_BYTES_AUDIO) return { ok: false, motivo: "La pista pesa más de 50 MB." };
  if (bytes <= 0) return { ok: false, motivo: "La pista está vacía." };
  return { ok: true, ext };
}
