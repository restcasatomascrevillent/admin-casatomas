/**
 * ORIGINAL de la foto de un plato o un vino para Instagram (petición del
 * dueño, 08/11/2026). La carta guarda la versión para la web (1200×900 webp
 * con el fondo de carta); Instagram necesita la foto a tamaño completo. Cada
 * vez que se sube o se cambia la foto de un plato o un vino, además de la
 * versión web se manda el fichero ORIGINAL que eligió el usuario a Google
 * Drive (marketing/carta/<marca>/<nombre>-<id>.jpg) con instagram-drive
 * · subir_original.
 *
 *   - Se convierte a JPEG (calidad 0,92; fondo blanco si tenía transparencia)
 *     con la orientación EXIF aplicada y el lado mayor ≤ 4000 px (nunca
 *     amplía). Si pasa de 8 MB se baja la calidad y, si hace falta, el lado.
 *   - Va en segundo plano, DESPUÉS de guardar la ficha: si Drive falla, la
 *     foto de la web ya está guardada y solo se avisa («El original no se ha
 *     podido guardar en Drive»), sin bloquear a nadie.
 *
 * Ver docs/instagram-fotos.md, «Originales de la carta en Drive».
 */
import { toast } from "sonner";

export const LADO_MAXIMO_ORIGINAL = 4000;
export const MAX_BYTES_ORIGINAL = 8 * 1024 * 1024;
export const AVISO_SIN_ORIGINAL = "El original no se ha podido guardar en Drive";
/** Calidades que se prueban, de mejor a peor, hasta que quepa en 8 MB. */
const CALIDADES = [0.92, 0.86, 0.8, 0.72] as const;

export type TablaOriginal = "Platos" | "Vinos";

export function esTablaOriginal(t: string): t is TablaOriginal {
  return t === "Platos" || t === "Vinos";
}

/** Medidas de salida: lado mayor ≤ `lado`, sin ampliar. */
export function medidasOriginal(ancho: number, alto: number, lado = LADO_MAXIMO_ORIGINAL): { ancho: number; alto: number } {
  const escala = Math.min(1, lado / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

/** Lo que hace falta del navegador (se sustituye en las pruebas). */
export interface Lienzo {
  /** Imagen decodificada YA girada según EXIF. */
  decodificar(f: Blob): Promise<{ ancho: number; alto: number; dibujar(ctx: CanvasRenderingContext2D, ancho: number, alto: number): void; cerrar(): void }>;
  /** Dibuja con `pintar` en un lienzo de ancho×alto y lo codifica como JPEG. */
  jpeg(ancho: number, alto: number, pintar: (ctx: CanvasRenderingContext2D) => void, calidad: number): Promise<Blob | null>;
}

export const lienzoNavegador: Lienzo = {
  async decodificar(f) {
    // «from-image» aplica la orientación EXIF (fotos de móvil en vertical).
    const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
    return {
      ancho: bmp.width,
      alto: bmp.height,
      dibujar: (ctx, ancho, alto) => ctx.drawImage(bmp, 0, 0, ancho, alto),
      cerrar: () => bmp.close(),
    };
  },
  async jpeg(ancho, alto, pintar, calidad) {
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext("2d", { colorSpace: "srgb" } as CanvasRenderingContext2DSettings) ?? lienzo.getContext("2d");
    if (!ctx) return null;
    pintar(ctx);
    const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, "image/jpeg", calidad));
    lienzo.width = lienzo.height = 0; // libera la memoria del lienzo (móviles)
    return blob;
  },
};

/**
 * Fichero elegido (JPEG, PNG, WebP, o HEIC si el navegador lo abre) → JPEG
 * original para Drive. Lanza si no se puede decodificar o no cabe en 8 MB.
 */
export async function prepararOriginal(f: Blob, lienzo: Lienzo = lienzoNavegador): Promise<{ blob: Blob; ancho: number; alto: number }> {
  const img = await lienzo.decodificar(f);
  try {
    if (!(img.ancho > 0 && img.alto > 0)) throw new Error("La foto no tiene medidas");
    for (const lado of [LADO_MAXIMO_ORIGINAL, 3000]) {
      const m = medidasOriginal(img.ancho, img.alto, lado);
      for (const calidad of CALIDADES) {
        const blob = await lienzo.jpeg(
          m.ancho,
          m.alto,
          (ctx) => {
            ctx.fillStyle = "#ffffff"; // un PNG con transparencia no sale negro
            ctx.fillRect(0, 0, m.ancho, m.alto);
            img.dibujar(ctx, m.ancho, m.alto);
          },
          calidad,
        );
        if (!blob || blob.size === 0 || (blob.type && blob.type !== "image/jpeg")) throw new Error("El navegador no ha podido convertir la foto a JPEG");
        if (blob.size <= MAX_BYTES_ORIGINAL) return { blob, ...m };
      }
    }
    throw new Error("El original pesa más de 8 MB incluso comprimido");
  } finally {
    img.cerrar();
  }
}

export interface DependenciasOriginal {
  lienzo?: Lienzo;
  /** Por defecto, subirOriginalCarta de la API de Instagram (carga diferida). */
  subir?: (n: { tabla: TablaOriginal; id: string; blob: Blob }) => Promise<unknown>;
  avisar?: (mensaje: string, detalle: string) => void;
}

function mensajeDe(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "");
  return m.trim() || "Error desconocido";
}

/**
 * Convierte y sube el original. Nunca lanza: devuelve true si quedó en
 * Drive; si no, avisa (toast) y devuelve false. La ficha ya está guardada.
 */
export async function guardarOriginalCarta(tabla: TablaOriginal, id: string, archivo: Blob, deps: DependenciasOriginal = {}): Promise<boolean> {
  const avisar = deps.avisar ?? ((m: string, d: string) => toast.warning(m, { description: d, duration: 8000, id: `original-${id}` }));
  try {
    const { blob } = await prepararOriginal(archivo, deps.lienzo);
    const subir = deps.subir ?? (async (n) => (await import("@/components/marketing/instagram/api")).subirOriginalCarta(n));
    await subir({ tabla, id, blob });
    return true;
  } catch (e) {
    console.warn("[carta] original sin guardar en Drive", e);
    try {
      avisar(AVISO_SIN_ORIGINAL, `La foto de la web sí está guardada. ${mensajeDe(e)}`);
    } catch {
      /* el aviso nunca rompe el guardado */
    }
    return false;
  }
}
