/**
 * Dónde viven los recursos de las piezas. DOS orígenes (decisión del dueño,
 * 04/11/2026, para no llenar el bucket de Supabase):
 *
 *  1. FUENTES y LOGOS, en el propio panel (public/instagram/, ~1 MB, los sirve
 *     Vercel):           <baseRecursos>/fuentes/<familia>/<fichero>.woff2 (+ OFL.txt)
 *                        <baseRecursos>/logos/<marca>-<pieza>-<color>.png
 *     baseRecursos = baseRecursosPanel()            → "/instagram" (en el navegador)
 *                  = baseRecursosPanel(origen)      → "https://<panel>/instagram"
 *                    (cuando renderiza el servidor, o en un iframe sin origen).
 *
 *  2. FOTOS de la biblioteca, en el bucket PÚBLICO «instagram» de Supabase
 *     (migración 20261105090000_instagram.sql; las sube
 *     scripts/instagram/subir-recursos.mjs):
 *                        <baseFotos>/fotos/<marca>/<nombre>.jpg
 *     baseFotos = baseFotosPublica(supabaseUrl)
 *               = `${supabaseUrl}/storage/v1/object/public/instagram`.
 *     En el mismo bucket van las piezas generadas (piezas/…, temporales).
 */
import { sinBarraFinal, type MarcaId } from "./tokens.js";
import { FOTOS, type Foto } from "./fotos.js";

export const BUCKET_INSTAGRAM = "instagram";

/** Carpeta de public/ con fuentes y logos (ruta URL del panel). */
export const RUTA_RECURSOS_PANEL = "/instagram";

/**
 * Base de fuentes y logos servidos por el panel. Sin origen → "/instagram"
 * (relativa, vale en el navegador y en un iframe srcdoc del panel); con origen
 * (p. ej. "https://panel.example.com" o window.location.origin) → absoluta.
 */
export function baseRecursosPanel(origen = ""): string {
  return `${sinBarraFinal(origen)}${RUTA_RECURSOS_PANEL}`;
}

/** Base pública de las fotos (bucket «instagram»): `${supabaseUrl}/storage/v1/object/public/instagram`. */
export function baseFotosPublica(supabaseUrl: string): string {
  return `${sinBarraFinal(supabaseUrl)}/storage/v1/object/public/${BUCKET_INSTAGRAM}`;
}

/**
 * @deprecated Desde que fuentes y logos van en el panel, el bucket solo tiene
 * fotos y piezas: usa baseFotosPublica (misma URL) para `baseFotos` y
 * baseRecursosPanel para `baseRecursos`.
 */
export const baseRecursosPublica = baseFotosPublica;

/** Codifica cada tramo de una ruta (deja las barras). */
function codificarRuta(ruta: string): string {
  return ruta.split("/").map(encodeURIComponent).join("/");
}

/** URL de un fichero a partir de una base y su ruta relativa a ella. */
export function urlRecurso(base: string, ruta: string): string {
  return `${sinBarraFinal(base)}/${codificarRuta(ruta)}`;
}

/** URL de una foto del catálogo (por id o por el objeto) en el bucket. Lanza si el id no existe. */
export function urlFoto(baseFotos: string, foto: string | Foto): string {
  const f = typeof foto === "string" ? FOTOS.find((x) => x.id === foto) : foto;
  if (!f) throw new Error(`La foto «${String(foto)}» no está en el catálogo de fotos`);
  return urlRecurso(baseFotos, f.ruta);
}

// ── Logos ────────────────────────────────────────────────────────────────────

/**
 * Logos disponibles por marca (PNG recoloreados del prototipo, fondo
 * transparente, en public/instagram/logos/). Los colores son claves de
 * MARCAS[marca].colores. El wordmark TOUZA es texto (Cormorant 700), no imagen.
 */
export const LOGOS = {
  "casa-tomas": {
    piezas: ["logo", "medallon"],
    colores: { negro: "negro-logo", blanco: "blanco", pizarra: "pizarra", oro: "oro" },
  },
  touza: {
    piezas: ["cruz-tau"],
    colores: { oro: "oro", crema: "crema", negro: "negro" },
  },
} as const;

export type PiezaLogo<M extends MarcaId> = (typeof LOGOS)[M]["piezas"][number];
export type ColorLogo<M extends MarcaId> = keyof (typeof LOGOS)[M]["colores"] & string;

/** Ruta del logo relativa a baseRecursos. Lanza si la pieza o el color no existen para esa marca. */
export function rutaLogo(marca: MarcaId, pieza: string, color: string): string {
  const def = LOGOS[marca];
  if (!(def.piezas as readonly string[]).includes(pieza) || !(color in def.colores)) {
    throw new Error(`No hay logo «${marca}-${pieza}-${color}». Piezas: ${def.piezas.join(", ")}; colores: ${Object.keys(def.colores).join(", ")}`);
  }
  return `logos/${marca}-${pieza}-${color}.png`;
}

/** URL de un logo servido por el panel. */
export function urlLogo(baseRecursos: string, marca: MarcaId, pieza: string, color: string): string {
  return urlRecurso(baseRecursos, rutaLogo(marca, pieza, color));
}

/** Todas las rutas de logos (relativas a baseRecursos) que debe haber en public/instagram/. */
export function rutasLogos(): string[] {
  const rutas: string[] = [];
  for (const marca of Object.keys(LOGOS) as MarcaId[]) {
    for (const pieza of LOGOS[marca].piezas) {
      for (const color of Object.keys(LOGOS[marca].colores)) rutas.push(rutaLogo(marca, pieza, color));
    }
  }
  return rutas;
}
