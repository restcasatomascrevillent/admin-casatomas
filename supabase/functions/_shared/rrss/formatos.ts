// COPIA GENERADA de src/lib/rrss (node scripts/rrss/copiar-contratos.mjs). No editar a mano.
/**
 * RRSS · formatos de salida por canal (Instagram / Facebook) y tipo de contenido.
 *
 * Isomórfico y sin dependencias: lo usan el panel (editor), el motor de Vercel
 * (api/_lib/rrss) y, copiado literal, la Edge Function rrss-ia
 * (supabase/functions/_shared/rrss/plan.ts lleva su propia copia de los ids;
 * un test comprueba que coinciden).
 *
 * Medidas: las que publica Meta para cada formato (consultado el 08/11/2026):
 *  · Instagram feed y carrusel: 4:5 vertical (1080×1350) es lo que más ocupa
 *    en pantalla; stories y reels 9:16 (1080×1920) con 250 px libres arriba y
 *    abajo para la interfaz de la app.
 *  · Facebook feed: admite 4:5 en fotos; los álbumes de varias fotos se ven
 *    en cuadrícula, así que el «carrusel» de Facebook va en 1:1 (1080×1080);
 *    el vídeo del feed, 1:1 o 4:5; stories y reels 9:16.
 */

export type Canal = "instagram" | "facebook";
export type TipoContenido = "publicacion" | "carrusel" | "story" | "reel" | "animada";
export type Medio = "foto" | "video";

export const CANALES: readonly Canal[] = ["instagram", "facebook"];
export const TIPOS_CONTENIDO: readonly TipoContenido[] = ["publicacion", "carrusel", "story", "reel", "animada"];

export interface ZonaSegura {
  arriba: number;
  abajo: number;
  lados: number;
}

export interface FormatoSalida {
  canal: Canal;
  tipo: TipoContenido;
  /** Qué produce el motor: imágenes JPEG o un MP4. */
  medio: Medio;
  ancho: number;
  alto: number;
  /** Archivos de entrada admitidos (fotos o vídeos según `entrada`). */
  minArchivos: number;
  maxArchivos: number;
  /** Qué acepta como entrada. */
  entrada: "fotos" | "videos" | "fotos-o-videos";
  /** Solo vídeo: duración en segundos. */
  duracion?: { min: number; max: number; objetivo: number };
  zonaSegura: ZonaSegura;
  etiqueta: string;
  descripcion: string;
}

const ZONA_FEED: ZonaSegura = { arriba: 72, abajo: 72, lados: 72 };
const ZONA_VERTICAL: ZonaSegura = { arriba: 250, abajo: 320, lados: 64 };

const BASE: Record<TipoContenido, Omit<FormatoSalida, "canal" | "ancho" | "alto">> = {
  publicacion: {
    tipo: "publicacion",
    medio: "foto",
    minArchivos: 1,
    maxArchivos: 1,
    entrada: "fotos",
    zonaSegura: ZONA_FEED,
    etiqueta: "Publicación",
    descripcion: "Una imagen para el muro",
  },
  carrusel: {
    tipo: "carrusel",
    medio: "foto",
    minArchivos: 2,
    maxArchivos: 10,
    entrada: "fotos",
    zonaSegura: ZONA_FEED,
    etiqueta: "Carrusel",
    descripcion: "De 2 a 10 imágenes coherentes, en orden",
  },
  story: {
    tipo: "story",
    medio: "foto",
    minArchivos: 1,
    maxArchivos: 1,
    entrada: "fotos-o-videos",
    duracion: { min: 3, max: 60, objetivo: 12 },
    zonaSegura: ZONA_VERTICAL,
    etiqueta: "Story",
    descripcion: "Vertical 9:16; foto o vídeo corto",
  },
  reel: {
    tipo: "reel",
    medio: "video",
    minArchivos: 1,
    maxArchivos: 12,
    entrada: "fotos-o-videos",
    duracion: { min: 5, max: 90, objetivo: 20 },
    zonaSegura: ZONA_VERTICAL,
    etiqueta: "Reel",
    descripcion: "Vídeo vertical montado con tus clips (y fotos)",
  },
  animada: {
    tipo: "animada",
    medio: "video",
    minArchivos: 1,
    maxArchivos: 10,
    entrada: "fotos",
    duracion: { min: 4, max: 30, objetivo: 10 },
    zonaSegura: ZONA_FEED,
    etiqueta: "Pieza animada",
    descripcion: "Vídeo corto hecho a partir de fotos, con movimiento",
  },
};

const MEDIDAS: Record<Canal, Record<TipoContenido, { ancho: number; alto: number }>> = {
  instagram: {
    publicacion: { ancho: 1080, alto: 1350 },
    carrusel: { ancho: 1080, alto: 1350 },
    story: { ancho: 1080, alto: 1920 },
    reel: { ancho: 1080, alto: 1920 },
    animada: { ancho: 1080, alto: 1350 },
  },
  facebook: {
    publicacion: { ancho: 1080, alto: 1350 },
    carrusel: { ancho: 1080, alto: 1080 },
    story: { ancho: 1080, alto: 1920 },
    reel: { ancho: 1080, alto: 1920 },
    animada: { ancho: 1080, alto: 1080 },
  },
};

export function esCanal(v: unknown): v is Canal {
  return v === "instagram" || v === "facebook";
}

export function esTipoContenido(v: unknown): v is TipoContenido {
  return typeof v === "string" && (TIPOS_CONTENIDO as readonly string[]).includes(v);
}

/**
 * Formato de salida. Una story con algún vídeo entre los archivos sale en
 * vídeo; sin vídeos, en foto.
 */
export function formatoSalida(canal: Canal, tipo: TipoContenido, hayVideos = false): FormatoSalida {
  const base = BASE[tipo];
  const medio: Medio = tipo === "story" ? (hayVideos ? "video" : "foto") : base.medio;
  return { ...base, medio, canal, ...MEDIDAS[canal][tipo] };
}

/** Problemas de los archivos elegidos para ese formato (vacío = vale). */
export function problemasArchivos(f: FormatoSalida, archivos: { tipo: Medio }[]): string[] {
  const p: string[] = [];
  const fotos = archivos.filter((a) => a.tipo === "foto").length;
  const videos = archivos.length - fotos;
  if (archivos.length === 0) p.push("Sube al menos una foto o un vídeo");
  if (f.entrada === "fotos" && videos > 0) p.push(`${f.etiqueta}: solo admite fotos (quita los vídeos o elige Reel o Story)`);
  if (f.tipo === "carrusel" && fotos < 2) p.push("Un carrusel necesita al menos 2 fotos");
  if (archivos.length > f.maxArchivos) p.push(`${f.etiqueta}: como mucho ${f.maxArchivos} archivos`);
  if (f.tipo === "story" && archivos.length > 1 && videos === 0) p.push("Una story de foto lleva una sola foto: elige Carrusel o Pieza animada para varias");
  return p;
}

/** Proporción legible («4:5», «9:16», «1:1»). */
export function proporcion(f: Pick<FormatoSalida, "ancho" | "alto">): string {
  const mcd = (a: number, b: number): number => (b === 0 ? a : mcd(b, a % b));
  const d = mcd(f.ancho, f.alto);
  return `${f.ancho / d}:${f.alto / d}`;
}

export const NOMBRE_CANAL: Record<Canal, string> = { instagram: "Instagram", facebook: "Facebook" };
