/**
 * Fotos de los reels.
 *
 * En la pieza, cada escena guarda SOLO el id de su foto (como las imágenes):
 *   "drive:<id>"   biblioteca de Google Drive (docs/instagram-fotos.md)
 *   "carta:<id>"   / "plato:<id>"  fotos de la carta
 *   "muestra:<n>"  fotos de MUESTRA de las 5 bases (las del dueño en
 *                  marca-base/assets/local, reducidas a 720 px de lado corto,
 *                  en public/instagram/reels/muestras/). Solo para ver la base
 *                  en el panel: para el MP4 hay que cambiarlas por fotos de la
 *                  biblioteca (la validación lo avisa).
 * La URL se resuelve fuera (ResolverFoto): las de Drive son copias temporales
 * tmp/<uuid> del bucket que hace «preparar», y no deben guardarse en la pieza.
 */
import { sinBarraFinal } from "../tokens.js";
import type { MarcaReel } from "./marca.js";

/** id de foto → URL (o undefined si todavía no se conoce: se pinta un hueco). */
export type ResolverFoto = (id: string) => string | undefined;

/** Lo que devuelve el selector de fotos del panel (prop elegirFoto). */
export interface FotoElegida {
  /** id que se guarda en la pieza («drive:…», «carta:…»). */
  id: string;
  /** URL para la vista previa (p. ej. la copia tmp/ del bucket o la miniatura). */
  url: string;
  ancho?: number;
  alto?: number;
  descripcion?: string;
}

export const PREFIJO_MUESTRA = "muestra:";
export const RUTA_MUESTRAS = "reels/muestras";

/** Fotos de muestra disponibles (nombre → marca). */
export const MUESTRAS_REEL: Readonly<Record<string, MarcaReel>> = {
  lampara: "casa-tomas",
  sala: "casa-tomas",
  "platos-pared": "casa-tomas",
  "vitrina-gallega": "casa-tomas",
  "mesa-copas": "casa-tomas",
  "barra-logo": "casa-tomas",
  "postre-nudo": "casa-tomas",
  gambas: "casa-tomas",
  ostras: "casa-tomas",
  bogavante: "casa-tomas",
  "tartar-atun": "casa-tomas",
  salazones: "casa-tomas",
  arroz: "casa-tomas",
  "vinoteca-mesa": "casa-tomas",
  "vino-aalto": "casa-tomas",
  "vino-pidio": "casa-tomas",
  "vino-ritus": "casa-tomas",
  "vino-calogia": "casa-tomas",
  chuleton: "casa-tomas",
  cecina: "casa-tomas",
  "steak-tartar": "casa-tomas",
  "carne-guiso": "casa-tomas",
  alcachofas: "casa-tomas",
  "touza-barra": "touza",
  "web-touza-5": "touza",
  "web-touza-7": "touza",
  "web-touza-8-1": "touza",
  "web-touza-10": "touza",
  "web-touza-2": "touza",
};

export const esMuestra = (id: string | undefined): boolean => !!id && id.startsWith(PREFIJO_MUESTRA);
export const nombreMuestra = (id: string) => id.slice(PREFIJO_MUESTRA.length);
export const idMuestra = (nombre: string) => `${PREFIJO_MUESTRA}${nombre}`;

/** Ruta (relativa a baseRecursos) de todas las muestras que debe haber en public/instagram/. */
export function rutasMuestras(): string[] {
  return Object.keys(MUESTRAS_REEL).map((n) => `${RUTA_MUESTRAS}/${n}.jpg`);
}

/**
 * Resolver por defecto: las muestras se sirven desde el panel; el resto se
 * busca en `extra` (el que pase el panel con las URLs de Drive o la carta).
 */
export function crearResolverFotos(baseRecursos = "/instagram", extra?: ResolverFoto | Readonly<Record<string, string>>): ResolverFoto {
  const base = sinBarraFinal(baseRecursos);
  return (id: string) => {
    if (esMuestra(id)) {
      const n = nombreMuestra(id);
      return n in MUESTRAS_REEL ? `${base}/${RUTA_MUESTRAS}/${encodeURIComponent(n)}.jpg` : undefined;
    }
    if (!extra) return undefined;
    return typeof extra === "function" ? extra(id) : extra[id];
  };
}
